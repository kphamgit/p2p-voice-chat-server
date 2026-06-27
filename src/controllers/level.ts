import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

class LevelController {

    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const levels = await prisma.level.findMany();
            res.status(200).json(levels);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving levels.' });
        }
    }

    // POST /levels — create a level from { name, levelNumber }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { name, levelNumber } = req.body as { name?: string; levelNumber?: number };
            if (!name || levelNumber == null) {
                res.status(400).send({ message: 'name and levelNumber are required.' });
                return;
            }
            const level = await prisma.level.create({ data: { name, levelNumber } });
            res.status(201).json(level);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error creating level.' });
        }
    }

    // GET /levels/:id/units — list the units belonging to a level.
    public async findUnits(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const level = await prisma.level.findUnique({
                where: { id },
                include: { units: { orderBy: { unitNumber: 'asc' } } },
            });
            if (!level) {
                res.status(404).send({ message: `Level ${req.params.id} not found.` });
                return;
            }
            res.json(level.units);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving units.' });
        }
    }

    // GET /levels/:id — fetch one level.
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const level = await prisma.level.findUnique({ where: { id } });
            if (!level) {
                res.status(404).send({ message: `Level ${req.params.id} not found.` });
                return;
            }
            res.json(level);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving level.' });
        }
    }

    // PUT /levels/:id — update name and/or levelNumber.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { name, levelNumber } = req.body as { name?: string; levelNumber?: number };
            const level = await prisma.level.update({
                where: { id },
                data: { name, levelNumber }, // undefined fields are left unchanged
            });
            res.json(level);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Level ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating level.' });
        }
    }

    // DELETE /levels/:id — remove a level.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.level.delete({ where: { id } });
            res.status(204).send();
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Level ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting level.' });
        }
    }
}

export default new LevelController();
