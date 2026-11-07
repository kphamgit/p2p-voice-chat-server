import { Router } from 'express';
import ItemGroupController from '../controllers/itemGroup.js';

const router = Router();

router.get('/', ItemGroupController.findAll);
router.post('/', ItemGroupController.create);
router.get('/:id/question-items', ItemGroupController.findQuestionItems);
router.get('/:id', ItemGroupController.findOne);
router.put('/:id', ItemGroupController.update);
router.delete('/:id', ItemGroupController.delete);

export default router;
