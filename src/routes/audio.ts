import { Router } from 'express';
import AudioController from '../controllers/audio.js';
import { requireRole } from '../middleware/requireRole.js';

// Question audio, for the admin's item form: admins only. Students get an
// audio's URL inside the question items.
const router = Router();

router.post('/', requireRole('admin'), AudioController.create);
router.get('/', requireRole('admin'), AudioController.search);
router.patch('/:id', requireRole('admin'), AudioController.update);
router.get('/:id/file', requireRole('admin'), AudioController.file);
router.post('/:id/analyze', requireRole('admin'), AudioController.analyze);

export default router;
