// Short-lived Metered TURN credentials, created server-side so the Metered
// secret key never reaches the browser. Clients fetch ICE servers from
// GET /turn-credentials (see controllers/turn.ts).
//
// Metered constraints shaping this design (metered.ca/docs/turn-rest-api):
//  - A new credential can take up to 2 minutes to start working, so we can't
//    mint one per call; we keep one cached and reuse it across calls.
//  - Expiry is a hard cutoff, even for calls in progress, so we always hand
//    out a credential with plenty of life left and rotate well before expiry.
//
// Required env: METERED_APP_NAME (the <app> in <app>.metered.live) and
// METERED_SECRET_KEY (from the Metered dashboard). Without them TURN is
// disabled and clients fall back to direct (STUN-only) connections.

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60; // each credential lives 24h
const ROTATE_WHEN_REMAINING_MS = 8 * 60 * 60 * 1000; // start the next one at 8h left
const PROPAGATION_MS = 2 * 60 * 1000; // Metered: allow up to 2 min to propagate

export interface IceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
}

interface CachedCredential {
    iceServers: IceServer[];
    createdAt: number;
    expiresAt: number;
}

let current: CachedCredential | null = null; // what we hand out
let next: CachedCredential | null = null; // rotated-in once propagated
let creating: Promise<CachedCredential> | null = null; // dedupes concurrent creates

export function isTurnConfigured(): boolean {
    return Boolean(process.env["METERED_APP_NAME"] && process.env["METERED_SECRET_KEY"]);
}

// Create a credential, then fetch the ICE server list (URLs + username/password)
// for it. Both calls stay on the server; only the ICE servers go to clients.
async function createCredential(): Promise<CachedCredential> {
    const base = `https://${process.env["METERED_APP_NAME"]}.metered.live/api/v1/turn`;
    const secretKey = encodeURIComponent(process.env["METERED_SECRET_KEY"] ?? '');

    const createRes = await fetch(`${base}/credential?secretKey=${secretKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryInSeconds: CREDENTIAL_TTL_SECONDS, label: 'p2p-voice-chat' }),
    });
    if (!createRes.ok) {
        throw new Error(`Metered create credential failed (${createRes.status}): ${await createRes.text()}`);
    }
    const { apiKey } = (await createRes.json()) as { apiKey?: string };
    if (!apiKey) throw new Error('Metered create credential returned no apiKey.');

    const listRes = await fetch(`${base}/credentials?apiKey=${encodeURIComponent(apiKey)}`);
    if (!listRes.ok) {
        throw new Error(`Metered ICE server fetch failed (${listRes.status}): ${await listRes.text()}`);
    }
    const iceServers = (await listRes.json()) as IceServer[];

    const createdAt = Date.now();
    return { iceServers, createdAt, expiresAt: createdAt + CREDENTIAL_TTL_SECONDS * 1000 };
}

function startCreate(): Promise<CachedCredential> {
    creating ??= createCredential().finally(() => {
        creating = null;
    });
    return creating;
}

// Return ICE servers for the current credential, rotating in the background as
// it nears expiry. Only the very first call (cold start) waits on Metered.
export async function getTurnIceServers(): Promise<IceServer[]> {
    const now = Date.now();

    // Promote the next credential once it has had time to propagate.
    if (next && now - next.createdAt >= PROPAGATION_MS) {
        current = next;
        next = null;
    }

    // Cold start, or the current one has fully expired (e.g. rotation kept failing).
    if (!current || current.expiresAt <= now) {
        current = await startCreate();
        return current.iceServers;
    }

    // Nearing expiry: create the next one in the background; keep serving current.
    if (!next && current.expiresAt - now < ROTATE_WHEN_REMAINING_MS) {
        startCreate()
            .then((c) => {
                next = c;
            })
            .catch((err) => console.error('❌ TURN credential rotation failed (will retry):', err));
    }

    return current.iceServers;
}
