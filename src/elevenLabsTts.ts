// ElevenLabs text-to-speech (ported from the django-no-redis
// api.views.generate_eleven_lab_audio_and_save_to_azure view, minus Azure:
// the audio is returned, and question audio is stored in S3 like Google's).
//
// Uses the HTTP API directly (no SDK). Set ELEVENLABS_API_KEY; optionally
// ELEVENLABS_VOICE (a voice id) and ELEVENLABS_MODEL.

import { MAX_TTS_BYTES, TtsInputError, type TtsVoice } from './tts.js';

const API = 'https://api.elevenlabs.io/v1';

// The Django app's default voice, "River" (relaxed, neutral, informative).
export const DEFAULT_ELEVENLABS_VOICE = process.env['ELEVENLABS_VOICE'] ?? 'SAz9YHcvj6GT2YYXdXww';

// The Django app's model: high quality, many languages.
const MODEL = process.env['ELEVENLABS_MODEL'] ?? 'eleven_multilingual_v2';

// ElevenLabs only accepts speeds from 0.7 to 1.2.
export const ELEVENLABS_MIN_RATE = 0.7;
export const ELEVENLABS_MAX_RATE = 1.2;

// Voice ids are short letters-and-digits strings, e.g. SAz9YHcvj6GT2YYXdXww.
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

export function isElevenLabsConfigured(): boolean {
    return Boolean(process.env['ELEVENLABS_API_KEY']);
}

function apiKey(): string {
    const key = process.env['ELEVENLABS_API_KEY'];
    if (!key) throw new Error('ELEVENLABS_API_KEY is not set.');
    return key;
}

// ElevenLabs reports errors as { detail: { message } } (or { detail: "..." }).
async function errorMessage(res: Response): Promise<string> {
    const body = (await res.json().catch(() => null)) as { detail?: { message?: string } | string } | null;
    const detail = body?.detail;
    return (typeof detail === 'string' ? detail : detail?.message) ?? `ElevenLabs answered ${res.status}.`;
}

// The account's voices (premade ones, plus any added from the library or
// cloned), labelled like "River - Relaxed, Neutral, Informative" and grouped
// by category. Fetched once, then cached for an hour, so a voice added on the
// ElevenLabs site shows up without a restart.
const VOICES_MAX_AGE_MS = 60 * 60 * 1000;
let voicesCache: { voices: TtsVoice[]; at: number } | undefined;

const CATEGORY_NAMES: Record<string, string> = {
    premade: 'Premade',
    cloned: 'Cloned',
    generated: 'Generated',
    professional: 'Professional',
};

export async function listElevenLabsVoices(): Promise<TtsVoice[]> {
    if (voicesCache && Date.now() - voicesCache.at < VOICES_MAX_AGE_MS) return voicesCache.voices;
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': apiKey() } });
    if (!res.ok) throw new Error(await errorMessage(res));
    const body = (await res.json()) as { voices?: { voice_id: string; name?: string; category?: string }[] };
    const voices = (body.voices ?? [])
        .map((v) => ({
            id: v.voice_id,
            label: v.name || v.voice_id,
            group: CATEGORY_NAMES[v.category ?? ''] ?? (v.category ? v.category[0]!.toUpperCase() + v.category.slice(1) : 'Other'),
        }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    voicesCache = { voices, at: Date.now() };
    return voices;
}

// Speaks `text` and returns MP3 audio (44.1 kHz, 128 kbps, as in Django).
// `rate` is clamped to 0.7–1.2. Throws TtsInputError for input ElevenLabs
// refuses (e.g. an unknown voice).
export async function synthesizeElevenLabsSpeech(text: string, rate: number, voice: string): Promise<Buffer> {
    if (!VOICE_ID.test(voice)) throw new TtsInputError(`${voice} is not an ElevenLabs voice id.`);
    if (Buffer.byteLength(text) > MAX_TTS_BYTES) throw new TtsInputError(`Text is over ${MAX_TTS_BYTES} bytes.`);
    const speed = Math.min(ELEVENLABS_MAX_RATE, Math.max(ELEVENLABS_MIN_RATE, rate));
    const res = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: MODEL, voice_settings: { speed } }),
    });
    if (!res.ok) {
        const message = await errorMessage(res);
        // 400/404/422: something about the request (voice, text); anything
        // else (bad key, quota, outage) is the server's problem.
        if ([400, 404, 422].includes(res.status)) throw new TtsInputError(`ElevenLabs: ${message}`);
        throw new Error(`ElevenLabs (${res.status}): ${message}`);
    }
    return Buffer.from(await res.arrayBuffer());
}
