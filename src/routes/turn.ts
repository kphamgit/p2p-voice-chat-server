import { Router } from 'express';
import TurnController from '../controllers/turn.js';

const router = Router();

// Short-lived TURN credentials for the voice-chat client (see src/turn.ts).
router.get('/', TurnController.get);

export default router;
