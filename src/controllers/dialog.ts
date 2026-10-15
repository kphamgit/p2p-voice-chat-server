import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

type DialogBody = { title?: string; text?: string; note?: string | null; dialogNumber?: unknown };

// A dialog number must be a positive integer. Returns an error message, or null if valid.
function invalidDialogNumber(value: unknown): string | null {
    return Number.isInteger(value) && (value as number) > 0 ? null : 'dialogNumber must be a positive integer.';
}

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

    // POST /dialogs — create a dialog from { title, text, note?, dialogNumber? }.
    // dialogNumber defaults to the total number of dialogs including this one.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { title, text, note, dialogNumber } = req.body as DialogBody;
            if (!title || !text) {
                res.status(400).send({ message: 'title and text are required.' });
                return;
            }
            if (dialogNumber !== undefined) {
                const error = invalidDialogNumber(dialogNumber);
                if (error) {
                    res.status(400).send({ message: error });
                    return;
                }
            }
            const number = (dialogNumber as number | undefined) ?? (await prisma.dialog.count()) + 1;
            const dialog = await prisma.dialog.create({ data: { title, text, note, dialogNumber: number } });
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

    // PUT /dialogs/:id — update title, text, note and/or dialogNumber.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { title, text, note, dialogNumber } = req.body as DialogBody;
            if (dialogNumber !== undefined) {
                const error = invalidDialogNumber(dialogNumber);
                if (error) {
                    res.status(400).send({ message: error });
                    return;
                }
            }
            const dialog = await prisma.dialog.update({
                where: { id },
                // undefined fields are left unchanged
                data: { title, text, note, dialogNumber: dialogNumber as number | undefined },
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
