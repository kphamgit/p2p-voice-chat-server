import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import SpeechController from '../controllers/speech.js';
import { MAX_TRANSCRIBE_BYTES } from '../openai.js';

const router = Router();

// The recording (multipart field "audio") is kept in memory: it goes to
// OpenAI (and, for transcribe-and-save, to S3) from the buffer. Multer's
// errors become JSON, e.g. 400 for a file over OpenAI's 25 MB limit.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_TRANSCRIBE_BYTES } }).single('audio');

function audioUpload(req: Request, res: Response, next: NextFunction): void {
    upload(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).send({ message: 'The recording is too large (max 25 MB).' });
            return;
        }
        res.status(400).send({ message: err instanceof Error ? err.message : 'Audio upload failed.' });
    });
}

// Speech recognition (see src/controllers/speech.ts).
router.post('/transcribe', audioUpload, SpeechController.transcribe);
router.post('/transcribe-and-save', audioUpload, SpeechController.transcribeAndSave);

export default router;
