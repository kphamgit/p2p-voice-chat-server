import { Router } from 'express';
import DictionaryController from '../controllers/dictionary.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// Copies the dictionary from the Django database, overwriting the one here: admins only.
router.post('/sync', requireRole('admin'), DictionaryController.sync);

// Look up a word: any signed-in user.
router.get('/entries', DictionaryController.lookup);

export default router;
