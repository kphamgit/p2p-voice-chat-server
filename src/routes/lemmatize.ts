import { Router } from 'express';

const router = Router();

import LemmatizeController from '../controllers/lemmatize.js';

router.post('/', LemmatizeController.lemmatize);

export default router;
