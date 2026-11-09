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
} from '@aws-sdk/client-s3'
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

class UploadToS3 {
    // No credentials block: the AWS SDK auto-loads them from the environment
    // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), 
    // the advantage of auto-load is you can use an IAM role on AWS infra.
    config: S3ClientConfigType = {
        region: 'us-east-2',
    }

    bucket = 'phuyenenglish';

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

    // --- Public images (question item media) ---------------------------------
    // Everything under images/ is meant to be publicly readable (a bucket policy
    // grants s3:GetObject on images/*), so clients load these by plain URL;
    // recordings under audios/ stay private and use presigned URLs.

    publicBaseUrl = `https://${this.bucket}.s3.${this.config.region}.amazonaws.com/`;

    publicUrl = (key: string): string => this.publicBaseUrl + key;

    // The key of one of our public URLs, or null for any other URL (e.g. YouTube).
    keyFromPublicUrl = (url: string): string | null =>
        url.startsWith(this.publicBaseUrl) ? url.slice(this.publicBaseUrl.length) : null;

    // Every object under a prefix, with when it was stored (follows pagination).
    listObjects = async (prefix: string): Promise<{ key: string; lastModified: Date }[]> => {
        const objects: { key: string; lastModified: Date }[] = [];
        let token: string | undefined;
        do {
            const page = await this.s3.send(
                new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
            );
            for (const obj of page.Contents ?? []) {
                if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified ?? new Date(0) });
            }
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
        return objects;
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

    // Upload middleware for one question item image (multipart field "image").
    // Saved as images/question-items/<item id>/<random>.<ext>: the item id never
    // changes, and the random name avoids clashes (pasted images are all
    // "image.png"). Names are never reused, so browsers may cache them forever.
    // Without an :id in the route (an item not saved yet), the image goes to
    // images/question-items/pending/ and moves to the item's folder when the
    // item is saved (see media.ts).
    imageUpload = multer({
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
                const prefix = req.params.id ? questionItemImagePrefix(Number(req.params.id)) : PENDING_IMAGE_PREFIX;
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
                cb(null, `audios/recordings/${file.originalname}`);
            }
        })
    });
};

// Images pasted into an item that hasn't been saved yet.
export const PENDING_IMAGE_PREFIX = 'images/question-items/pending/';

// Where a question item's images live. Ends with "/" so item 4's prefix
// doesn't also match item 42's images.
export function questionItemImagePrefix(itemId: number): string {
    return `images/question-items/${itemId}/`;
}

export default new UploadToS3();
