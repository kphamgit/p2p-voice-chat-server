import "dotenv/config";
import { Request } from 'express';
import { randomUUID } from 'node:crypto';

import multerS3 from 'multer-s3';
import multer from 'multer';

import {
    S3ClientConfigType,
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    CopyObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
} from '@aws-sdk/client-s3'
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Put in front of every key of the files the server stores (question audio,
// item images, recordings), so a development server's files stay apart from
// the live ones in the shared bucket: "dev/" in a local .env, unset (no
// prefix) on the live server. S3_PREFIX=dev and S3_PREFIX=dev/ mean the same.
export const S3_PREFIX = (process.env['S3_PREFIX'] ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/.+/, '$&/');

// Students' recordings: private, played through presigned URLs.
export const RECORDINGS_PREFIX = `${S3_PREFIX}audios/recordings/`;

// This app's own bucket (S3_BUCKET) and its region (S3_REGION, default
// us-east-2). Required, with no default: the old shared bucket "phuyenenglish"
// belongs to the Django app now, and a missing setting must never send files
// (or the cleanups' deletes) there.
const S3_BUCKET = (process.env['S3_BUCKET'] ?? '').trim();
if (!S3_BUCKET) throw new Error('S3_BUCKET is not set: put this app\'s bucket name in .env.');
const S3_REGION = (process.env['S3_REGION'] ?? '').trim() || 'us-east-2';

class UploadToS3 {
    // No credentials block: the AWS SDK auto-loads them from the environment
    // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, a key of the IAM user
    // tienganhtuyhoa-server, allowed on this bucket only);
    // the advantage of auto-load is you can use an IAM role on AWS infra.
    config: S3ClientConfigType = {
        region: S3_REGION,
    }

    bucket = S3_BUCKET;

    s3 = new S3Client(this.config);

    // Generate a temporary signed URL to READ/play an object (e.g. an uploaded
    // recording). `key` is the S3 object key (req.file.key from multer-s3).
    // expiresIn is in seconds (default 1 hour).
    getPresignedUrl = async (key: string, expiresIn = 3600): Promise<string> => {
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
        return getSignedUrl(this.s3, command, { expiresIn });
    };

    // Delete an object from the bucket. Used as a compensating action when a DB
    // write fails after the file was already uploaded (keeps S3 and the DB in
    // sync), and by any future recording-delete flow.
    deleteObject = async (key: string): Promise<void> => {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    };

    // --- Public files (item images and question audio) ------------------------
    // Everything under images/ and question-audios/ (and dev/images/ and
    // dev/question-audios/, see S3_PREFIX) is meant to be publicly readable (a
    // bucket policy grants s3:GetObject on them), so clients load these by
    // plain URL; recordings (RECORDINGS_PREFIX) stay private and use presigned
    // URLs.

    publicBaseUrl = `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/`;

    publicUrl = (key: string): string => this.publicBaseUrl + key;

    // The key of one of our public URLs, or null for any other URL (e.g. YouTube).
    keyFromPublicUrl = (url: string): string | null =>
        url.startsWith(this.publicBaseUrl) ? url.slice(this.publicBaseUrl.length) : null;

    // Every object under a prefix, with when it was stored and its size in bytes (follows pagination).
    listObjects = async (prefix: string): Promise<{ key: string; lastModified: Date; size: number }[]> => {
        const objects: { key: string; lastModified: Date; size: number }[] = [];
        let token: string | undefined;
        do {
            const page = await this.s3.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
            );
            for (const obj of page.Contents ?? []) {
                if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified ?? new Date(0), size: obj.Size ?? 0 });
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        return objects;
    };

    // An object's bytes and content type (e.g. a recording to send for assessment).
    getObjectBytes = async (key: string): Promise<{ body: Buffer; contentType: string | undefined }> => {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!res.Body) throw new Error(`S3 object ${key} has no body.`);
        return { body: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType };
    };

    // Every key under a prefix.
    listKeys = async (prefix: string): Promise<string[]> =>
        (await this.listObjects(prefix)).map((o) => o.key);

    // Delete many objects (S3 takes at most 1000 per request).
    deleteKeys = async (keys: string[]): Promise<void> => {
        for (let i = 0; i < keys.length; i += 1000) {
            const batch = keys.slice(i, i + 1000);
            const res = await this.s3.send(
                new DeleteObjectsCommand({
                    Bucket: this.bucket,
                    Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
                }),
            );
            if (res.Errors?.length) {
                throw new Error(`S3 could not delete ${res.Errors.length} object(s): ${res.Errors[0]?.Message}`);
            }
        }
    };

    // Store a file we made on the server (e.g. generated speech). Keys are
    // never reused, so it may be cached forever.
    putObject = async (key: string, body: Buffer, contentType: string): Promise<void> => {
        await this.s3.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: contentType,
                CacheControl: 'public, max-age=31536000, immutable',
            }),
        );
    };

    copyObject = async (fromKey: string, toKey: string): Promise<void> => {
        await this.s3.send(
            new CopyObjectCommand({
                Bucket: this.bucket,
                CopySource: `${this.bucket}/${fromKey}`,
                Key: toKey,
            }),
        );
    };

    // Image types we accept, with the file extension each is saved under.
    static IMAGE_EXTENSIONS: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
    };

    // Upload middleware for one item image (multipart field "image") in
    // `folder`, e.g. images/question-items/<item id>/<random>.<ext>: the item id
    // never changes, and the random name avoids clashes (pasted images are all
    // "image.png"). Names are never reused, so browsers may cache them forever.
    // Without an :id in the route (an item not saved yet), the image goes to
    // the folder's pending/ and moves to the item's folder when the item is
    // saved (see media.ts).
    imageUploadTo = (folder: ImageFolder) => multer({
        limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB cap
        fileFilter: (_req, file, cb) => {
            if (UploadToS3.IMAGE_EXTENSIONS[file.mimetype]) {
                cb(null, true);
            } else {
                cb(new Error(`Unsupported image type "${file.mimetype}" (use PNG, JPEG, GIF or WebP).`));
            }
        },
        storage: multerS3({
            s3: this.s3,
            bucket: this.bucket,
            contentType: (_req, file, cb) => cb(null, file.mimetype),
            cacheControl: 'public, max-age=31536000, immutable',
            key: (req: Request, file, cb) => {
                const ext = UploadToS3.IMAGE_EXTENSIONS[file.mimetype];
                const prefix = req.params.id ? folder.item(Number(req.params.id)) : folder.pending;
                cb(null, `${prefix}${randomUUID()}.${ext}`);
            },
        }),
    });

    upload = multer({
        limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap
        storage: multerS3({
            s3: this.s3,
            bucket: this.bucket,
            contentType: multerS3.AUTO_CONTENT_TYPE,
            key: (_req: Request, file, cb) => {
                // Don't read req.body here: multer-s3's key runs mid-stream, before
                // form fields appended after the file are parsed, so they'd be
                // undefined. The filename already includes a timestamp.
                cb(null, `${RECORDINGS_PREFIX}${file.originalname}`);
            }
        })
    });
};

// Where one kind of item keeps its images (see media.ts). Each kind has its
// own folder because question item and text item ids overlap: question item 5
// and text item 5 must not share images/…/5/.
export interface ImageFolder {
    kind: string; // for log messages, e.g. "question item"
    pending: string; // images pasted into an item that hasn't been saved yet
    // An item's own images. Ends with "/" so item 4's prefix doesn't also
    // match item 42's images.
    item: (itemId: number) => string;
}

export const QUESTION_ITEM_IMAGES: ImageFolder = {
    kind: 'question item',
    pending: `${S3_PREFIX}images/question-items/pending/`,
    item: (itemId) => `${S3_PREFIX}images/question-items/${itemId}/`,
};

export const TEXT_ITEM_IMAGES: ImageFolder = {
    kind: 'text item',
    pending: `${S3_PREFIX}images/text-items/pending/`,
    item: (itemId) => `${S3_PREFIX}images/text-items/${itemId}/`,
};

export const IMAGE_FOLDERS = [QUESTION_ITEM_IMAGES, TEXT_ITEM_IMAGES];

export default new UploadToS3();
