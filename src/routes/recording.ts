import { Router } from 'express';
import UploadToS3 from '../controllers/upload_to_s3.js';
import RecordingController from '../controllers/recording.js';

const router = Router();

// UploadToS3.upload is a multer middleware (multer-s3 storage) that streams the
// `audio` file straight to S3. After it runs, req.file.location holds the S3 URL.
router.post('/', UploadToS3.upload.single('audio'), RecordingController.create);

// Returns a temporary presigned URL to play a recording (bucket is private).
router.get('/:id/url', RecordingController.getUrl);

// Delete a recording: removes the S3 object and the DB row.
router.delete('/:id', RecordingController.delete);

export default router;
