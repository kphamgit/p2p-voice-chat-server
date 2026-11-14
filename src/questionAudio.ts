// Keeps a question item's audio (MP3s of generated speech) in S3 in step
// with its `audio` and `trailingAudio` fields, the way media.ts does for
// images. Both live in the item's one folder, question-audios/<item id>/.
//
// The admin's item form generates a voice (generateQuestionAudio), which is
// stored under question-audios/pending/ so it can be heard and regenerated
// before anything is saved. Saving the item with that URL moves the file into
// question-audios/<item id>/ (adoptPendingAudio) and deletes the item's other
// audio files (deleteUnusedAudio). Pending files nobody saved are deleted
// after a day (deleteStalePendingAudio).

import { randomUUID } from 'node:crypto';
import UploadToS3, { PENDING_AUDIO_PREFIX, questionItemAudioPrefix } from './controllers/upload_to_s3.js';
import { synthesizeSpeech, type TtsProvider } from './tts.js';

// Speak `text` and store it as a pending MP3; returns its public URL.
export async function generateQuestionAudio(
    text: string,
    options: { provider?: TtsProvider; rate?: number; voice?: string },
): Promise<string> {
    const audio = await synthesizeSpeech(text, options);
    const key = `${PENDING_AUDIO_PREFIX}${randomUUID()}.mp3`;
    await UploadToS3.putObject(key, audio, 'audio/mpeg');
    return UploadToS3.publicUrl(key);
}

// Whether `audio` may be saved on the item: null, a pending file, or one of
// the item's own files (itemId undefined: an item being created). Anything
// else, e.g. another item's audio or an outside link, is refused.
export function isAllowedAudio(audio: unknown, itemId?: number): boolean {
    if (audio === null) return true;
    if (typeof audio !== 'string') return false;
    const key = UploadToS3.keyFromPublicUrl(audio);
    if (!key?.endsWith('.mp3')) return false;
    return key.startsWith(PENDING_AUDIO_PREFIX) || (itemId !== undefined && key.startsWith(questionItemAudioPrefix(itemId)));
}

// If `audio` is a pending file, copy it into the item's folder and return the
// copy's URL (and the pending key, to delete once the new URL is saved);
// otherwise return it unchanged.
export async function adoptPendingAudio(
    itemId: number,
    audio: string | null,
): Promise<{ audio: string | null; adoptedKey: string | null }> {
    const key = audio ? UploadToS3.keyFromPublicUrl(audio) : null;
    if (!key?.startsWith(PENDING_AUDIO_PREFIX)) return { audio, adoptedKey: null };
    const toKey = questionItemAudioPrefix(itemId) + key.slice(PENDING_AUDIO_PREFIX.length);
    await UploadToS3.copyObject(key, toKey);
    return { audio: UploadToS3.publicUrl(toKey), adoptedKey: key };
}

// Delete the item's audio files other than those in `keep` (its saved audio
// and trailing audio; all of them for []), e.g. the one a regenerated voice
// replaced. Run after saving the item.
export async function deleteUnusedAudio(itemId: number, keep: (string | null)[]): Promise<void> {
    const used = new Set(keep.map((url) => (url ? UploadToS3.keyFromPublicUrl(url) : null)).filter(Boolean));
    const unused = (await UploadToS3.listKeys(questionItemAudioPrefix(itemId))).filter((key) => !used.has(key));
    if (unused.length) {
        await UploadToS3.deleteKeys(unused);
        console.log(`🧹 Deleted ${unused.length} unused audio file(s) of question item ${itemId}`);
    }
}

// For a cloned item: copy the source's audio into the copy's folder and
// return its URL, so deleting one item never breaks the other.
export async function copyAudio(audio: string | null, fromId: number, toId: number): Promise<string | null> {
    const key = audio ? UploadToS3.keyFromPublicUrl(audio) : null;
    if (!key?.startsWith(questionItemAudioPrefix(fromId))) return null;
    const toKey = `${questionItemAudioPrefix(toId)}${randomUUID()}.mp3`;
    await UploadToS3.copyObject(key, toKey);
    return UploadToS3.publicUrl(toKey);
}

// Voices generated in a form that was closed without saving.
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function deleteStalePendingAudio(): Promise<void> {
    const cutoff = Date.now() - PENDING_MAX_AGE_MS;
    const stale = (await UploadToS3.listObjects(PENDING_AUDIO_PREFIX))
        .filter((o) => o.lastModified.getTime() < cutoff)
        .map((o) => o.key);
    if (stale.length) {
        await UploadToS3.deleteKeys(stale);
        console.log(`🧹 Deleted ${stale.length} unsaved pending audio file(s)`);
    }
}
