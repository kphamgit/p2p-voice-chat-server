// The admin's Speech Assessment tab shows TonePerfect's and Azure's
// assessments side by side, so both are boiled down to one readable shape
// here: the overall score, the other scores, and each word with its score
// and the sounds that went wrong. (The full replies are kept as `raw`.)

export interface SoundSummary {
    expected: string; // IPA
    heard: string | null; // what was heard instead, if it differs (null: not said, or unknown)
    score: number | null;
}

export interface WordSummary {
    text: string; // as written in the sentence when the words line up, else the provider's spelling
    score: number | null;
    status: 'ok' | 'flagged' | 'omitted' | 'inserted';
    sounds: SoundSummary[];
}

export interface AssessmentSummary {
    overall: number | null;
    scores: { label: string; value: number | null }[];
    heard: string | null; // what was recognized: words (Azure) or sounds (TonePerfect)
    words: WordSummary[];
    notes: string[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// A word as compared when lining a provider's words up with the sentence's.
const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, '');

// Gives the sentence's words (not inserted ones) their spelling in the
// sentence, "Calculus," rather than "calculus", when they line up one to one.
function withSentenceSpelling(sentence: string, words: WordSummary[]): WordSummary[] {
    const written = sentence.split(/\s+/).filter((w) => bare(w) !== '');
    const own = words.filter((w) => w.status !== 'inserted');
    if (written.length !== own.length || written.some((w, i) => bare(w) !== bare(own[i]!.text))) return words;
    let i = 0;
    return words.map((w) => (w.status === 'inserted' ? w : { ...w, text: written[i++]! }));
}

// TonePerfect (POST /v1/assess). Its top-level scores leave fluency null for
// English, so the one under raw.scores is used.
export function summarizeTonePerfect(reply: unknown, sentence: string): AssessmentSummary {
    const r = obj(reply);
    const scores = obj(r['scores']);
    const raw = obj(r['raw']);
    const rawScores = obj(raw['scores']);
    const words: WordSummary[] = arr(r['words']).map((w) => {
        const word = obj(w);
        const decision = str(word['decision']);
        return {
            text: str(word['text']) ?? str(word['word']) ?? '',
            score: num(word['score']),
            status: word['omission_suspected'] === true ? 'omitted' : decision && decision !== 'no_correction' ? 'flagged' : 'ok',
            sounds: arr(word['phonemes']).map((p) => {
                const phone = obj(p);
                const expected = str(phone['expected']) ?? str(phone['phone']) ?? '';
                const op = str(phone['operation']);
                const heard = str(phone['heard']);
                return { expected, heard: op === 'D' ? null : heard && heard !== expected ? heard : null, score: num(phone['score']) };
            }),
        };
    });
    const notes = [
        ...arr(r['warnings']).map((w) => (typeof w === 'string' ? w : JSON.stringify(w))),
        ...arr(obj(r['model'])['limitations']).filter((l): l is string => typeof l === 'string'),
    ];
    if (r['assessable'] === false) notes.unshift(`Not assessable: ${str(r['reason']) ?? 'no reason given'}`);
    const billing = obj(r['billing']);
    if (typeof billing['free_credits'] === 'number') notes.push(`Free tries left: ${billing['free_credits']}`);
    return {
        overall: num(scores['overall']),
        scores: [
            { label: 'Pronunciation', value: num(scores['pronunciation']) },
            { label: 'Completeness', value: num(scores['integrity']) },
            { label: 'Fluency', value: num(scores['fluency']) ?? num(rawScores['fluency']) },
            { label: 'Rhythm', value: num(scores['rhythm']) },
        ],
        heard: str(obj(r['heard'])['phonetic_transcription']),
        words: withSentenceSpelling(sentence, words),
        notes,
    };
}

// Azure Pronunciation Assessment, as assessPronunciationInDetail asks for it
// (IPA, NBestPhonemes, prosody). Scores may sit on the result itself or under
// PronunciationAssessment, depending on the reply's version.
export function summarizeAzure(reply: unknown, sentence: string): AssessmentSummary {
    const r = obj(reply);
    if (r['RecognitionStatus'] !== 'Success') {
        return { overall: 0, scores: [], heard: null, words: [], notes: [`Azure heard nothing it could assess (${str(r['RecognitionStatus']) ?? 'no status'}).`] };
    }
    const best = obj(arr(r['NBest'])[0]);
    const scores = { ...best, ...obj(best['PronunciationAssessment']) };
    const words: WordSummary[] = arr(best['Words']).map((w) => {
        const word = obj(w);
        const pa = { ...word, ...obj(word['PronunciationAssessment']) };
        const error = str(pa['ErrorType']) ?? 'None';
        return {
            text: str(word['Word']) ?? '',
            score: error === 'Omission' ? null : num(pa['AccuracyScore']),
            status: error === 'Omission' ? 'omitted' : error === 'Insertion' ? 'inserted' : error === 'None' ? 'ok' : 'flagged',
            sounds: arr(word['Phonemes']).map((p) => {
                const phone = obj(p);
                const ppa = { ...phone, ...obj(phone['PronunciationAssessment']) };
                const expected = str(phone['Phoneme']) ?? '';
                // The sound Azure thinks was most likely said.
                const likely = str(obj(arr(ppa['NBestPhonemes'])[0])['Phoneme']);
                return { expected, heard: likely && likely !== expected ? likely : null, score: num(ppa['AccuracyScore']) };
            }),
        };
    });
    return {
        overall: num(scores['PronScore']),
        scores: [
            { label: 'Accuracy', value: num(scores['AccuracyScore']) },
            { label: 'Completeness', value: num(scores['CompletenessScore']) },
            { label: 'Fluency', value: num(scores['FluencyScore']) },
            { label: 'Prosody', value: num(scores['ProsodyScore']) },
        ],
        heard: str(best['Display']),
        words: withSentenceSpelling(sentence, words),
        notes: [],
    };
}
