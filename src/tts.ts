// Text-to-speech with a choice of provider: Google Chirp 3 HD voices
// (googleTts.ts) or ElevenLabs (elevenLabsTts.ts). Both return MP3 audio.

import { DEFAULT_GOOGLE_VOICE, listGoogleVoices, synthesizeGoogleSpeech } from './googleTts.js';
import {
    DEFAULT_ELEVENLABS_VOICE,
    ELEVENLABS_MAX_RATE,
    ELEVENLABS_MIN_RATE,
    isElevenLabsConfigured,
    listElevenLabsVoices,
    synthesizeElevenLabsSpeech,
} from './elevenLabsTts.js';

export const TTS_PROVIDERS = ['google', 'elevenlabs'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export interface TtsVoice {
    id: string; // what to send as `voice`: a Google voice name, or an ElevenLabs voice id
    label: string; // e.g. "Charon (male)", "River - Relaxed, Neutral, Informative"
    group: string; // for grouping a dropdown, e.g. "English (US)", "Premade"
}

// What the admin needs to offer a provider: its voices, the default one, and
// the speeds it accepts. `error` instead of voices when they can't be listed.
export interface TtsProviderInfo {
    id: TtsProvider;
    name: string;
    defaultVoice: string;
    minRate: number;
    maxRate: number;
    voices: TtsVoice[];
    error?: string;
}

// Both providers' input limit (Google's is 5000 bytes per request).
export const MAX_TTS_BYTES = 5000;

// Bad input (the caller's fault): sent back as 400.
export class TtsInputError extends Error {}

export function isTtsProvider(value: unknown): value is TtsProvider {
    return TTS_PROVIDERS.includes(value as TtsProvider);
}

const PROVIDERS: Record<
    TtsProvider,
    {
        name: string;
        defaultVoice: string;
        minRate: number;
        maxRate: number;
        configured: () => boolean;
        listVoices: () => Promise<TtsVoice[]>;
        synthesize: (text: string, rate: number, voice: string) => Promise<Buffer>;
    }
> = {
    google: {
        name: 'Google (Chirp 3 HD)',
        defaultVoice: DEFAULT_GOOGLE_VOICE,
        minRate: 0.25,
        maxRate: 4,
        configured: () => true, // credentials are checked when used
        listVoices: listGoogleVoices,
        synthesize: synthesizeGoogleSpeech,
    },
    elevenlabs: {
        name: 'ElevenLabs',
        defaultVoice: DEFAULT_ELEVENLABS_VOICE,
        minRate: ELEVENLABS_MIN_RATE,
        maxRate: ELEVENLABS_MAX_RATE,
        configured: isElevenLabsConfigured,
        listVoices: listElevenLabsVoices,
        synthesize: synthesizeElevenLabsSpeech,
    },
};

// Every provider with its voices. One provider failing (or not being set up)
// doesn't hide the other: it comes back with an `error` and no voices.
export async function listTtsProviders(): Promise<TtsProviderInfo[]> {
    return Promise.all(
        TTS_PROVIDERS.map(async (id) => {
            const p = PROVIDERS[id];
            const info = { id, name: p.name, defaultVoice: p.defaultVoice, minRate: p.minRate, maxRate: p.maxRate };
            if (!p.configured()) return { ...info, voices: [], error: `${p.name} is not set up on the server.` };
            try {
                const voices = await p.listVoices();
                // If the configured default isn't one of the voices, fall back to the first.
                const defaultVoice = voices.some((v) => v.id === p.defaultVoice) ? p.defaultVoice : (voices[0]?.id ?? '');
                return { ...info, defaultVoice, voices };
            } catch (err: any) {
                console.error(`❌ ${p.name} voice list failed:`, err);
                return { ...info, voices: [], error: `Could not get the ${p.name} voices.` };
            }
        }),
    );
}

// Speaks `text` with `provider` (default Google) and returns MP3 audio.
// `rate` is the speaking rate (1 is normal), clamped to what the provider
// accepts; `voice` defaults to the provider's default. Throws TtsInputError
// for bad input.
export async function synthesizeSpeech(
    text: string,
    { provider = 'google', rate = 1, voice }: { provider?: TtsProvider; rate?: number; voice?: string } = {},
): Promise<Buffer> {
    const p = PROVIDERS[provider];
    if (!text.trim()) throw new TtsInputError('No text provided.');
    if (!p.configured()) throw new TtsInputError(`${p.name} is not set up on the server.`);
    return p.synthesize(text, Number.isFinite(rate) ? rate : 1, voice || p.defaultVoice);
}
