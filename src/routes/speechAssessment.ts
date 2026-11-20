import { Router } from 'express';
import SpeechAssessmentController from '../controllers/speechAssessment.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// The admin's Speech Assessment tab (see src/controllers/speechAssessment.ts).
// Admins only: the recordings are students' voices, and each assessment uses
// up one of the TonePerfect account's tries.
router.use(requireRole('admin'));
router.get('/students', SpeechAssessmentController.students);
router.get('/recordings', SpeechAssessmentController.recordings);
router.get('/audio', SpeechAssessmentController.audio);
router.post('/assess', SpeechAssessmentController.assess);

export default router;
