import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import UploadToS3, { TEXT_ITEM_IMAGES } from './upload_to_s3.js';
import { adoptPendingImages, copyImages, deleteAllImages, deleteUnusedImages } from '../media.js';

interface TextItemBody {
    itemNumber?: number;
    content?: string;
    media?: string | null; // optional text with inline media, ![](<public S3 URL>)
    itemGroupId?: number;
}

// The 400 message for a bad body, or null. `creating`: itemNumber, content
// and itemGroupId are required; otherwise each may be omitted (left as is).
function invalidBody(body: TextItemBody, creating: boolean): string | null {
    const { itemNumber, content, media, itemGroupId } = body;
    if ((creating || itemNumber !== undefined) && !Number.isInteger(itemNumber)) return 'itemNumber must be a whole number.';
    if ((creating || itemGroupId !== undefined) && !Number.isInteger(itemGroupId)) return 'itemGroupId must be a whole number.';
    if ((creating || content !== undefined) && (typeof content !== 'string' || !content.trim())) return 'content is required.';
    if (media !== undefined && media !== null && typeof media !== 'string') return 'media must be text.';
    return null;
}

// After saving a text item: move the pending images its media uses (pasted
// before the item existed) into its folder, save the media pointing at them,
// then delete the pending originals. Returns the item as finally saved.
async function savePendingImages<T extends { id: number; media: string | null }>(item: T): Promise<T> {
    const { media, adoptedKeys } = await adoptPendingImages(TEXT_ITEM_IMAGES, item.id, item.media);
    if (adoptedKeys.length === 0) return item;
    await prisma.textItem.update({ where: { id: item.id }, data: { media } });
    UploadToS3.deleteKeys(adoptedKeys).catch((err) =>
        console.error(`❌ Deleting moved pending images of text item ${item.id} failed:`, err),
    );
    return { ...item, media };
}

// The 500 message when the item saved but its pasted images couldn't be
// moved. The item still points at the pending copies (kept for a day), so
// saving it again from Edit retries the move.
function pendingImagesFailed(itemId: number, verb: string, err: any): string {
    console.error(`❌ Moving pending images of text item ${itemId} failed:`, err);
    return `Text item ${itemId} was ${verb}, but its pasted images couldn't be stored (${err.message}). Open it with Edit and save again.`;
}

class TextItemController {
    // POST /text-items — create a text item in an item group.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const body = (req.body ?? {}) as TextItemBody;
            const invalid = invalidBody(body, true);
            if (invalid) {
                res.status(400).send({ message: invalid });
                return;
            }
            const created = await prisma.textItem.create({
                data: { itemNumber: body.itemNumber!, content: body.content!, media: body.media, itemGroupId: body.itemGroupId! },
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
            res.status(500).send({ message: err.message || 'Error creating text item.' });
        }
    }

    // PUT /text-items/:id — change a text item's number, content or media.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const body = (req.body ?? {}) as TextItemBody;
            const invalid = invalidBody(body, false);
            if (invalid) {
                res.status(400).send({ message: invalid });
                return;
            }
            const { itemNumber, content, media, itemGroupId } = body;
            const updated = await prisma.textItem.update({ where: { id }, data: { itemNumber, content, media, itemGroupId } });
            let item;
            try {
                item = await savePendingImages(updated);
            } catch (err: any) {
                res.status(500).send({ message: pendingImagesFailed(id, 'saved', err) });
                return;
            }
            res.json(item);
            if (media !== undefined) {
                // Best effort, after responding: a leftover image costs a little
                // storage; the next save of the media tries again.
                deleteUnusedImages(TEXT_ITEM_IMAGES, id, item.media).catch((err) =>
                    console.error(`❌ Cleaning up images of text item ${id} failed:`, err),
                );
            }
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Text item ${req.params.id} not found.` });
                return;
            }
            if (err?.code === 'P2003') {
                res.status(400).send({ message: `Item group ${req.body?.itemGroupId} does not exist.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating text item.' });
        }
    }

    // POST /text-items/:id/clone — copy a text item into the slot right after
    // it, shifting the group's later text items down one.
    public async clone(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const source = await prisma.textItem.findUnique({ where: { id } });
            if (!source) {
                res.status(404).send({ message: `Text item ${req.params.id} not found.` });
                return;
            }
            const copy = await prisma.$transaction(async (tx) => {
                await tx.textItem.updateMany({
                    where: { itemGroupId: source.itemGroupId, itemNumber: { gt: source.itemNumber } },
                    data: { itemNumber: { increment: 1 } },
                });
                return tx.textItem.create({
                    // media is filled in below, once its images are copied.
                    data: { itemNumber: source.itemNumber + 1, content: source.content, itemGroupId: source.itemGroupId },
                });
            });
            if (source.media) {
                try {
                    // Copied so the two items never share a file.
                    const media = await copyImages(TEXT_ITEM_IMAGES, source.media, source.id, copy.id);
                    res.status(201).json(await prisma.textItem.update({ where: { id: copy.id }, data: { media } }));
                } catch (err: any) {
                    console.error(`❌ Copying images of text item ${source.id} failed:`, err);
                    res.status(500).send({
                        message: `Text item ${copy.id} was cloned without its media: copying the images failed (${err.message}).`,
                    });
                }
                return;
            }
            res.status(201).json(copy);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error cloning text item.' });
        }
    }

    // DELETE /text-items/:id — remove a text item and its images.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.textItem.delete({ where: { id } });
            res.status(204).send();
            deleteAllImages(TEXT_ITEM_IMAGES, id).catch((err) =>
                console.error(`❌ Deleting images of deleted text item ${id} failed:`, err),
            );
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `Text item ${req.params.id} not found.` });
                return;
            }
            res.status(500).send({ message: err.message || 'Error deleting text item.' });
        }
    }

    // Runs before an image upload so nothing is stored for an item that doesn't exist.
    public async ensureExists(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const item = await prisma.textItem.findUnique({ where: { id: Number(req.params.id) }, select: { id: true } });
            if (!item) {
                res.status(404).send({ message: `Text item ${req.params.id} not found.` });
                return;
            }
            next();
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving text item.' });
        }
    }
}

export default new TextItemController();
