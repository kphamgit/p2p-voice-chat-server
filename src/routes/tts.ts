import { Router } from 'express';
import TtsController from '../controllers/tts.js';

const router = Router();

// Google text-to-speech, Chirp 3 HD voice (see src/tts.ts).
router.get('/voices', TtsController.voices);
router.get('/', TtsController.speak);
router.post('/', TtsController.speak);

export default router;
