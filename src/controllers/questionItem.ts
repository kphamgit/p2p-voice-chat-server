import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import UploadToS3 from './upload_to_s3.js';
import { adoptPendingImages, copyImages, deleteAllImages, deleteUnusedImages } from '../media.js';

interface ItemBody {
    itemNumber?: number;
    questionText?: string | null;
    questionPrompt?: string | null;
    answerKey?: string | null;
    choices?: string | null;
    format?: number; // required in the DB; omit on create to get the default (1)
    media?: string | null; // text with inline images, ![](<public S3 URL>)
    explanation?: string | null;
    showExplanationWhenCorrect?: boolean; // default false
    itemGroupId?: number;
}

// format may be omitted (create: defaults to 1; update: left unchanged), but not
// null or a non-integer, since the column is required.
function invalidFormat(format: unknown): boolean {
    return format !== undefined && !Number.isInteger(format);
}

// For optional text fields (media, explanation): text, null, or omitted.
function invalidOptionalText(value: unknown): boolean {
    return value !== undefined && value !== null && typeof value !== 'string';
}

// After saving an item: move the pending images its media uses (pasted before
// the item existed) into its folder, save the media pointing at them, then
// delete the pending originals. Returns the item as finally saved.
async function savePendingImages<T extends { id: number; media: string | null }>(item: T): Promise<T> {
    const { media, adoptedKeys } = await adoptPendingImages(item.id, item.media);
    if (adoptedKeys.length === 0) return item;
    await prisma.questionItem.update({ where: { id: item.id }, data: { media } });
    UploadToS3.deleteKeys(adoptedKeys).catch((err) =>
        console.error(`❌ Deleting moved pending images of question item ${item.id} failed:`, err),
    );
    return { ...item, media };
}

// The 500 message when the item saved but its pasted images couldn't be moved.
// The text still points at the pending copies (kept for a day), so saving the
// item again from Edit retries the move.
function pendingImagesFailed(itemId: number, verb: string, err: any): string {
    console.error(`❌ Moving pending images of question item ${itemId} failed:`, err);
    return `Question item ${itemId} was ${verb}, but its pasted images couldn't be stored (${err.message}). Open it with Edit and save again.`;
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
    // { itemNumber, itemGroupId, questionText?, questionPrompt?, answerKey?, choices?, format? (default 1), media?, explanation?, showExplanationWhenCorrect? }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, explanation, showExplanationWhenCorrect, itemGroupId } = req.body as ItemBody;
            if (invalidFormat(format)) {
                res.status(400).send({ message: 'format must be a whole number.' });
                return;
            }
            if (invalidOptionalText(media)) {
                res.status(400).send({ message: 'media must be text.' });
                return;
            }
            if (invalidOptionalText(explanation)) {
                res.status(400).send({ message: 'explanation must be text.' });
                return;
            }
            if (showExplanationWhenCorrect !== undefined && typeof showExplanationWhenCorrect !== 'boolean') {
                res.status(400).send({ message: 'showExplanationWhenCorrect must be true or false.' });
                return;
            }
            if (itemNumber == null || itemGroupId == null) {
                res.status(400).send({ message: 'itemNumber and itemGroupId are required.' });
                return;
            }
            const created = await prisma.questionItem.create({
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, explanation, showExplanationWhenCorrect, itemGroupId },
            });
            let item;
            try {
                item = await savePendingImages(created);
            } catch (err: any) {
                res.status(500).send({ message: pendingImagesFailed(created.id, 'created', err) });
                return;
            }
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
                        format: source.format,
                        explanation: source.explanation,
                        showExplanationWhenCorrect: source.showExplanationWhenCorrect,
                        // media is filled in below, once its images are copied.
                        itemGroupId: source.itemGroupId,
                    },
                });
            });
            if (source.media) {
                try {
                    const media = await copyImages(source.media, source.id, copy.id);
                    res.status(201).json(await prisma.questionItem.update({ where: { id: copy.id }, data: { media } }));
                } catch (err: any) {
                    console.error(`❌ Copying images of question item ${source.id} failed:`, err);
                    res.status(500).send({
                        message: `Question item ${copy.id} was cloned without its media: copying the images failed (${err.message}).`,
                    });
                }
                return;
            }
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

    // PUT /question-items/:id — update any of itemNumber, questionText, questionPrompt, answerKey, choices, format,
    // media, explanation, showExplanationWhenCorrect, itemGroupId. Saving media also deletes the item's images it no longer uses.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, explanation, showExplanationWhenCorrect, itemGroupId } = req.body as ItemBody;
            if (invalidFormat(format)) {
                res.status(400).send({ message: 'format must be a whole number.' });
                return;
            }
            if (invalidOptionalText(media)) {
                res.status(400).send({ message: 'media must be text.' });
                return;
            }
            if (invalidOptionalText(explanation)) {
                res.status(400).send({ message: 'explanation must be text.' });
                return;
            }
            if (showExplanationWhenCorrect !== undefined && typeof showExplanationWhenCorrect !== 'boolean') {
                res.status(400).send({ message: 'showExplanationWhenCorrect must be true or false.' });
                return;
            }
            let item = await prisma.questionItem.update({
                where: { id },
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, explanation, showExplanationWhenCorrect, itemGroupId }, // undefined fields are left unchanged
            });
            if (media !== undefined) {
                try {
                    item = await savePendingImages(item);
                } catch (err: any) {
                    res.status(500).send({ message: pendingImagesFailed(id, 'saved', err) });
                    return;
                }
            }
            res.json(item);
            if (media !== undefined) {
                // Best effort, after responding: a leftover image costs a little
                // storage; the next save of the media tries again.
                deleteUnusedImages(id, item.media).catch((err) =>
                    console.error(`❌ Cleaning up images of question item ${id} failed:`, err),
                );
            }
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

    // DELETE /question-items/:id — remove a question item and its images.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.questionItem.delete({ where: { id } });
            res.status(204).send();
            deleteAllImages(id).catch((err) =>
                console.error(`❌ Deleting images of deleted question item ${id} failed:`, err),
            );
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting question item.' });
        }
    }

    // Runs before an image upload so nothing is stored for an item that doesn't exist.
    public async ensureExists(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const item = await prisma.questionItem.findUnique({ where: { id: Number(req.params.id) }, select: { id: true } });
            if (!item) {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            next();
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question item.' });
        }
    }

    // POST /question-items/:id/images, or POST /question-items/images for an
    // item not saved yet — the image (multipart field "image") has already been
    // stored in S3 by UploadToS3.imageUpload; return its public URL for the
    // client to put into the item's media as ![](<url>). It only stays if the
    // media that uses it is saved (see deleteUnusedImages and media.ts).
    public async uploadImage(req: Request, res: Response): Promise<void> {
        const file = req.file as (Express.Multer.File & { key?: string }) | undefined;
        if (!file?.key) {
            res.status(400).send({ message: 'Send the image as multipart form field "image".' });
            return;
        }
        res.status(201).json({ url: UploadToS3.publicUrl(file.key) });
    }
}

export default new QuestionItemController();
