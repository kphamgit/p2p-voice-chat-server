import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import UploadToS3, { type ImageFolder } from '../controllers/upload_to_s3.js';

// Paste-to-upload for the admin's item forms: middleware that stores one
// image (multipart field "image") in `folder` (the item's folder with an :id
// in the route, else pending/), turning its errors into JSON instead of
// Express's default HTML error page: 400 for a bad image (too big, wrong
// type), 500 if S3 itself failed (AWS SDK errors carry $metadata).
export function uploadImageTo(folder: ImageFolder) {
    const upload = UploadToS3.imageUploadTo(folder).single('image');
    return (req: Request, res: Response, next: NextFunction): void => {
        upload(req, res, (err: unknown) => {
            if (!err) return next();
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                res.status(400).send({ message: 'Image is too large (max 5 MB).' });
                return;
            }
            const message = err instanceof Error ? err.message : 'Image upload failed.';
            if (typeof err === 'object' && err !== null && '$metadata' in err) {
                console.error('❌ Image upload to S3 failed:', err);
                res.status(500).send({ message: `Image upload to S3 failed: ${message}` });
                return;
            }
            res.status(400).send({ message });
        });
    };
}

// After uploadImageTo: return the stored image's public URL as { url }, for
// the client to put into the item's media as ![](<url>). It only stays if
// media that uses it is saved (see media.ts).
export function sendImageUrl(req: Request, res: Response): void {
    const file = req.file as (Express.Multer.File & { key?: string }) | undefined;
    if (!file?.key) {
        res.status(400).send({ message: 'Send the image as multipart form field "image".' });
        return;
    }
    res.status(201).json({ url: UploadToS3.publicUrl(file.key) });
}
