// Azure Pronunciation Assessment: how well a recording says a known sentence,
// for Shadowing questions (format 9). Uses the Speech service's REST API for
// short audio directly (no SDK), with the same Speech resource as the Azure
// TTS: set AZURE_SPEECH_KEY and AZURE_SERVICE_REGION (e.g. eastus).

export function isAzureSpeechConfigured(): boolean {
    return Boolean(process.env['AZURE_SPEECH_KEY'] && process.env['AZURE_SERVICE_REGION']);
}

// What Azure says about one word of the sentence.
//   None: said (score it by accuracyScore)
//   Mispronunciation: said, but badly
//   Omission: not said (accuracyScore 0)
export type WordError = 'None' | 'Mispronunciation' | 'Omission';

export interface AssessedWord {
    word: string; // as written in the sentence ("I", "U.S.,"), or Azure's spelling if they couldn't be lined up
    accuracyScore: number; // 0–100
    errorType: WordError;
}

export interface PronunciationResult {
    heard: string; // what Azure recognized ('' if nothing was heard)
    pronScore: number; // 0–100, the overall score (Azure's mix of the three below)
    accuracyScore: number; // how well the sounds were said
    fluencyScore: number; // smoothness: pauses and pace
    completenessScore: number; // the share of the sentence's words that were said
    words: AssessedWord[]; // the sentence's words, in order
    insertions: string[]; // words said that aren't in the sentence (they lower fluency, not the words' scores)
}

interface AzureWord {
    Word: string;
    AccuracyScore?: number;
    ErrorType?: string;
    PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
}
interface AzureScores {
    PronScore?: number;
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
}
interface AzureReply {
    RecognitionStatus?: string;
    NBest?: (AzureScores & { Display?: string; PronunciationAssessment?: AzureScores; Words?: AzureWord[] })[];
}

const round = (n: number | undefined) => Math.round(n ?? 0);

// A word as compared when lining Azure's words up with the sentence's.
const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, '');

// The sentence's words, written as in the sentence, carrying Azure's scores.
// Azure's words are lower case without punctuation; when they don't line up
// one to one (e.g. Azure split "25" into "twenty five"), its own spellings are used.
function sentenceWords(referenceText: string, assessed: AssessedWord[]): AssessedWord[] {
    const written = referenceText.split(/\s+/).filter((w) => bare(w) !== '');
    if (written.length !== assessed.length || written.some((w, i) => bare(w) !== bare(assessed[i]!.word))) {
        return assessed;
    }
    return assessed.map((w, i) => ({ ...w, word: written[i]! }));
}

// Sends `wav` (16 kHz mono 16-bit WAV, at most about 30 s) to Azure with
// these Pronunciation Assessment settings, for American English, and returns
// its reply (JSON).
async function requestAssessment(wav: Buffer, config: Record<string, unknown>): Promise<unknown> {
    const key = process.env['AZURE_SPEECH_KEY'];
    const region = process.env['AZURE_SERVICE_REGION'];
    if (!key || !region) throw new Error('AZURE_SPEECH_KEY or AZURE_SERVICE_REGION is not set.');
    const res = await fetch(
        `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`,
        {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': key,
                'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
                'Pronunciation-Assessment': Buffer.from(JSON.stringify(config)).toString('base64'),
                Accept: 'application/json',
            },
            body: new Uint8Array(wav),
        },
    );
    if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`Azure answered ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    return res.json();
}

// Azure's full reply for `wav` as an attempt at `referenceText`, with
// everything it can report: each sound's score in IPA with the sounds it
// most likely heard instead (NBestPhonemes), and prosody (rhythm and
// intonation). For the admin's Speech Assessment comparison.
export async function assessPronunciationInDetail(wav: Buffer, referenceText: string): Promise<unknown> {
    return requestAssessment(wav, {
        ReferenceText: referenceText,
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
        EnableMiscue: true,
        EnableProsodyAssessment: true,
        PhonemeAlphabet: 'IPA',
        NBestPhonemeCount: 3,
    });
}

// Scores `wav` (16 kHz mono 16-bit WAV, at most about 30 s) as an attempt at
// saying `referenceText` (American English), word by word.
export async function assessPronunciation(wav: Buffer, referenceText: string): Promise<PronunciationResult> {
    const reply = (await requestAssessment(wav, {
        ReferenceText: referenceText,
        GradingSystem: 'HundredMark',
        Granularity: 'Word',
        Dimension: 'Comprehensive',
        EnableMiscue: true, // report skipped (Omission) and extra (Insertion) words
    })) as AzureReply;
    const best = reply.RecognitionStatus === 'Success' ? reply.NBest?.[0] : undefined;
    if (!best) {
        // Nothing recognizable (silence, noise): every word omitted.
        return {
            heard: '',
            pronScore: 0,
            accuracyScore: 0,
            fluencyScore: 0,
            completenessScore: 0,
            words: referenceText
                .split(/\s+/)
                .filter((w) => bare(w) !== '')
                .map((word) => ({ word, accuracyScore: 0, errorType: 'Omission' as const })),
            insertions: [],
        };
    }
    // Older replies put the scores on the result itself, newer ones under PronunciationAssessment.
    const scores = best.PronunciationAssessment ?? best;
    const assessed: AssessedWord[] = [];
    const insertions: string[] = [];
    for (const w of best.Words ?? []) {
        const errorType = w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? 'None';
        if (errorType === 'Insertion') {
            insertions.push(w.Word);
            continue;
        }
        assessed.push({
            word: w.Word,
            accuracyScore: errorType === 'Omission' ? 0 : round(w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore),
            errorType: errorType === 'Omission' || errorType === 'Mispronunciation' ? errorType : 'None',
        });
    }
    return {
        heard: /[a-z0-9]/i.test(best.Display ?? '') ? best.Display! : '', // silence can come back as "."
        pronScore: round(scores.PronScore),
        accuracyScore: round(scores.AccuracyScore),
        fluencyScore: round(scores.FluencyScore),
        completenessScore: round(scores.CompletenessScore),
        words: sentenceWords(referenceText, assessed),
        insertions,
    };
}
