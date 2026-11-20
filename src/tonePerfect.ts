import { randomUUID } from 'node:crypto';

// TonePerfect speech evaluation (https://api.toneperfect.app): scores a
// recording against the text the speaker was meant to say. Uses its HTTP API
// directly (no SDK). Set TONEPERFECT_API_KEY.
//
// Each call uses up one of the account's tries, so callers should only send
// a recording when the user asks for it.

const ASSESS_URL = 'https://api.toneperfect.app/v1/assess';

export function isTonePerfectConfigured(): boolean {
    return Boolean(process.env['TONEPERFECT_API_KEY']);
}

export interface AssessInput {
    audio: Buffer;
    filename: string; // its extension tells the format: wav, mp3, m4a, ogg or webm
    mimetype: string;
    text: string; // what the speaker was meant to say
    language: string; // e.g. en-US
}

// The error message in a TonePerfect error reply, whatever its shape.
function errorMessage(status: number, body: unknown, raw: string): string {
    if (body && typeof body === 'object') {
        const b = body as { message?: unknown; error?: unknown; detail?: unknown };
        for (const candidate of [b.message, b.detail, b.error, (b.error as { message?: unknown } | undefined)?.message]) {
            if (typeof candidate === 'string' && candidate) return `TonePerfect answered ${status}: ${candidate}`;
        }
    }
    return `TonePerfect answered ${status}${raw ? `: ${raw.slice(0, 300)}` : ''}`;
}

// TonePerfect's assessment of the recording, as it sends it (JSON). Each call
// carries a fresh Idempotency-Key, so a retried request isn't counted twice.
export async function assessWithTonePerfect(input: AssessInput): Promise<unknown> {
    const key = process.env['TONEPERFECT_API_KEY'];
    if (!key) throw new Error('TONEPERFECT_API_KEY is not set.');
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(input.audio)], { type: input.mimetype }), input.filename);
    form.append('text', input.text);
    form.append('language', input.language);
    const res = await fetch(ASSESS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Idempotency-Key': randomUUID() },
        body: form,
    });
    const raw = await res.text();
    let body: unknown = null;
    try {
        body = raw ? JSON.parse(raw) : null;
    } catch {
        // Not JSON: reported below (or returned as text).
    }
    if (!res.ok) throw new Error(errorMessage(res.status, body, raw));
    return body ?? raw;
}
