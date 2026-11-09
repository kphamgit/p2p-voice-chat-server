// Keeps a question item's images in S3 in step with its `media` text.
//
// `media` is free text with images inline as Markdown, ![](<url>), where the
// URL is a public S3 URL under images/question-items/<item id>/ (see
// UploadToS3.imageUpload). Other URLs, e.g. a YouTube link, are left alone.
// The text is the source of truth: an image is in use exactly when its URL
// appears in the item's media.
//
// Images pasted before the item exists go to images/question-items/pending/;
// saving the item moves the ones its media uses into its own folder
// (adoptPendingImages), and pending images left unsaved are deleted after a
// day (deleteStalePendingImages).

import { randomUUID } from 'node:crypto';
import UploadToS3, { PENDING_IMAGE_PREFIX, questionItemImagePrefix } from './controllers/upload_to_s3.js';

// Every https URL in the text (Markdown wraps them in "(...)").
const URL_PATTERN = /https:\/\/[^\s)]+/g;

// The S3 keys under `prefix` that the media text uses.
function keysUnder(media: string | null, prefix: string): Set<string> {
    const keys = new Set<string>();
    for (const url of media?.match(URL_PATTERN) ?? []) {
        const key = UploadToS3.keyFromPublicUrl(url);
        if (key?.startsWith(prefix)) keys.add(key);
    }
    return keys;
}

// The S3 keys of this item's own images that the media text uses.
function usedImageKeys(media: string | null, itemId: number): Set<string> {
    return keysUnder(media, questionItemImagePrefix(itemId));
}

// Move the pending images that the media text uses into the item's folder
// (keeping their names) and return the media pointing at the moved copies,
// or the media unchanged if it uses none. The pending originals are deleted
// once the caller has saved the new media; until then both exist, so a
// failure part-way never leaves the saved text pointing at nothing.
export async function adoptPendingImages(
    itemId: number,
    media: string | null,
): Promise<{ media: string | null; adoptedKeys: string[] }> {
    const pending = [...keysUnder(media, PENDING_IMAGE_PREFIX)];
    if (!media || pending.length === 0) return { media, adoptedKeys: [] };
    let result = media;
    for (const fromKey of pending) {
        const toKey = questionItemImagePrefix(itemId) + fromKey.slice(PENDING_IMAGE_PREFIX.length);
        await UploadToS3.copyObject(fromKey, toKey);
        result = result.replaceAll(UploadToS3.publicUrl(fromKey), UploadToS3.publicUrl(toKey));
    }
    return { media: result, adoptedKeys: pending };
}

// Pending images older than this were pasted into a form that was never
// saved (or was saved without them), so they can go.
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function deleteStalePendingImages(): Promise<void> {
    const cutoff = Date.now() - PENDING_MAX_AGE_MS;
    const stale = (await UploadToS3.listObjects(PENDING_IMAGE_PREFIX))
        .filter((o) => o.lastModified.getTime() < cutoff)
        .map((o) => o.key);
    if (stale.length) {
        await UploadToS3.deleteKeys(stale);
        console.log(`🧹 Deleted ${stale.length} unsaved pending image(s)`);
    }
}

// Delete the item's images that its media no longer uses, e.g. ones pasted
// and then removed from the text. Run after saving the item's media.
export async function deleteUnusedImages(itemId: number, media: string | null): Promise<void> {
    const used = usedImageKeys(media, itemId);
    const stored = await UploadToS3.listKeys(questionItemImagePrefix(itemId));
    const unused = stored.filter((key) => !used.has(key));
    if (unused.length) {
        await UploadToS3.deleteKeys(unused);
        console.log(`🧹 Deleted ${unused.length} unused image(s) of question item ${itemId}`);
    }
}

// Delete all of a (deleted) item's images.
export async function deleteAllImages(itemId: number): Promise<void> {
    const keys = await UploadToS3.listKeys(questionItemImagePrefix(itemId));
    if (keys.length) await UploadToS3.deleteKeys(keys);
}

// For a cloned item: copy the source item's images to the copy's own folder
// and return the media text pointing at the copies. That way the two items
// never share a file, and deleting one can't break the other.
export async function copyImages(media: string | null, fromId: number, toId: number): Promise<string | null> {
    if (!media) return media;
    let result = media;
    for (const fromKey of usedImageKeys(media, fromId)) {
        const ext = fromKey.slice(fromKey.lastIndexOf('.'));
        const toKey = `${questionItemImagePrefix(toId)}${randomUUID()}${ext}`;
        await UploadToS3.copyObject(fromKey, toKey);
        result = result.replaceAll(UploadToS3.publicUrl(fromKey), UploadToS3.publicUrl(toKey));
    }
    return result;
}
