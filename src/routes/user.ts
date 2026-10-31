import { Router } from 'express';

const router = Router();

import UserController from '../controllers/user.js';

// Open to any authenticated user for now; a role guard is to be added later.
router.get('/', UserController.findAll);

export default router;
