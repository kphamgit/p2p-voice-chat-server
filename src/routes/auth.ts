import { Router } from 'express';

const router = Router();

import AuthController from '../controllers/auth.js';
import { requireAuth } from '../middleware/requireAuth.js';

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.get('/me', requireAuth, AuthController.me);

export default router;
