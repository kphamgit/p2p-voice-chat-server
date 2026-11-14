// OpenAI speech recognition (Whisper) and English → Vietnamese translation,
// ported from the django-no-redis api.views openai_transcription,
// transcribe_and_save and translate_en_to_vi.
//
// Uses the HTTP API directly (no SDK). Set OPENAI_API_KEY; optionally
// OPENAI_TRANSCRIBE_MODEL (default whisper-1, as in Django) and
// OPENAI_TRANSLATE_MODEL (default gpt-4o-mini).

const API = 'https://api.openai.com/v1';
const TRANSCRIBE_MODEL = process.env['OPENAI_TRANSCRIBE_MODEL'] ?? 'whisper-1';
const TRANSLATE_MODEL = process.env['OPENAI_TRANSLATE_MODEL'] ?? 'gpt-4o-mini';

// OpenAI refuses audio files over 25 MB.
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export function isOpenAiConfigured(): boolean {
    return Boolean(process.env['OPENAI_API_KEY']);
}

function apiKey(): string {
    const key = process.env['OPENAI_API_KEY'];
    if (!key) throw new Error('OPENAI_API_KEY is not set.');
    return key;
}

// OpenAI reports errors as { error: { message } }.
async function errorMessage(res: Response): Promise<string> {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return body?.error?.message ?? `OpenAI answered ${res.status}.`;
}

export interface AudioFile {
    buffer: Buffer;
    filename: string; // OpenAI tells the format from its extension, e.g. recording.webm
    mimetype: string;
}

// The text spoken in `audio`. English is forced, as in Django, so short or
// accented speech isn't mistaken for another language. `prompt` lightly biases
// the wording (e.g. "This is an English speaking practice answer.").
export async function transcribeAudio(audio: AudioFile, prompt?: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio.buffer)], { type: audio.mimetype }), audio.filename);
    form.append('model', TRANSCRIBE_MODEL);
    form.append('language', 'en');
    if (prompt) form.append('prompt', prompt);
    const res = await fetch(`${API}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}` },
        body: form,
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const body = (await res.json()) as { text?: string };
    return body.text ?? '';
}

// The Django app's translation instructions, word for word.
const TRANSLATE_EN_TO_VI =
    "You are a translator. Translate the user's English text into natural Vietnamese. Recognize idioms and " +
    'figurative expressions and translate the intended meaning, not word-for-word; use the natural Vietnamese ' +
    'equivalent (e.g. "He is chicken" -> "Anh ấy nhát gan"). Reply with only the Vietnamese translation — no ' +
    'quotes, no notes, no English.';

// `text` in Vietnamese. Returns '' for empty text, and '' (never throws) if
// the call fails, so a transcription can include a translation without the
// whole request failing over it.
export async function translateEnToVi(text: string): Promise<string> {
    const input = text.trim();
    if (!input) return '';
    try {
        const res = await fetch(`${API}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: TRANSLATE_MODEL,
                messages: [
                    { role: 'system', content: TRANSLATE_EN_TO_VI },
                    { role: 'user', content: input },
                ],
                temperature: 0.2,
            }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
        return (body.choices?.[0]?.message?.content ?? '').trim();
    } catch (err) {
        console.error('❌ Translating to Vietnamese failed:', err);
        return '';
    }
}
