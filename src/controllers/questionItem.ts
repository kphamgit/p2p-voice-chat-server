import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

interface ItemBody {
    itemNumber?: number;
    questionText?: string | null;
    questionPrompt?: string | null;
    answerKey?: string | null;
    choices?: string | null;
    itemGroupId?: number;
}

class QuestionItemController {
    // GET /question-items — list all question items, ordered by itemNumber.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const items = await prisma.questionItem.findMany({ orderBy: { itemNumber: 'asc' } });
            res.json(items);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question items.' });
        }
    }

    // POST /question-items — create a question item from
    // { itemNumber, itemGroupId, questionText?, questionPrompt?, answerKey?, choices? }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { itemNumber, questionText, questionPrompt, answerKey, choices, itemGroupId } = req.body as ItemBody;
            if (itemNumber == null || itemGroupId == null) {
                res.status(400).send({ message: 'itemNumber and itemGroupId are required.' });
                return;
            }
            const item = await prisma.questionItem.create({
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, itemGroupId },
            });
            res.status(201).json(item);
        } catch (err: any) {
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Item group ${req.body?.itemGroupId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error creating question item.' });
        }
    }

    // POST /question-items/:id/clone — copy a question item into the slot right after it.
    // Later question items in the same group are shifted down one number to make room; both
    // steps run in one transaction so numbering never ends up half-shifted.
    public async clone(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const source = await prisma.questionItem.findUnique({ where: { id } });
            if (!source) {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            const copy = await prisma.$transaction(async (tx) => {
                await tx.questionItem.updateMany({
                    where: { itemGroupId: source.itemGroupId, itemNumber: { gt: source.itemNumber } },
                    data: { itemNumber: { increment: 1 } },
                });
                return tx.questionItem.create({
                    data: {
                        itemNumber: source.itemNumber + 1,
                        questionText: source.questionText,
                        questionPrompt: source.questionPrompt,
                        answerKey: source.answerKey,
                        choices: source.choices,
                        itemGroupId: source.itemGroupId,
                    },
                });
            });
            res.status(201).json(copy);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error cloning question item.' });
        }
    }

    // GET /question-items/:id — fetch one question item (with its parent item group).
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const item = await prisma.questionItem.findUnique({ where: { id }, include: { itemGroup: true } });
            if (!item) {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            res.json(item);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question item.' });
        }
    }

    // PUT /question-items/:id — update any of itemNumber, questionText, questionPrompt, answerKey, choices,
    // itemGroupId.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { itemNumber, questionText, questionPrompt, answerKey, choices, itemGroupId } = req.body as ItemBody;
            const item = await prisma.questionItem.update({
                where: { id },
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, itemGroupId }, // undefined fields are left unchanged
            });
            res.json(item);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Item group ${req.body?.itemGroupId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating question item.' });
        }
    }

    // DELETE /question-items/:id — remove a question item.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.questionItem.delete({ where: { id } });
            res.status(204).send();
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting question item.' });
        }
    }
}

export default new QuestionItemController();
