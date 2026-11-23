// VoiceAnalyzer_Claude (the FastAPI app that scores Shadowing recordings for
// phuyenenglish.com), called the way the Django app calls it.
//   VOICE_ANALYZER_URL      its base URL (default http://127.0.0.1:8001, a local run)
//   VOICE_ANALYZER_API_KEY  sent as X-API-Key; needed through its Cloudflare tunnel,
//                           not for a local run (its api_key.txt)
// Two calls:
//   POST /api/analyze-reference  what it measures in a reference audio alone,
//                                for the admin's "Analyze reference audio"
//   POST /api/evaluate           a student's recording scored against the
//                                question's audio (Shadowing, format 9)

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

// A stress word's syllables from ipa_cmu_syllabify.py, display only: from the
// IPA sent for it (source "ipa"), else the CMU dictionary in US IPA ("cmu"),
// else null. matches_cmu false: the analyzer measured cmu_syllable_count
// syllables, so these don't line up with the melody chart's slots.
export interface Syllabified {
    source: 'ipa' | 'cmu' | null;
    ipa: string | null; // the IPA sent for the word
    syllabified: string | null; // e.g. "ˈvɒ-li-bɔːl"
    syllable_count: number | null;
    syllables: { text: string; stress: 'primary' | 'secondary' | null }[];
    cmu_syllable_count: number | null;
    matches_cmu: boolean | null;
}

// The analyze-reference reply; words[] gets `hyphenated` added (see addHyphenation).
// A stress word in either reply (the fields addHyphenation uses).
interface StressWord {
    word?: string;
    syllable_count?: number;
    expected_pattern?: string;
    reference_pattern?: string;
    recorded_pattern?: string;
    expected_stressed_syllable?: number | null;
    reference_stressed_syllable?: number | null;
    hyphenated?: string[] | null;
    syllabified?: Syllabified; // added by the analyzer to every stress word
}

export interface ReferenceAnalysis {
    words?: StressWord[];
    stress_words_ipa?: Record<string, string>; // the IPA pairs as the analyzer read them
    [key: string]: unknown;
}

// What the analyzer measures in `audio` (an MP3) saying `sentence`, for the
// given stress words ("accept, apology"). `stressWordsIpa` (optional, display
// only): their IPA, "accept: əkˈsept, apology: əˈpɒlədʒi" or a JSON object as
// text; each word's `syllabified` comes from it. Nothing is saved.
export async function analyzeReference(
    audio: Buffer,
    sentence: string,
    stressWords: string,
    stressSource: StressSource,
    stressWordsIpa = '',
): Promise<ReferenceAnalysis> {
    const form = new FormData();
    form.append('spoken_text', sentence);
    form.append('stress_words', stressWords);
    form.append('stress_source', stressSource);
    form.append('stress_words_ipa', stressWordsIpa);
    form.append('reference_file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'reference.mp3');
    const analysis = (await post('/api/analyze-reference', form, 'Analyzing the reference')) as ReferenceAnalysis;
    await addHyphenation(analysis.words ?? []).catch((err) => console.error('❌ Spelling the syllables failed:', err));
    return analysis;
}

// A Shadowing question's scoring options (QuestionItem.scoringOptions), the
// keys the analyzer takes. Any missing one gets the Django app's default.
export interface ScoringOptions {
    targeted_words?: string;
    strict_connected_speech?: boolean;
    link_tolerance?: number;
    stress_words?: string;
    stress_contrast_ratio?: number;
    melody_min_similarity?: number;
    stress_source?: StressSource;
    fall_match_ratio?: number;
    rise_match_ratio?: number;
    stress_words_ipa?: string; // display only (see analyzeReference)
}

// The analyzer's verdict on a recording; word_stress_check.words[] gets
// `hyphenated` added (see addHyphenation). Passed on to the app as is.
export interface Evaluation {
    word_stress_check?: { words?: StressWord[]; stress_words_ipa?: Record<string, string> };
    [key: string]: unknown;
}

// `recording` (16 kHz mono WAV) as an attempt at saying `sentence` like
// `reference` (the question's MP3), scored with `options`. Nothing is saved.
export async function evaluateRecording(
    sentence: string,
    options: ScoringOptions | null,
    reference: Buffer,
    recording: Buffer,
): Promise<Evaluation> {
    const o = options ?? {};
    const form = new FormData();
    form.append('spoken_text', sentence);
    form.append('targeted_words', o.targeted_words ?? '');
    form.append('strict_connected_speech', o.strict_connected_speech === false ? 'false' : 'true');
    form.append('fall_match_ratio', String(o.fall_match_ratio ?? 0.75));
    form.append('rise_match_ratio', String(o.rise_match_ratio ?? 0.5));
    form.append('link_tolerance', String(o.link_tolerance ?? 1.0));
    form.append('stress_words', o.stress_words ?? '');
    form.append('stress_contrast_ratio', String(o.stress_contrast_ratio ?? 0.6));
    form.append('melody_min_similarity', String(o.melody_min_similarity ?? 0.35));
    form.append('stress_source', o.stress_source === 'reference' ? 'reference' : 'dictionary');
    form.append('stress_words_ipa', o.stress_words_ipa ?? '');
    form.append('reference_file', new Blob([new Uint8Array(reference)], { type: 'audio/mpeg' }), 'reference.mp3');
    form.append('recorded_file', new Blob([new Uint8Array(recording)], { type: 'audio/wav' }), 'recording.wav');
    const evaluation = (await post('/api/evaluate', form, 'The voice assessment')) as Evaluation;
    await addHyphenation(evaluation.word_stress_check?.words ?? []).catch((err) =>
        console.error('❌ Spelling the syllables failed:', err),
    );
    return evaluation;
}

// POSTs `form` to the analyzer and returns its JSON reply. Throws a
// VoiceAnalyzerError (502) when it can't be reached or answers with an error.
async function post(path: string, form: FormData, what: string): Promise<Record<string, unknown>> {
    const key = process.env['VOICE_ANALYZER_API_KEY'];
    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            body: form,
            headers: key ? { 'X-API-Key': key } : {},
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        console.error(`❌ Can't reach VoiceAnalyzer at ${BASE_URL}:`, err);
        throw new VoiceAnalyzerError('Can\'t reach the voice assessment server (VoiceAnalyzer).', 502);
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data || typeof data !== 'object' || Array.isArray(data)) {
        // FastAPI: {detail: "..."}, or a list of problems for a rejected request.
        const detail = data?.['detail'];
        const message = Array.isArray(detail)
            ? detail.map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : String(d))).join('; ')
            : typeof detail === 'string'
              ? detail
              : `${what} failed (${res.status}).`;
        throw new VoiceAnalyzerError(message, 502);
    }
    return data;
}

// Adds each stress word's syllables as spelled (["a", "pol", "o", "gy"], or
// null) from the dictionary's hyphenation, as the Django app does: only a split with as
// many parts as the analyzer found syllables; of two (noun / verb, e.g.
// "pres-ent" / "pre-sent"), a 1st-syllable stress picks the closed one.
async function addHyphenation(words: StressWord[]): Promise<void> {
    for (const w of words) {
        const pattern = (w.expected_pattern || w.reference_pattern || w.recorded_pattern || '').split(/\s+/).filter(Boolean);
        const count = w.syllable_count || pattern.length;
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
