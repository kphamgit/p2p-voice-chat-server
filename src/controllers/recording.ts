import { Request, Response } from 'express';
import { prisma } from '../prisma.js';
import UploadToS3 from './upload_to_s3.js';

class RecordingController {
    // POST /recordings — accepts a multipart upload from the voice-chat client:
    // an `audio` file (the mixed call) plus localPeerId / remotePeerId fields.
    // UploadToS3 (see routes/recording.ts) has already streamed the file to S3 by
    // the time this runs, so req.file carries the S3 location/key (not a buffer).
    public async create(req: Request, res: Response): Promise<void> {
        // multer-s3 has already streamed the file to S3 before this handler runs,
        // so `file` exists regardless of whether the DB write below succeeds.
        const file = req.file as Express.MulterS3.File | undefined;
        // Tracks whether the row was committed, so the catch block knows whether
        // the S3 object is an orphan (row failed) or legitimately paired (row ok).
        let rowCreated = false;
        try {
            if (!file) {
                res.status(400).send({ message: "Missing 'audio' file in upload." });
                return;
            }

            const { localPeerId = '', remotePeerId = '' } = req.body as {
                localPeerId?: string;
                remotePeerId?: string;
            };

            // The file is already on S3 (file.location is its URL); persist a row.
            const recording = await prisma.recording.create({
                data: {
                    url: file.location,
                    s3Key: file.key,
                    localPeerId,
                    remotePeerId,
                },
            });
            rowCreated = true;

            console.log(
                `Recording saved (id ${recording.id}): ${file.location} ` +
                `(${file.size} bytes) from ${localPeerId} <-> ${remotePeerId}`
            );

            // Bucket is private, so return a temporary presigned URL to play it.
            const playUrl = await UploadToS3.getPresignedUrl(recording.s3Key);

            res.status(201).send({
                message: 'Recording uploaded.',
                id: recording.id,
                playUrl,
                expiresInSeconds: 3600,
                size: file.size,
                localPeerId,
                remotePeerId,
            });
        } catch (err: any) {
            // Compensating delete: if the row never committed, the S3 file (already
            // uploaded by multer-s3) is an orphan — remove it so S3 and the DB stay
            // in sync. If the row DID commit (e.g. presigning failed afterward),
            // leave the file: it's correctly paired and the client can re-fetch a
            // URL via GET /recordings/:id/url.
            if (file?.key && !rowCreated) {
                await UploadToS3.deleteObject(file.key).catch((e) =>
                    console.error(`Failed to clean up orphaned S3 object ${file.key}:`, e)
                );
            }
            res.status(500).send({ message: err.message || 'Error saving recording.' });
        }
    }

    // GET /recordings/:id/url — return a fresh presigned URL to play a recording
    // (the bucket is private, so the stored URL isn't directly accessible).
    public async getUrl(req: Request, res: Response): Promise<void> {
        try {
            const id = BigInt(String(req.params.id));
            const recording = await prisma.recording.findUnique({ where: { id } });
            if (!recording) {
                res.status(404).send({ message: `Cannot find recording with id=${req.params.id}.` });
                return;
            }
            const url = await UploadToS3.getPresignedUrl(recording.s3Key);
            res.send({ url, expiresInSeconds: 3600 });
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error generating URL.' });
        }
    }

    // DELETE /recordings/:id — remove the recording from S3 and the database.
    // S3 first, then the row: if the S3 delete fails we keep the row (and the
    // file) so it can be retried, rather than orphaning the object.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = BigInt(String(req.params.id));
            const recording = await prisma.recording.findUnique({ where: { id } });
            if (!recording) {
                res.status(404).send({ message: `Cannot find recording with id=${req.params.id}.` });
                return;
            }
            // S3 delete is idempotent (deleting a missing key still succeeds).
            await UploadToS3.deleteObject(recording.s3Key);
            await prisma.recording.delete({ where: { id } });
            console.log(`Recording deleted (id ${id}): ${recording.s3Key}`);
            res.status(204).send();
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error deleting recording.' });
        }
    }
}

export default new RecordingController();
