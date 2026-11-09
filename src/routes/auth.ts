import { Router } from 'express';

const router = Router();

import AuthController from '../controllers/auth.js';
import { requireAuth } from '../middleware/requireAuth.js';

router.post('/register', AuthController.register);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);
router.post('/logout', AuthController.logout);
router.post('/upgrade', requireAuth, AuthController.upgrade);
router.get('/me', requireAuth, AuthController.me);

export default router;
