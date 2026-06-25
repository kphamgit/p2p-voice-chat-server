import { Router } from 'express';
import LevelController  from '../controllers/level.js';

const router = Router();

//router.get("/new", users.new);
//router.post('/', users.create) 
//router.get("/:id/edit", users.edit);
//router.put("/:id", users.update);
//router.delete("/:id", users.delete);

router.get("/", LevelController.findAll);
router.get("/:id", LevelController.findOne);

export default router;
