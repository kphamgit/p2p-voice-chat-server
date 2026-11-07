import { Router } from 'express';

const router = Router();

import UserController from '../controllers/user.js';
import { requireRole } from '../middleware/requireRole.js';

// Open to any authenticated user for now; a role guard is to be added later.
router.get('/', UserController.findAll);

// Editing can change roles, so it is admin-only (otherwise anyone could promote themselves).
router.put('/:id', requireRole('admin'), UserController.update);

export default router;
