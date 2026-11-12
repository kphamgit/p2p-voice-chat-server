import { Router } from 'express';
import QuestionItemController from '../controllers/questionItem.js';
import { QUESTION_ITEM_IMAGES } from '../controllers/upload_to_s3.js';
import { requireRole } from '../middleware/requireRole.js';
import { sendImageUrl, uploadImageTo } from './imageUpload.js';

const uploadImage = uploadImageTo(QUESTION_ITEM_IMAGES);

const router = Router();

router.get('/', QuestionItemController.findAll);
router.post('/', QuestionItemController.create);
router.post('/:id/clone', QuestionItemController.clone);
// Paste-to-upload from the admin's item form; stored publicly in S3. Without
// an id (a new item), the image waits in a pending folder until the item is saved.
router.post('/images', requireRole('admin'), uploadImage, sendImageUrl);
router.post('/:id/images', requireRole('admin'), QuestionItemController.ensureExists, uploadImage, sendImageUrl);
// Generate a voice for the admin's item form (Google TTS → S3 pending folder).
router.post('/audio', requireRole('admin'), QuestionItemController.generateAudio);
router.get('/:id', QuestionItemController.findOne);
router.put('/:id', QuestionItemController.update);
router.delete('/:id', QuestionItemController.delete);

export default router;
