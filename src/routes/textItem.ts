import { Router } from 'express';
import TextItemController from '../controllers/textItem.js';
import { TEXT_ITEM_IMAGES } from '../controllers/upload_to_s3.js';
import { requireRole } from '../middleware/requireRole.js';
import { sendImageUrl, uploadImageTo } from './imageUpload.js';

const uploadImage = uploadImageTo(TEXT_ITEM_IMAGES);

const router = Router();

router.post('/', requireRole('admin'), TextItemController.create);
// Paste-to-upload from the admin's text item form (images/text-items/ in S3).
// Without an id (a new item), the image waits in pending/ until the item is saved.
router.post('/images', requireRole('admin'), uploadImage, sendImageUrl);
router.post('/:id/images', requireRole('admin'), TextItemController.ensureExists, uploadImage, sendImageUrl);
router.post('/:id/clone', requireRole('admin'), TextItemController.clone);
router.put('/:id', requireRole('admin'), TextItemController.update);
router.delete('/:id', requireRole('admin'), TextItemController.delete);

export default router;
