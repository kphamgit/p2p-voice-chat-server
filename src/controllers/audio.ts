import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { audioJson, createAudio, keywordsFrom } from '../audio.js';
import { prisma } from '../prisma.js';
import { isTtsProvider, TtsInputError } from '../tts.js';
import { analyzeReference, VoiceAnalyzerError } from '../voiceAnalyzer.js';
import UploadToS3 from './upload_to_s3.js';

// Question audio, for the admin's item form (see src/audio.ts): generate one,
// search the kept ones, keep one, download one, analyze one.

// Searches are capped.
const MAX_RESULTS = 200;

// The :id audio, or null after sending the 404.
async function findAudio(req: Request, res: Response) {
    const id = Number(req.params.id);
    const audio = Number.isInteger(id) ? await prisma.audio.findUnique({ where: { id } }) : null;
    if (!audio) res.status(404).send({ message: 'That audio no longer exists.' });
    return audio;
}

class AudioController {
    // POST /audios — speak { text, provider (google | elevenlabs), voice?, speed? }
    // and keep it. text may hold SSML / ElevenLabs tags; the audio's text is
    // the words only. → the audio (201). Unless a question uses it or it's
    // kept, it's deleted after a day.
    public async create(req: Request, res: Response): Promise<void> {
        const { text, provider = 'google', voice, speed } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof text !== 'string' || (voice !== undefined && voice !== null && typeof voice !== 'string')) {
            res.status(400).send({ message: 'Send { text, provider, voice?, speed? } with text and voice as strings.' });
            return;
        }
        if (!isTtsProvider(provider)) {
            res.status(400).send({ message: 'provider must be google or elevenlabs.' });
            return;
        }
        const rate = speed === undefined || speed === null || speed === '' ? undefined : Number(speed);
        if (rate !== undefined && !Number.isFinite(rate)) {
            res.status(400).send({ message: 'speed must be a number.' });
            return;
        }
        try {
            const audio = await createAudio(text, {
                provider,
                voice: (voice as string | undefined)?.trim() || undefined,
                speed: rate,
                createdById: req.user?.id ?? null,
            });
            res.status(201).json(audioJson(audio));
        } catch (err: any) {
            if (err instanceof TtsInputError) {
                res.status(400).send({ message: err.message });
                return;
            }
            console.error('❌ Generating an audio failed:', err);
            res.status(502).send({ message: `Generating the voice failed: ${err.message}` });
        }
    }

    // GET /audios?q=apology average — the kept audios, newest first. An audio
    // matches when every word of q is in its text or one of its keywords
    // (case-insensitive, partial words count: "apolog" finds "apology"). No q:
    // all of them. At most 200. → { audios: [...] }
    public async search(req: Request, res: Response): Promise<void> {
        const terms = String(req.query.q ?? '').split(/\s+/).filter(Boolean);
        try {
            let ids: number[] | undefined;
            if (terms.length) {
                const conditions = terms.map((t) => {
                    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
                    return Prisma.sql`(text ILIKE ${like} OR array_to_string(keywords, ' ') ILIKE ${like})`;
                });
                const found = await prisma.$queryRaw<{ id: number }[]>`
                    SELECT id FROM "Audio" WHERE kept AND ${Prisma.join(conditions, ' AND ')}
                    ORDER BY created_at DESC LIMIT ${MAX_RESULTS}`;
                ids = found.map((r) => r.id);
            }
            const rows = await prisma.audio.findMany({
                where: { kept: true, ...(ids && { id: { in: ids } }) },
                orderBy: { createdAt: 'desc' },
                take: MAX_RESULTS,
            });
            res.json({ audios: rows.map(audioJson) });
        } catch (err: any) {
            console.error('❌ Searching the audio library failed:', err);
            res.status(500).send({ message: `Searching the library failed: ${err.message}` });
        }
    }

    // PATCH /audios/:id — { kept?, keywords? ("apology, average" or a list) }.
    // Unkeeping an audio never deletes it while a question uses it.
    // → the audio.
    public async update(req: Request, res: Response): Promise<void> {
        const { kept, keywords } = (req.body ?? {}) as Record<string, unknown>;
        if (kept !== undefined && typeof kept !== 'boolean') {
            res.status(400).send({ message: 'kept must be true or false.' });
            return;
        }
        if (keywords !== undefined && typeof keywords !== 'string' && !Array.isArray(keywords)) {
            res.status(400).send({ message: 'keywords must be text or a list.' });
            return;
        }
        if (!(await findAudio(req, res))) return;
        const audio = await prisma.audio.update({
            where: { id: Number(req.params.id) },
            data: { kept, keywords: keywords === undefined ? undefined : keywordsFrom(keywords) },
        });
        res.json(audioJson(audio));
    }

    // GET /audios/:id/file — the MP3 itself, through the server (the browser
    // can't read the S3 link's bytes because of CORS), e.g. for the item
    // form's Download (as WAV).
    public async file(req: Request, res: Response): Promise<void> {
        const audio = await findAudio(req, res);
        if (!audio) return;
        try {
            const { body } = await UploadToS3.getObjectBytes(audio.s3Key);
            res.set('Content-Type', 'audio/mpeg');
            res.send(body);
        } catch (err) {
            console.error(`❌ Reading audio ${audio.id} failed:`, err);
            res.status(502).send({ message: 'The audio couldn\'t be read from S3.' });
        }
    }

    // POST /audios/:id/analyze — "Analyze reference audio" on a Shadowing
    // question: what VoiceAnalyzer measures in this audio alone (saying its
    // text) for { stressWords ("accept, apology"), stressSource (dictionary |
    // reference) }. Nothing is saved. → VoiceAnalyzer's reply, with each
    // word's spelled syllables.
    public async analyze(req: Request, res: Response): Promise<void> {
        const { stressWords, stressSource } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof stressWords !== 'string' || !stressWords.trim()) {
            res.status(400).send({ message: 'Type a stress word first.' });
            return;
        }
        const audio = await findAudio(req, res);
        if (!audio) return;
        let bytes: Buffer;
        try {
            bytes = (await UploadToS3.getObjectBytes(audio.s3Key)).body;
        } catch (err) {
            console.error(`❌ Reading audio ${audio.id} for analysis failed:`, err);
            res.status(502).send({ message: 'The audio couldn\'t be read from S3.' });
            return;
        }
        try {
            const source = stressSource === 'reference' ? 'reference' : 'dictionary';
            res.json(await analyzeReference(bytes, audio.text, stressWords.trim(), source));
        } catch (err: any) {
            if (err instanceof VoiceAnalyzerError) {
                res.status(err.status).send({ message: err.message });
                return;
            }
            console.error('❌ Analyzing the reference failed:', err);
            res.status(500).send({ message: `Analyzing the reference failed: ${err.message}` });
        }
    }
}

export default new AudioController();
