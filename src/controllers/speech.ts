import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import UploadToS3, { RECORDINGS_PREFIX } from './upload_to_s3.js';
import { isOpenAiConfigured, transcribeAudio, translateEnToVi, type AudioFile } from '../openai.js';
import { connectedSpeechOnly, evaluateRecording, VoiceAnalyzerError, type ScoringOptions } from '../voiceAnalyzer.js';
import { plainText } from '../audio.js';
import { prisma } from '../prisma.js';

// Speech recognition for students' spoken answers (see src/openai.ts), and
// Shadowing scoring (see src/voiceAnalyzer.ts). Each request carries one recording as the multipart `audio` field (kept in
// memory by multer, see routes/speech.ts).

// transcribe-and-save stores recordings under RECORDINGS_PREFIX: private, like
// the voice-chat recordings, so they're played through presigned URLs.

// File extensions by audio type, for recordings uploaded without a usable
// file name (OpenAI tells the format from the extension).
const AUDIO_EXTENSIONS: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/aac': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
};

function extensionOf(file: Express.Multer.File): string {
    const fromName = /\.([a-z0-9]{2,4})$/i.exec(file.originalname)?.[1]?.toLowerCase();
    return fromName ?? AUDIO_EXTENSIONS[file.mimetype.split(';')[0]!] ?? 'webm';
}

function audioOf(file: Express.Multer.File): AudioFile {
    return { buffer: file.buffer, filename: `recording.${extensionOf(file)}`, mimetype: file.mimetype || 'audio/webm' };
}

// The checks both endpoints share: the API key and the file. Sends the error
// and returns null if one fails.
function uploadedAudio(req: Request, res: Response): Express.Multer.File | null {
    if (!isOpenAiConfigured()) {
        res.status(503).send({ message: 'Speech recognition is not set up on the server (OPENAI_API_KEY is missing).' });
        return null;
    }
    if (!req.file?.buffer?.length) {
        res.status(400).send({ message: "No audio file provided: send it as the multipart 'audio' field." });
        return null;
    }
    return req.file;
}

// Shadowing questions: the student repeats the question text after its audio.
const SHADOWING_FORMAT = 9;

class SpeechController {
    // POST /speech/transcribe — the recording's text, and its Vietnamese
    // translation: { transcription, translation }. (Django: speech-to-text/.)
    // A form field translate=false skips the translation (translation: ''),
    // e.g. when the app only checks a spoken answer: one OpenAI call fewer.
    public async transcribe(req: Request, res: Response): Promise<void> {
        const file = uploadedAudio(req, res);
        if (!file) return;
        const translate = (req.body as { translate?: string } | undefined)?.translate !== 'false';
        try {
            const transcription = await transcribeAudio(audioOf(file));
            res.json({ transcription, translation: translate ? await translateEnToVi(transcription) : '' });
        } catch (err: any) {
            console.error('❌ Transcription failed:', err);
            res.status(502).send({ message: `Transcription failed: ${err.message}` });
        }
    }

    // POST /speech/transcribe-and-save — stores the recording in S3, then
    // transcribes it: { transcription, translation, audioUrl } (audioUrl: a
    // presigned link, valid for an hour). If only the transcription fails, the
    // answer is a 502 that still carries audioUrl. (Django: transcribe-and-save/.)
    public async transcribeAndSave(req: Request, res: Response): Promise<void> {
        const file = uploadedAudio(req, res);
        if (!file) return;
        const audio = audioOf(file);
        // One folder per student, and a fresh name each time, so recordings never overwrite each other.
        const userId = req.user?.id ?? 'unknown';
        const key = `${RECORDINGS_PREFIX}${userId}/${randomUUID()}.${extensionOf(file)}`;
        let audioUrl: string;
        try {
            await UploadToS3.putObject(key, audio.buffer, audio.mimetype);
            audioUrl = await UploadToS3.getPresignedUrl(key);
        } catch (err: any) {
            console.error('❌ Saving the recording to S3 failed:', err);
            res.status(500).send({ message: `Saving the recording failed: ${err.message}` });
            return;
        }
        try {
            // As in Django: a light nudge toward ordinary English, without hinting at any answer.
            const transcription = await transcribeAudio(audio, 'This is an English speaking practice answer.');
            res.json({ transcription, translation: await translateEnToVi(transcription), audioUrl });
        } catch (err: any) {
            console.error('❌ Transcription failed:', err);
            res.status(502).send({ message: `Transcription failed: ${err.message}`, transcription: '', translation: '', audioUrl });
        }
    }

    // POST /speech/shadowing — scores a Shadowing attempt with VoiceAnalyzer:
    // the multipart `audio` (16 kHz mono 16-bit WAV, as the Flutter app
    // records) and an `itemId` form field. The sentence, the reference (the
    // question's audio) and the scoring options are the question's, read here
    // so the app can't change what it's scored against. A connected-speech-only
    // question (targeted words, no stress words) may have no audio: linking is
    // checked in the recording alone. Nothing is saved.
    // → VoiceAnalyzer's evaluation, as the Django app's Shadowing gets it.
    public async shadowing(req: Request, res: Response): Promise<void> {
        const file = req.file;
        if (!file?.buffer?.length) {
            res.status(400).send({ message: "No audio file provided: send it as the multipart 'audio' field." });
            return;
        }
        if (file.buffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
            res.status(400).send({ message: 'The recording must be a WAV file (16 kHz mono, 16-bit).' });
            return;
        }
        const itemId = Number((req.body as { itemId?: string } | undefined)?.itemId);
        if (!Number.isInteger(itemId) || itemId <= 0) {
            res.status(400).send({ message: 'itemId is required.' });
            return;
        }
        const item = await prisma.questionItem.findUnique({
            where: { id: itemId },
            select: { format: true, questionText: true, scoringOptions: true, audio: { select: { id: true, s3Key: true } } },
        });
        if (!item) {
            res.status(404).send({ message: `Question item ${itemId} not found.` });
            return;
        }
        const sentence = plainText(item.questionText);
        if (item.format !== SHADOWING_FORMAT || !sentence) {
            res.status(400).send({ message: `Question item ${itemId} is not a Shadowing question with a sentence.` });
            return;
        }
        const options = item.scoringOptions as ScoringOptions | null;
        if (!item.audio && !connectedSpeechOnly(options)) {
            res.status(400).send({ message: `Question item ${itemId} has no audio to compare the recording with.` });
            return;
        }
        let reference: Buffer | null = null;
        if (item.audio) {
            try {
                reference = (await UploadToS3.getObjectBytes(item.audio.s3Key)).body;
            } catch (err) {
                console.error(`❌ Reading audio ${item.audio.id} (question ${itemId}) failed:`, err);
                res.status(502).send({ message: "The question's audio couldn't be read from S3." });
                return;
            }
        }
        try {
            res.json(await evaluateRecording(sentence, options, reference, file.buffer));
        } catch (err: any) {
            if (err instanceof VoiceAnalyzerError) {
                res.status(err.status).send({ message: err.message });
                return;
            }
            console.error('❌ Shadowing assessment failed:', err);
            res.status(500).send({ message: `Shadowing assessment failed: ${err.message}` });
        }
    }
}

export default new SpeechController();
