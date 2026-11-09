import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import QuestionItemController from '../controllers/questionItem.js';
import UploadToS3 from '../controllers/upload_to_s3.js';
import { requireRole } from '../middleware/requireRole.js';

// Run the image upload, turning its errors into JSON instead of Express's
// default HTML error page: 400 for a bad image (too big, wrong type), 500 if
// S3 itself failed (AWS SDK errors carry $metadata).
function uploadImage(req: Request, res: Response, next: NextFunction): void {
    UploadToS3.imageUpload.single('image')(req, res, (err: unknown) => {
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
}

const router = Router();

router.get('/', QuestionItemController.findAll);
router.post('/', QuestionItemController.create);
router.post('/:id/clone', QuestionItemController.clone);
// Paste-to-upload from the admin's item form; stored publicly in S3. Without
// an id (a new item), the image waits in a pending folder until the item is saved.
router.post('/images', requireRole('admin'), uploadImage, QuestionItemController.uploadImage);
router.post('/:id/images', requireRole('admin'), QuestionItemController.ensureExists, uploadImage, QuestionItemController.uploadImage);
router.get('/:id', QuestionItemController.findOne);
router.put('/:id', QuestionItemController.update);
router.delete('/:id', QuestionItemController.delete);

export default router;
