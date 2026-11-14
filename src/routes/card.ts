import { Router } from 'express';
import CardController from '../controllers/card.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// The vocabulary review (see src/controllers/card.ts). The fixed paths come
// before /:id so "due" and "review-log" aren't read as card ids.
router.get('/due', CardController.due);
router.get('/review-log', requireRole('admin'), CardController.reviewLog);
router.post('/from-sense/:senseId/add-to-review', CardController.addSenseToReview);
router.get('/:id/question', CardController.question);
router.post('/:id/answer', CardController.answer);

export default router;
