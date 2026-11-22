import { Router } from 'express';
import TtsController from '../controllers/tts.js';

const router = Router();

// The text-to-speech voices the admin's pickers offer (see src/tts.ts).
router.get('/voices', TtsController.voices);

export default router;
