import { Request, Response } from 'express';
import UploadToS3 from './upload_to_s3.js';
import { prisma } from '../prisma.js';
import { assessWithTonePerfect, isTonePerfectConfigured } from '../tonePerfect.js';
import { assessPronunciationInDetail, isAzureSpeechConfigured } from '../azureSpeech.js';
import { toWav16kMono } from '../audioConvert.js';
import { summarizeAzure, summarizeTonePerfect } from '../assessmentSummary.js';

// The admin's Speech Assessment tab: browse students' recordings in S3 and
// score one with TonePerfect (see src/tonePerfect.ts) or Azure (see
// src/azureSpeech.ts), to compare the two. Ported from
// the Django app's get_s3_recordings, which lists the same folder.

// Students' recordings. The kinds of name found there:
//   <student>_<date and time>.webm, the date and time written several ways
//     (nhatminh_19-37-55_6_7_2026, boingoc_10_17_2026_9_19_43_AM, ...)
//   <userId>/<uuid>.<ext>      (this server's transcribe-and-save)
//   call-<a>-and-<b>-<ms>.webm (voice-chat calls, two speakers: listed apart)
const RECORDINGS_PREFIX = 'audios/recordings/';

const STUDENT_NAME = /^([^_/]+)_[^/]+\.[a-z0-9]+$/i;
const USER_FOLDER = /^(\d+)\/[^/]+\.[a-z0-9]+$/i;
const CALL = /^call-[^/]+\.[a-z0-9]+$/i;

const MIME_TYPES: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
};

interface Recording {
    key: string;
    student: string;
    recordedAt: string; // when it was stored in S3 (ISO)
    size: number; // bytes
}

// Whether `key` names a recording (and nothing outside the recordings folder).
const isRecordingKey = (key: unknown): key is string =>
    typeof key === 'string' && key.startsWith(RECORDINGS_PREFIX) && !key.includes('..');

const extensionOf = (key: string) => /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase() ?? '';

// Every recording with its student's name. Folder recordings are named by the
// user's id; their usernames are looked up.
async function allRecordings(): Promise<Recording[]> {
    const objects = (await UploadToS3.listObjects(RECORDINGS_PREFIX)).filter(
        (o) => o.size > 0 && MIME_TYPES[extensionOf(o.key)],
    );
    const userIds = new Set<number>();
    for (const o of objects) {
        const id = USER_FOLDER.exec(o.key.slice(RECORDINGS_PREFIX.length))?.[1];
        if (id) userIds.add(Number(id));
    }
    const users = userIds.size
        ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
        : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return objects.map((o) => {
        const rest = o.key.slice(RECORDINGS_PREFIX.length);
        const userId = USER_FOLDER.exec(rest)?.[1];
        const student = CALL.test(rest)
            ? '(voice calls)'
            : userId
              ? (names.get(Number(userId)) ?? `user ${userId}`)
              : (STUDENT_NAME.exec(rest)?.[1] ?? '(other)');
        return { key: o.key, student, recordedAt: o.lastModified.toISOString(), size: o.size };
    });
}

export default class SpeechAssessmentController {
    // GET /speech-assessment/students — the students with recordings:
    // [{ student, count, latest }], by name.
    static async students(_req: Request, res: Response): Promise<void> {
        try {
            const byStudent = new Map<string, { student: string; count: number; latest: string }>();
            for (const r of await allRecordings()) {
                const entry = byStudent.get(r.student) ?? { student: r.student, count: 0, latest: r.recordedAt };
                entry.count++;
                if (r.recordedAt > entry.latest) entry.latest = r.recordedAt;
                byStudent.set(r.student, entry);
            }
            res.json([...byStudent.values()].sort((a, b) => a.student.localeCompare(b.student)));
        } catch (err: any) {
            console.error('❌ Listing recordings failed:', err);
            res.status(500).send({ message: `Listing the recordings failed: ${err.message}` });
        }
    }

    // GET /speech-assessment/recordings?student=<name> — that student's
    // recordings, newest first, each with a presigned URL to play it (an hour).
    static async recordings(req: Request, res: Response): Promise<void> {
        const student = typeof req.query['student'] === 'string' ? req.query['student'] : '';
        if (!student) {
            res.status(400).send({ message: 'student is required.' });
            return;
        }
        try {
            const recordings = (await allRecordings())
                .filter((r) => r.student === student)
                .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
            res.json(
                await Promise.all(recordings.map(async (r) => ({ ...r, url: await UploadToS3.getPresignedUrl(r.key) }))),
            );
        } catch (err: any) {
            console.error('❌ Listing recordings failed:', err);
            res.status(500).send({ message: `Listing the recordings failed: ${err.message}` });
        }
    }

    // GET /speech-assessment/audio?key=<recording key> — the recording's bytes,
    // for the tab's Download WAV (the browser converts them; S3 itself isn't
    // open to the admin site's requests).
    static async audio(req: Request, res: Response): Promise<void> {
        const key = req.query['key'];
        if (!isRecordingKey(key) || !MIME_TYPES[extensionOf(key)]) {
            res.status(400).send({ message: `key must be a recording under ${RECORDINGS_PREFIX}.` });
            return;
        }
        try {
            const { body } = await UploadToS3.getObjectBytes(key);
            res.type(MIME_TYPES[extensionOf(key)]!).send(body);
        } catch (err: any) {
            res.status(404).send({ message: `Could not read ${key} from S3: ${err.message}` });
        }
    }

    // POST /speech-assessment/assess { key, text, provider (toneperfect or
    // azure), language? (default en-US; TonePerfect only, Azure is always
    // en-US) } — scores the recording and answers { provider, summary, raw }:
    // summary in the shape of src/assessmentSummary.ts, raw the provider's
    // reply as is. TonePerfect uses up one of the account's tries; Azure needs
    // the recording converted to WAV first (ffmpeg).
    static async assess(req: Request, res: Response): Promise<void> {
        const { key, text, provider, language = 'en-US' } = (req.body ?? {}) as {
            key?: unknown;
            text?: unknown;
            provider?: unknown;
            language?: unknown;
        };
        if (provider !== 'toneperfect' && provider !== 'azure') {
            res.status(400).send({ message: 'provider must be toneperfect or azure.' });
            return;
        }
        if (provider === 'toneperfect' && !isTonePerfectConfigured()) {
            res.status(503).send({ message: 'TonePerfect is not set up on the server (TONEPERFECT_API_KEY is missing).' });
            return;
        }
        if (provider === 'azure' && !isAzureSpeechConfigured()) {
            res.status(503).send({ message: 'Azure is not set up on the server (AZURE_SPEECH_KEY or AZURE_SERVICE_REGION is missing).' });
            return;
        }
        if (!isRecordingKey(key)) {
            res.status(400).send({ message: `key must be a recording under ${RECORDINGS_PREFIX}.` });
            return;
        }
        if (typeof text !== 'string' || !text.trim()) {
            res.status(400).send({ message: 'text (what the student was meant to say) is required.' });
            return;
        }
        if (typeof language !== 'string' || !language.trim()) {
            res.status(400).send({ message: 'language must be text, e.g. en-US.' });
            return;
        }
        const ext = extensionOf(key);
        const mimetype = MIME_TYPES[ext];
        if (!mimetype) {
            res.status(400).send({ message: 'TonePerfect takes WAV, MP3, M4A, Ogg or WebM recordings.' });
            return;
        }
        let audio: Buffer;
        try {
            audio = (await UploadToS3.getObjectBytes(key)).body;
        } catch (err: any) {
            res.status(404).send({ message: `Could not read ${key} from S3: ${err.message}` });
            return;
        }
        const sentence = text.trim();
        if (provider === 'azure') {
            let wav: Buffer;
            try {
                wav = await toWav16kMono(audio);
            } catch (err: any) {
                res.status(500).send({ message: err.message });
                return;
            }
            try {
                const raw = await assessPronunciationInDetail(wav, sentence);
                res.json({ provider, summary: summarizeAzure(raw, sentence), raw });
            } catch (err: any) {
                console.error('❌ Azure assessment failed:', err);
                res.status(502).send({ message: err.message });
            }
            return;
        }
        try {
            const raw = await assessWithTonePerfect({
                audio,
                filename: `recording.${ext}`,
                mimetype,
                text: sentence,
                language: language.trim(),
            });
            res.json({ provider, summary: summarizeTonePerfect(raw, sentence), raw });
        } catch (err: any) {
            console.error('❌ TonePerfect assessment failed:', err);
            res.status(502).send({ message: err.message });
        }
    }
}
