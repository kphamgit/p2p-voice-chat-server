import { Router } from 'express';
import QuestionItemController from '../controllers/questionItem.js';

const router = Router();

router.get('/', QuestionItemController.findAll);
router.post('/', QuestionItemController.create);
router.post('/:id/clone', QuestionItemController.clone);
router.get('/:id', QuestionItemController.findOne);
router.put('/:id', QuestionItemController.update);
router.delete('/:id', QuestionItemController.delete);

export default router;
