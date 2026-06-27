import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

class UnitController {
    // GET /units — list all units, ordered by unitNumber.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const units = await prisma.unit.findMany({ orderBy: { unitNumber: 'asc' } });
            res.json(units);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving units.' });
        }
    }

    // POST /units — create a unit from { name, unitNumber, levelId }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { name, unitNumber, levelId } = req.body as {
                name?: string;
                unitNumber?: number;
                levelId?: number;
            };
            if (!name || unitNumber == null || levelId == null) {
                res.status(400).send({ message: 'name, unitNumber, and levelId are required.' });
                return;
            }
            const unit = await prisma.unit.create({ data: { name, unitNumber, levelId } });
            res.status(201).json(unit);
        } catch (err: any) {
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Level ${req.body?.levelId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error creating unit.' });
        }
    }

    // GET /units/:id — fetch one unit (with its parent level).
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const unit = await prisma.unit.findUnique({ where: { id }, include: { level: true } });
            if (!unit) {
                res.status(404).send({ message: `Unit ${req.params.id} not found.` });
                return;
            }
            res.json(unit);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving unit.' });
        }
    }

    // PUT /units/:id — update name, unitNumber, and/or levelId.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { name, unitNumber, levelId } = req.body as {
                name?: string;
                unitNumber?: number;
                levelId?: number;
            };
            const unit = await prisma.unit.update({
                where: { id },
                data: { name, unitNumber, levelId }, // undefined fields are left unchanged
            });
            res.json(unit);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Unit ${req.params.id} not found.` });
                return;
            }
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Level ${req.body?.levelId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating unit.' });
        }
    }

    // DELETE /units/:id — remove a unit.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.unit.delete({ where: { id } });
            res.status(204).send();
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Unit ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting unit.' });
        }
    }
}

export default new UnitController();
