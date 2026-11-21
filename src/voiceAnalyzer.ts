// VoiceAnalyzer_Claude (the FastAPI app that scores Shadowing recordings for
// phuyenenglish.com), called the way the Django app calls it.
//   VOICE_ANALYZER_URL      its base URL (default http://127.0.0.1:8001, a local run)
//   VOICE_ANALYZER_API_KEY  sent as X-API-Key; needed through its Cloudflare tunnel,
//                           not for a local run (its api_key.txt)
// For now only POST /api/analyze-reference: what it measures in a reference
// audio alone, for the admin's "Analyze reference audio" (Shadowing questions).

import { prisma } from './prisma.js';

const BASE_URL = (process.env['VOICE_ANALYZER_URL'] || 'http://127.0.0.1:8001').replace(/\/+$/, '');
const TIMEOUT_MS = 120_000;

// A problem worth showing as is (bad input, or the analyzer's own message).
export class VoiceAnalyzerError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export type StressSource = 'dictionary' | 'reference';

// The analyzer's reply; words[] gets `hyphenated` added (see addHyphenation).
export interface ReferenceAnalysis {
    words?: { word?: string; syllable_count?: number; expected_stressed_syllable?: number | null; reference_stressed_syllable?: number | null; hyphenated?: string[] | null }[];
    [key: string]: unknown;
}

// What the analyzer measures in `audio` (an MP3) saying `sentence`, for the
// given stress words ("accept, apology"). Nothing is saved.
export async function analyzeReference(
    audio: Buffer,
    sentence: string,
    stressWords: string,
    stressSource: StressSource,
): Promise<ReferenceAnalysis> {
    const form = new FormData();
    form.append('spoken_text', sentence);
    form.append('stress_words', stressWords);
    form.append('stress_source', stressSource);
    form.append('reference_file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'reference.mp3');
    const key = process.env['VOICE_ANALYZER_API_KEY'];
    let res: Response;
    try {
        res = await fetch(`${BASE_URL}/api/analyze-reference`, {
            method: 'POST',
            body: form,
            headers: key ? { 'X-API-Key': key } : {},
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        console.error(`❌ Can't reach VoiceAnalyzer at ${BASE_URL}:`, err);
        throw new VoiceAnalyzerError('Can\'t reach the voice assessment server (VoiceAnalyzer).', 502);
    }
    const data = (await res.json().catch(() => null)) as ReferenceAnalysis | { detail?: unknown } | null;
    if (!res.ok || !data || typeof data !== 'object') {
        // FastAPI: {detail: "..."}, or a list of problems for a rejected request.
        const detail = (data as { detail?: unknown } | null)?.detail;
        const message = Array.isArray(detail)
            ? detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : String(d))).join('; ')
            : typeof detail === 'string'
              ? detail
              : `Analyzing the reference failed (${res.status}).`;
        throw new VoiceAnalyzerError(message, 502);
    }
    const analysis = data as ReferenceAnalysis;
    await addHyphenation(analysis).catch((err) => console.error('❌ Spelling the syllables failed:', err));
    return analysis;
}

// Adds each word's syllables as spelled (["a", "pol", "o", "gy"], or null) from
// the dictionary's hyphenation, as the Django app does: only a split with as
// many parts as the analyzer found syllables; of two (noun / verb, e.g.
// "pres-ent" / "pre-sent"), a 1st-syllable stress picks the closed one.
async function addHyphenation(analysis: ReferenceAnalysis): Promise<void> {
    for (const w of analysis.words ?? []) {
        const count = w.syllable_count ?? 0;
        const word = String(w.word ?? '').replace(/[^A-Za-z']/g, '').toLowerCase();
        w.hyphenated = null;
        if (count < 2 || !word) continue;
        const entries = await prisma.dictEntry.findMany({
            where: { headWord: { equals: word, mode: 'insensitive' }, hyphenated: { not: '' } },
            select: { hyphenated: true },
        });
        const variants = [...new Set(entries.flatMap((e) => e.hyphenated.split(' / ').map((v) => v.trim().toLowerCase())))];
        let fitting = variants.map((v) => v.split('-')).filter((parts) => parts.length === count && parts.every(Boolean));
        const stressed = w.expected_stressed_syllable ?? w.reference_stressed_syllable;
        if (fitting.length > 1 && stressed != null) {
            const closed = fitting.filter((p) => !'aeiouy'.includes(p[0]!.slice(-1)));
            const opened = fitting.filter((p) => !closed.includes(p));
            fitting = (stressed === 1 ? closed : opened).length ? (stressed === 1 ? closed : opened) : fitting;
        }
        w.hyphenated = fitting[0] ?? null;
    }
}
