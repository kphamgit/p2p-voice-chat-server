import { Router } from 'express';

const router = Router();

import DialogController from '../controllers/dialog.js';
import { requireRole } from '../middleware/requireRole.js';

// Reads are open to any authenticated user (students list/read dialogs).
router.get('/', DialogController.findAll);
router.get('/:id', DialogController.findOne);

// Writes require the teacher role.
router.post('/', requireRole('teacher'), DialogController.create);
router.put('/:id', requireRole('teacher'), DialogController.update);
router.delete('/:id', requireRole('teacher'), DialogController.delete);

export default router;
