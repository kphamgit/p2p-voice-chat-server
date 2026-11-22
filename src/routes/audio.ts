import { Router } from 'express';
import AudioController from '../controllers/audio.js';
import { requireRole } from '../middleware/requireRole.js';

// Question audio, for the admin's item form and its Manage Audios Library tab: admins only. Students get an
// audio's URL inside the question items.
const router = Router();

router.post('/', requireRole('admin'), AudioController.create);
router.get('/', requireRole('admin'), AudioController.search);
router.get('/library', requireRole('admin'), AudioController.library);
router.get('/library/check', requireRole('admin'), AudioController.check);
router.delete('/library/stray', requireRole('admin'), AudioController.deleteStrayFile);
router.patch('/:id', requireRole('admin'), AudioController.update);
router.delete('/:id', requireRole('admin'), AudioController.remove);
router.get('/:id/file', requireRole('admin'), AudioController.file);
router.post('/:id/analyze', requireRole('admin'), AudioController.analyze);

export default router;
