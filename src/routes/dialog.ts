import { Router } from 'express';

const router = Router();

import DialogController from '../controllers/dialog.js';

router.get('/', DialogController.findAll);
router.post('/', DialogController.create);
router.get('/:id', DialogController.findOne);
router.put('/:id', DialogController.update);
router.delete('/:id', DialogController.delete);

export default router;
