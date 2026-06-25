import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

class LevelController {
    public async findAll(req: Request, res: Response): Promise<void> {
        try {
            const data = await prisma.level.findMany({
                orderBy: { name: 'asc' },
            });
            res.send(data);
        } catch (err: any) {
            res.status(500).send({ message: err.message || "Error retrieving levels." });
        }
    }

    public async findOne(req: Request, res: Response): Promise<void> {
        const id = Number(req.params.id);
        try {
            const data = await prisma.level.findUnique({ where: { id } });
            if (data) {
                res.send(data);
            } else {
                res.status(404).send({ message: `Cannot find level with id=${id}.` });
            }
        } catch (err) {
            res.status(500).send({ message: "Error retrieving level with id=" + req.params.id });
        }
    }
}

export default new LevelController();
