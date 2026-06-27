import { Router } from 'express';
import UnitController from '../controllers/unit.js';

const router = Router();

router.get('/', UnitController.findAll);
router.post('/', UnitController.create);
router.get('/:id', UnitController.findOne);
router.put('/:id', UnitController.update);
router.delete('/:id', UnitController.delete);

export default router;
