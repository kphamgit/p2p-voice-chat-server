// The audio library: the Audio table and its MP3s in S3 (see the Audio model in
// prisma/schema.prisma). The one way an audio comes into existence is
// createAudio (the admin's Generate voice); questions point to audios by id,
// and may share one. An audio is kept for good once `kept` is set; one that
// isn't kept and that no question uses is deleted after a day.
//
// The MP3s are public (the bucket policy grants s3:GetObject on
// audios/library/* and dev/audios/library/*), at audios/library/<uuid>.mp3
// (dev/audios/library/<uuid>.mp3 from a development server, see S3_PREFIX),
// and never overwritten.
//
// The rows are the source of truth: questions point to rows, and every write
// goes through them (file then row to create, row then file to delete).
// checkLibrary compares the folder with the rows, for the rare drift: a file
// no row points to (a failed save or delete, a reset database) or a row whose
// file is gone (deleted directly in S3).

import { randomUUID } from 'node:crypto';
import type { Audio } from '../generated/prisma/client.js';
import UploadToS3, { S3_PREFIX } from './controllers/upload_to_s3.js';
import { prisma } from './prisma.js';
import { synthesizeSpeech, voiceFor, type TtsProvider } from './tts.js';

export const AUDIO_PREFIX = `${S3_PREFIX}audios/library/`;

// An audio unused for this long (no question, not kept) is deleted.
const UNUSED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// What an audio says, as students see it: any <tag> (SSML, ElevenLabs breaks)
// removed and spaces collapsed.
export function plainText(text: unknown): string {
    return String(text ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// "apology, average; question intonation" (or a list) → lower-case, trimmed,
// no duplicates, at most 50 characters each.
export function keywordsFrom(value: unknown): string[] {
    const items = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
    const keywords: string[] = [];
    for (const item of items) {
        const k = String(item).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 50);
        if (k && !keywords.includes(k)) keywords.push(k);
    }
    return keywords;
}

// An audio as the API returns it, alone or inside a question item.
export function audioJson(audio: Audio) {
    return {
        id: audio.id,
        url: UploadToS3.publicUrl(audio.s3Key),
        text: audio.text,
        ttsText: audio.ttsText,
        provider: audio.provider,
        voice: audio.voice,
        speed: audio.speed,
        kept: audio.kept,
        keywords: audio.keywords,
        createdAt: audio.createdAt.toISOString(),
    };
}

export type AudioJson = ReturnType<typeof audioJson>;

// Speak `text` (which may hold SSML / ElevenLabs tags) and keep it: the MP3 in
// S3 and its Audio row. Throws TtsInputError for bad input.
export async function createAudio(
    text: string,
    options: { provider: TtsProvider; voice?: string; speed?: number; createdById?: number | null },
): Promise<Audio> {
    const { provider, speed, createdById } = options;
    const voice = voiceFor(provider, options.voice);
    const mp3 = await synthesizeSpeech(text, { provider, voice, rate: speed });
    const s3Key = `${AUDIO_PREFIX}${randomUUID()}.mp3`;
    await UploadToS3.putObject(s3Key, mp3, 'audio/mpeg');
    const plain = plainText(text);
    try {
        return await prisma.audio.create({
            data: {
                s3Key,
                text: plain,
                ttsText: text.trim() === plain ? '' : text.trim(),
                provider,
                voice,
                speed: speed ?? null,
                createdById: createdById ?? null,
            },
        });
    } catch (err) {
        // Keep S3 and the table in step: no row, no file.
        await UploadToS3.deleteObject(s3Key).catch(() => {});
        throw err;
    }
}

// Delete the audios (rows and MP3s) that no question uses, aren't kept, and
// are more than a day old: voices generated in a form that was
// never saved, voices a regeneration replaced, and those of deleted questions.
export async function deleteUnusedAudios(): Promise<void> {
    const unused = {
        kept: false,
        createdAt: { lt: new Date(Date.now() - UNUSED_MAX_AGE_MS) },
        questionAudios: { none: {} },
        questionTrailings: { none: {} },
    };
    const rows = await prisma.audio.findMany({ where: unused, select: { id: true, s3Key: true } });
    if (rows.length === 0) return;
    // Rows first (only those still unused, in case one was just picked), then
    // their files: a leftover file is harmless, a row without its file isn't.
    const { count } = await prisma.audio.deleteMany({ where: { ...unused, id: { in: rows.map((r) => r.id) } } });
    const stillThere = new Set(
        (await prisma.audio.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id),
    );
    await UploadToS3.deleteKeys(rows.filter((r) => !stillThere.has(r.id)).map((r) => r.s3Key));
    console.log(`🧹 Deleted ${count} unused audio(s)`);
}

// Delete one audio now: its row, then its file. The database refuses (Prisma
// P2003 / P2014) while a question uses it.
export async function deleteAudio(audio: Audio): Promise<void> {
    await prisma.audio.delete({ where: { id: audio.id } });
    await UploadToS3.deleteObject(audio.s3Key);
}

export interface StrayFile {
    key: string;
    size: number;
    lastModified: Date;
}

// The library folder compared with the Audio rows: the files no row points to
// (oldest first), and the rows whose file isn't in the folder.
export async function checkLibrary(): Promise<{ strayFiles: StrayFile[]; missingFiles: Audio[] }> {
    const objects = await UploadToS3.listObjects(AUDIO_PREFIX);
    const rows = await prisma.audio.findMany({ where: { s3Key: { startsWith: AUDIO_PREFIX } } });
    const rowKeys = new Set(rows.map((r) => r.s3Key));
    const fileKeys = new Set(objects.map((o) => o.key));
    return {
        strayFiles: objects
            .filter((o) => !rowKeys.has(o.key))
            .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime()),
        missingFiles: rows.filter((r) => !fileKeys.has(r.s3Key)),
    };
}

// The stray-file cleanup deletes at most this many per run, so a wrong
// database (e.g. an empty one by mistake) can't wipe the folder in one go.
const MAX_STRAY_DELETES = 200;

// Delete the library files no row points to that are more than a day old
// (younger ones may belong to a save still in progress). Does nothing while
// the Audio table is empty, which looks more like a wrong database than a
// folder of strays.
export async function deleteStrayFiles(): Promise<void> {
    if ((await prisma.audio.count()) === 0) return;
    const { strayFiles } = await checkLibrary();
    const old = strayFiles.filter((f) => f.lastModified.getTime() < Date.now() - UNUSED_MAX_AGE_MS);
    const keys = old.slice(0, MAX_STRAY_DELETES).map((f) => f.key);
    if (keys.length === 0) return;
    // Check again right before deleting: a row may have just been made.
    const taken = new Set(
        (await prisma.audio.findMany({ where: { s3Key: { in: keys } }, select: { s3Key: true } })).map((r) => r.s3Key),
    );
    const doomed = keys.filter((k) => !taken.has(k));
    await UploadToS3.deleteKeys(doomed);
    console.log(`🧹 Deleted ${doomed.length} stray library file(s)${old.length > keys.length ? ` (${old.length - keys.length} left for the next run)` : ''}`);
}
