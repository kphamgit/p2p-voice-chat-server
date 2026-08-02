import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

class DialogController {

    // GET /dialogs — list all dialogs.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const dialogs = await prisma.dialog.findMany({ orderBy: { createdAt: 'desc' } });
            res.status(200).json(dialogs);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving dialogs.' });
        }
    }

    // POST /dialogs — create a dialog from { title, text }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { title, text } = req.body as { title?: string; text?: string };
            if (!title || !text) {
                res.status(400).send({ message: 'title and text are required.' });
                return;
            }
            const dialog = await prisma.dialog.create({ data: { title, text } });
            res.status(201).json(dialog);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error creating dialog.' });
        }
    }

    // GET /dialogs/:id — fetch one dialog.
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const dialog = await prisma.dialog.findUnique({ where: { id } });
            if (!dialog) {
                res.status(404).send({ message: `Dialog ${req.params.id} not found.` });
                return;
            }
            res.json(dialog);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving dialog.' });
        }
    }

    // PUT /dialogs/:id — update title and/or text.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { title, text } = req.body as { title?: string; text?: string };
            const dialog = await prisma.dialog.update({
                where: { id },
                data: { title, text }, // undefined fields are left unchanged
            });
            res.json(dialog);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Dialog ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating dialog.' });
        }
    }

    // DELETE /dialogs/:id — remove a dialog.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.dialog.delete({ where: { id } });
            res.status(204).send();
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Dialog ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting dialog.' });
        }
    }
}

export default new DialogController();
