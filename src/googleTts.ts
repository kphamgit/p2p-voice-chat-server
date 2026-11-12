// Google Cloud Text-to-Speech with a Chirp 3 HD voice (ported from the
// django-no-redis english.views.google_tts view).
//
// Credentials: on Heroku there's no credentials file, so set
// GOOGLE_TTS_CREDENTIALS_JSON to the service account's JSON contents. Locally,
// GOOGLE_APPLICATION_CREDENTIALS (a path to that JSON file) works too.
//
// Chirp 3 HD voices are generative: the same text can come out slightly
// differently each time. They don't accept SSML, so the text is spoken as is.

import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { MAX_TTS_BYTES, TtsInputError, type TtsVoice } from './tts.js';

// Any Chirp 3 HD voice, e.g. en-US-Chirp3-HD-Charon or en-GB-Chirp3-HD-Aoede.
// See https://cloud.google.com/text-to-speech/docs/chirp3-hd for the list.
export const DEFAULT_GOOGLE_VOICE = process.env['GOOGLE_TTS_VOICE'] ?? 'en-US-Chirp3-HD-Charon';
const CHIRP3_VOICE = /^([a-z]{2,3}-[A-Z]{2})-Chirp3-HD-[A-Za-z]+$/;

let client: TextToSpeechClient | undefined;

function ttsClient(): TextToSpeechClient {
    if (!client) {
        const json = process.env['GOOGLE_TTS_CREDENTIALS_JSON'];
        client = json ? new TextToSpeechClient({ credentials: JSON.parse(json) }) : new TextToSpeechClient();
    }
    return client;
}

const LOCALE_NAMES: Record<string, string> = {
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'en-AU': 'English (Australia)',
    'en-IN': 'English (India)',
};

// Google's English Chirp 3 HD voices (30 per locale: en-US, en-GB, en-AU,
// en-IN, …), US English first, then by locale and name; labelled like
// "Charon (male)" and grouped by locale. Fetched once, then cached for a day.
const VOICES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let voicesCache: { voices: TtsVoice[]; at: number } | undefined;

export async function listGoogleVoices(): Promise<TtsVoice[]> {
    if (voicesCache && Date.now() - voicesCache.at < VOICES_MAX_AGE_MS) return voicesCache.voices;
    const [response] = await ttsClient().listVoices({});
    const voices = (response.voices ?? [])
        .flatMap((v) => {
            const languageCode = CHIRP3_VOICE.exec(v.name ?? '')?.[1];
            if (!languageCode?.startsWith('en-')) return [];
            const gender = String(v.ssmlGender ?? '');
            const shortName = v.name!.slice(v.name!.lastIndexOf('-') + 1);
            return [{
                id: v.name!,
                label: gender === 'MALE' || gender === 'FEMALE' ? `${shortName} (${gender.toLowerCase()})` : shortName,
                group: LOCALE_NAMES[languageCode] ?? languageCode,
                sortKey: `${languageCode === 'en-US' ? 0 : 1} ${languageCode} ${v.name}`,
            }];
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(({ sortKey: _, ...voice }) => voice);
    voicesCache = { voices, at: Date.now() };
    return voices;
}

// Speaks `text` and returns MP3 audio. `rate` is the speaking rate, 0.25 to
// 4.0 (1.0 is normal; clamped). Throws TtsInputError for bad input.
export async function synthesizeGoogleSpeech(text: string, rate: number, voice: string): Promise<Buffer> {
    const languageCode = CHIRP3_VOICE.exec(voice)?.[1];
    if (!languageCode) throw new TtsInputError(`${voice} is not a Chirp 3 HD voice.`);
    if (Buffer.byteLength(text) > MAX_TTS_BYTES) throw new TtsInputError(`Text is over ${MAX_TTS_BYTES} bytes.`);
    const speakingRate = Math.min(4, Math.max(0.25, rate));

    const [response] = await ttsClient().synthesizeSpeech({
        input: { text },
        voice: { languageCode, name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
    });
    return Buffer.from(response.audioContent ?? new Uint8Array());
}
