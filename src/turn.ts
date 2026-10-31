// Short-lived Metered TURN credentials, created server-side so the Metered
// secret key never reaches the browser. Clients fetch ICE servers from
// GET /turn-credentials (see controllers/turn.ts).
//
// Metered constraints shaping this design (metered.ca/docs/turn-rest-api):
//  - A new credential can take up to 2 minutes to start working, so we can't
//    mint one per call; we keep one cached and reuse it across calls.
//  - Expiry is a hard cutoff, even for calls in progress, so we always hand
//    out a credential with plenty of life left and rotate well before expiry.
//  - The free plan caps how many credentials can exist. So every credential we
//    create is saved in the TurnCredential table: a restart (deploy, Heroku's
//    daily restart, `tsx watch` reloads) reuses the saved one instead of minting
//    another, and expired ones are deleted from Metered. We never delete a
//    credential before it expires — that would cut off calls still using it.
//
// Required env: METERED_APP_NAME (the <app> in <app>.metered.live) and
// METERED_SECRET_KEY (from the Metered dashboard). Without them TURN is
// disabled and clients fall back to direct (STUN-only) connections.

import { prisma } from './prisma.js';

const CREDENTIAL_TTL_SECONDS = 24 * 60 * 60; // each credential lives 24h
const ROTATE_WHEN_REMAINING_MS = 8 * 60 * 60 * 1000; // start the next one at 8h left
const PROPAGATION_MS = 2 * 60 * 1000; // Metered: allow up to 2 min to propagate
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // sweep expired credentials at most hourly

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
let restoring: Promise<void> | null = null; // one-time load of saved credentials
let lastCleanupAt = 0;

export function isTurnConfigured(): boolean {
    return Boolean(process.env["METERED_APP_NAME"] && process.env["METERED_SECRET_KEY"]);
}

function meteredBase(): string {
    return `https://${process.env["METERED_APP_NAME"]}.metered.live/api/v1/turn`;
}

function secretKeyParam(): string {
    return encodeURIComponent(process.env["METERED_SECRET_KEY"] ?? '');
}

// Create a credential, then fetch the ICE server list (URLs + username/password)
// for it. Both calls stay on the server; only the ICE servers go to clients.
async function createCredential(): Promise<CachedCredential> {
    const base = meteredBase();

    const createRes = await fetch(`${base}/credential?secretKey=${secretKeyParam()}`, {
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
    const credential = { iceServers, createdAt, expiresAt: createdAt + CREDENTIAL_TTL_SECONDS * 1000 };

    // Save it so a restart reuses it and cleanup can delete it once expired.
    // If saving fails we still use it — losing track of one credential beats
    // failing the request.
    const username = credentialUsername(credential);
    if (username) {
        await prisma.turnCredential
            .create({
                data: {
                    username,
                    iceServers: iceServers as object[],
                    createdAt: new Date(createdAt),
                    expiresAt: new Date(credential.expiresAt),
                },
            })
            .catch((err) => console.error('❌ Could not save TURN credential (it will not be cleaned up):', err));
    } else {
        console.error('❌ Metered ICE servers had no username; TURN credential will not be cleaned up.');
    }
    return credential;
}

// The Metered username shared by all of a credential's TURN entries.
function credentialUsername(c: CachedCredential): string | undefined {
    return c.iceServers.find((s) => s.username)?.username;
}

function startCreate(): Promise<CachedCredential> {
    creating ??= createCredential().finally(() => {
        creating = null;
    });
    return creating;
}

// After a restart, pick up the credentials saved by the previous process. The
// newest unexpired one is served (or held as `next` while it's still
// propagating, if an older one can cover the gap).
async function restoreSaved(): Promise<void> {
    const rows = await prisma.turnCredential.findMany({
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        take: 2,
    });
    const [newest, older] = rows.map((r) => ({
        iceServers: r.iceServers as unknown as IceServer[],
        createdAt: r.createdAt.getTime(),
        expiresAt: r.expiresAt.getTime(),
    }));
    if (!newest) return;
    if (older && Date.now() - newest.createdAt < PROPAGATION_MS) {
        current = older;
        next = newest;
    } else {
        current = newest;
    }
}

// Delete one credential from Metered. "Not found" counts as success (it's
// already gone, e.g. removed in the dashboard).
async function deleteFromMetered(username: string): Promise<boolean> {
    const res = await fetch(`${meteredBase()}/credential?secretKey=${secretKeyParam()}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
    });
    if (res.ok) return true;
    const body = await res.text();
    if (res.status === 400 && body.includes('not found')) return true;
    throw new Error(`Metered delete credential failed (${res.status}): ${body}`);
}

// Remove expired credentials from Metered (and our table) so they don't count
// toward the plan's limit. Only expired ones: those can't carry calls anymore.
async function cleanupExpired(): Promise<void> {
    const expired = await prisma.turnCredential.findMany({ where: { expiresAt: { lte: new Date() } } });
    for (const { username } of expired) {
        try {
            if (await deleteFromMetered(username)) {
                await prisma.turnCredential.delete({ where: { username } });
            }
        } catch (err) {
            console.error(`❌ TURN cleanup failed for ${username} (will retry):`, err);
        }
    }
    if (expired.length) console.log(`🧹 Deleted ${expired.length} expired TURN credential(s)`);
}

function maybeCleanup(now: number): void {
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    lastCleanupAt = now;
    cleanupExpired().catch((err) => console.error('❌ TURN cleanup failed (will retry):', err));
}

// Return ICE servers for the current credential, rotating in the background as
// it nears expiry. Only a cold start with nothing saved waits on Metered.
export async function getTurnIceServers(): Promise<IceServer[]> {
    restoring ??= restoreSaved().catch((err) => {
        // Not fatal: fall through and create a fresh credential instead.
        console.error('❌ Could not load saved TURN credentials:', err);
    });
    await restoring;

    const now = Date.now();
    maybeCleanup(now);

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
