import { Router } from 'express';

const router = Router();

import DialogController from '../controllers/dialog.js';
import { requireRole } from '../middleware/requireRole.js';

// Reads are open to any authenticated user (students list/read dialogs).
router.get('/', DialogController.findAll);
router.get('/:id', DialogController.findOne);

// Writes require the admin role.
router.post('/', requireRole('admin'), DialogController.create);
router.put('/:id', requireRole('admin'), DialogController.update);
router.delete('/:id', requireRole('admin'), DialogController.delete);

export default router;
