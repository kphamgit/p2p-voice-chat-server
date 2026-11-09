import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

const ITEM_TYPES = ['text', 'question'] as const;
type ItemType = (typeof ITEM_TYPES)[number];
const DISPLAY_TYPES = ['scrolling', 'individual_screen'] as const;
type ItemDisplayType = (typeof DISPLAY_TYPES)[number];

class ItemGroupController {
    // GET /item-groups — list all item groups, ordered by itemGroupNumber.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const itemGroups = await prisma.itemGroup.findMany({ orderBy: { itemGroupNumber: 'asc' } });
            res.json(itemGroups);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving item groups.' });
        }
    }

    // POST /item-groups — create an item group from { itemGroupNumber, unitId, description?, displayType?, itemType? }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { itemGroupNumber, unitId, description, displayType, itemType } = req.body as {
                itemGroupNumber?: number;
                unitId?: number;
                description?: string;
                displayType?: ItemDisplayType | null;
                itemType?: ItemType | null;
            };
            if (itemType != null && !ITEM_TYPES.includes(itemType)) {
                res.status(400).send({ message: `itemType must be one of: ${ITEM_TYPES.join(', ')}.` });
                return;
            }
            if (displayType != null && !DISPLAY_TYPES.includes(displayType)) {
                res.status(400).send({ message: `displayType must be one of: ${DISPLAY_TYPES.join(', ')}.` });
                return;
            }
            if (itemGroupNumber == null || unitId == null) {
                res.status(400).send({ message: 'itemGroupNumber and unitId are required.' });
                return;
            }
            const itemGroup = await prisma.itemGroup.create({ data: { itemGroupNumber, unitId, description, displayType, itemType } });
            res.status(201).json(itemGroup);
        } catch (err: any) {
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Unit ${req.body?.unitId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error creating item group.' });
        }
    }

    // GET /item-groups/:id/question-items — list the question items belonging to an item group.
    public async findQuestionItems(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const itemGroup = await prisma.itemGroup.findUnique({
                where: { id },
                include: { questionItems: { orderBy: { itemNumber: 'asc' } } },
            });
            if (!itemGroup) {
                res.status(404).send({ message: `Item group ${req.params.id} not found.` });
                return;
            }
            res.json(itemGroup.questionItems);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question items.' });
        }
    }

    // GET /item-groups/:id — fetch one item group (with its parent unit).
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const itemGroup = await prisma.itemGroup.findUnique({ where: { id }, include: { unit: true } });
            if (!itemGroup) {
                res.status(404).send({ message: `Item group ${req.params.id} not found.` });
                return;
            }
            res.json(itemGroup);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving item group.' });
        }
    }

    // PUT /item-groups/:id — update itemGroupNumber, unitId, description, displayType, and/or itemType.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { itemGroupNumber, unitId, description, displayType, itemType } = req.body as {
                itemGroupNumber?: number;
                unitId?: number;
                description?: string;
                displayType?: ItemDisplayType | null;
                itemType?: ItemType | null;
            };
            if (itemType != null && !ITEM_TYPES.includes(itemType)) {
                res.status(400).send({ message: `itemType must be one of: ${ITEM_TYPES.join(', ')}.` });
                return;
            }
            if (displayType != null && !DISPLAY_TYPES.includes(displayType)) {
                res.status(400).send({ message: `displayType must be one of: ${DISPLAY_TYPES.join(', ')}.` });
                return;
            }
            const itemGroup = await prisma.itemGroup.update({
                where: { id },
                data: { itemGroupNumber, unitId, description, displayType, itemType }, // undefined fields are left unchanged
            });
            res.json(itemGroup);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Item group ${req.params.id} not found.` });
                return;
            }
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Unit ${req.body?.unitId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating item group.' });
        }
    }

    // DELETE /item-groups/:id — remove an item group.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.itemGroup.delete({ where: { id } });
            res.status(204).send();
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Item group ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting item group.' });
        }
    }
}

export default new ItemGroupController();
