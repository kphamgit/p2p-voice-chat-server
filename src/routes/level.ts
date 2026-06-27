import { Router } from 'express';

const router = Router();

import LevelController from '../controllers/level.js';

router.get('/', LevelController.findAll);
router.post('/', LevelController.create);
router.get('/:id/units', LevelController.findUnits);
router.get('/:id', LevelController.findOne);
router.put('/:id', LevelController.update);
router.delete('/:id', LevelController.delete);

export default router;