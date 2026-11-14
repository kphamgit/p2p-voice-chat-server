import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma.js';
import UploadToS3, { QUESTION_ITEM_IMAGES } from './upload_to_s3.js';
import { adoptPendingImages, copyImages, deleteAllImages, deleteUnusedImages } from '../media.js';
import { adoptPendingAudio, copyAudio, deleteUnusedAudio, generateQuestionAudio, isAllowedAudio } from '../questionAudio.js';
import { isTtsProvider, TtsInputError } from '../tts.js';

interface ItemBody {
    itemNumber?: number;
    questionText?: string | null;
    questionPrompt?: string | null;
    answerKey?: string | null;
    choices?: string | null;
    format?: number; // required in the DB; omit on create to get the default (1)
    media?: string | null; // text with inline images, ![](<public S3 URL>)
    audio?: string | null; // public S3 URL of the question's MP3 (see questionAudio.ts)
    audioText?: string | null; // the text the audio speaks
    voiceName?: string | null; // the id of the voice that speaks it (mostly ElevenLabs)
    trailingAudio?: string | null; // a second MP3, stored like audio
    trailingAudioText?: string | null;
    trailingVoiceName?: string | null;
    explanation?: string | null;
    showExplanationWhenCorrect?: boolean; // default false
    checkOrder?: boolean; // default false; only applies to question format 8
    halfHandsFree?: boolean; // default false; only applies to question format 7
    itemGroupId?: number;
}

// format may be omitted (create: defaults to 1; update: left unchanged), but not
// null or a non-integer, since the column is required.
function invalidFormat(format: unknown): boolean {
    return format !== undefined && !Number.isInteger(format);
}

// For optional text fields (media, audioText, voiceName, trailingAudioText, trailingVoiceName, explanation): text, null, or omitted.
function invalidOptionalText(value: unknown): boolean {
    return value !== undefined && value !== null && typeof value !== 'string';
}

// After saving an item: move the pending images its media uses (pasted before
// the item existed) into its folder, save the media pointing at them, then
// delete the pending originals. Returns the item as finally saved.
async function savePendingImages<T extends { id: number; media: string | null }>(item: T): Promise<T> {
    const { media, adoptedKeys } = await adoptPendingImages(QUESTION_ITEM_IMAGES, item.id, item.media);
    if (adoptedKeys.length === 0) return item;
    await prisma.questionItem.update({ where: { id: item.id }, data: { media } });
    UploadToS3.deleteKeys(adoptedKeys).catch((err) =>
        console.error(`❌ Deleting moved pending images of question item ${item.id} failed:`, err),
    );
    return { ...item, media };
}

// Likewise for voices generated before saving (the audio and the trailing
// audio): move them from pending into the item's folder and save the URLs of
// the moved copies.
async function savePendingAudio<T extends { id: number; audio: string | null; trailingAudio: string | null }>(item: T): Promise<T> {
    const main = await adoptPendingAudio(item.id, item.audio);
    const trailing = await adoptPendingAudio(item.id, item.trailingAudio);
    const adoptedKeys = [main.adoptedKey, trailing.adoptedKey].filter((key): key is string => key !== null);
    if (adoptedKeys.length === 0) return item;
    const data = { audio: main.audio, trailingAudio: trailing.audio };
    await prisma.questionItem.update({ where: { id: item.id }, data });
    UploadToS3.deleteKeys(adoptedKeys).catch((err) =>
        console.error(`❌ Deleting moved pending audio of question item ${item.id} failed:`, err),
    );
    return { ...item, ...data };
}

// Both of the above, after saving an item.
async function savePendingFiles<T extends { id: number; media: string | null; audio: string | null; trailingAudio: string | null }>(item: T): Promise<T> {
    return savePendingAudio(await savePendingImages(item));
}

// The 500 message when the item saved but its pasted images or generated voice
// couldn't be moved. The item still points at the pending copies (kept for a
// day), so saving the item again from Edit retries the move.
function pendingFilesFailed(itemId: number, verb: string, err: any): string {
    console.error(`❌ Moving pending files of question item ${itemId} failed:`, err);
    return `Question item ${itemId} was ${verb}, but its pasted images or voice couldn't be stored (${err.message}). Open it with Edit and save again.`;
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
    // { itemNumber, itemGroupId, questionText?, questionPrompt?, answerKey?, choices?, format? (default 1), media?, audio?, audioText?, voiceName?, trailingAudio?, trailingAudioText?, trailingVoiceName?, explanation?, showExplanationWhenCorrect?, checkOrder?, halfHandsFree? }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audio, audioText, voiceName, trailingAudio, trailingAudioText, trailingVoiceName, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, itemGroupId } = req.body as ItemBody;
            if (invalidFormat(format)) {
                res.status(400).send({ message: 'format must be a whole number.' });
                return;
            }
            if (invalidOptionalText(media)) {
                res.status(400).send({ message: 'media must be text.' });
                return;
            }
            if (invalidOptionalText(audioText)) {
                res.status(400).send({ message: 'audioText must be text.' });
                return;
            }
            if (invalidOptionalText(voiceName)) {
                res.status(400).send({ message: 'voiceName must be text.' });
                return;
            }
            if (invalidOptionalText(trailingAudioText)) {
                res.status(400).send({ message: 'trailingAudioText must be text.' });
                return;
            }
            if (invalidOptionalText(trailingVoiceName)) {
                res.status(400).send({ message: 'trailingVoiceName must be text.' });
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
            if (checkOrder !== undefined && typeof checkOrder !== 'boolean') {
                res.status(400).send({ message: 'checkOrder must be true or false.' });
                return;
            }
            if (halfHandsFree !== undefined && typeof halfHandsFree !== 'boolean') {
                res.status(400).send({ message: 'halfHandsFree must be true or false.' });
                return;
            }
            if (audio !== undefined && !isAllowedAudio(audio)) {
                res.status(400).send({ message: 'audio must be a voice generated in the item form, or null.' });
                return;
            }
            if (trailingAudio !== undefined && !isAllowedAudio(trailingAudio)) {
                res.status(400).send({ message: 'trailingAudio must be a voice generated in the item form, or null.' });
                return;
            }
            if (itemNumber == null || itemGroupId == null) {
                res.status(400).send({ message: 'itemNumber and itemGroupId are required.' });
                return;
            }
            const created = await prisma.questionItem.create({
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audio, audioText, voiceName, trailingAudio, trailingAudioText, trailingVoiceName, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, itemGroupId },
            });
            let item;
            try {
                item = await savePendingFiles(created);
            } catch (err: any) {
                res.status(500).send({ message: pendingFilesFailed(created.id, 'created', err) });
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
                        audioText: source.audioText,
                        voiceName: source.voiceName,
                        trailingAudioText: source.trailingAudioText,
                        trailingVoiceName: source.trailingVoiceName,
                        showExplanationWhenCorrect: source.showExplanationWhenCorrect,
                        checkOrder: source.checkOrder,
                        halfHandsFree: source.halfHandsFree,
                        // media, audio and trailingAudio are filled in below, once their files are copied.
                        itemGroupId: source.itemGroupId,
                    },
                });
            });
            if (source.media || source.audio || source.trailingAudio) {
                try {
                    const media = await copyImages(QUESTION_ITEM_IMAGES, source.media, source.id, copy.id);
                    const audio = await copyAudio(source.audio, source.id, copy.id);
                    const trailingAudio = await copyAudio(source.trailingAudio, source.id, copy.id);
                    res.status(201).json(
                        await prisma.questionItem.update({ where: { id: copy.id }, data: { media, audio, trailingAudio } }),
                    );
                } catch (err: any) {
                    console.error(`❌ Copying files of question item ${source.id} failed:`, err);
                    res.status(500).send({
                        message: `Question item ${copy.id} was cloned without its media and audio: copying the files failed (${err.message}).`,
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
    // media, audio, audioText, voiceName, trailingAudio, trailingAudioText, trailingVoiceName, explanation, showExplanationWhenCorrect, checkOrder,
    // halfHandsFree, itemGroupId. Saving media (or audio / trailing audio) also deletes the item's images (or audio files) it no longer uses.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audio, audioText, voiceName, trailingAudio, trailingAudioText, trailingVoiceName, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, itemGroupId } = req.body as ItemBody;
            if (invalidFormat(format)) {
                res.status(400).send({ message: 'format must be a whole number.' });
                return;
            }
            if (invalidOptionalText(media)) {
                res.status(400).send({ message: 'media must be text.' });
                return;
            }
            if (invalidOptionalText(audioText)) {
                res.status(400).send({ message: 'audioText must be text.' });
                return;
            }
            if (invalidOptionalText(voiceName)) {
                res.status(400).send({ message: 'voiceName must be text.' });
                return;
            }
            if (invalidOptionalText(trailingAudioText)) {
                res.status(400).send({ message: 'trailingAudioText must be text.' });
                return;
            }
            if (invalidOptionalText(trailingVoiceName)) {
                res.status(400).send({ message: 'trailingVoiceName must be text.' });
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
            if (checkOrder !== undefined && typeof checkOrder !== 'boolean') {
                res.status(400).send({ message: 'checkOrder must be true or false.' });
                return;
            }
            if (halfHandsFree !== undefined && typeof halfHandsFree !== 'boolean') {
                res.status(400).send({ message: 'halfHandsFree must be true or false.' });
                return;
            }
            if (audio !== undefined && !isAllowedAudio(audio, id)) {
                res.status(400).send({ message: 'audio must be a voice generated in the item form, or null.' });
                return;
            }
            if (trailingAudio !== undefined && !isAllowedAudio(trailingAudio, id)) {
                res.status(400).send({ message: 'trailingAudio must be a voice generated in the item form, or null.' });
                return;
            }
            let item = await prisma.questionItem.update({
                where: { id },
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audio, audioText, voiceName, trailingAudio, trailingAudioText, trailingVoiceName, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, itemGroupId }, // undefined fields are left unchanged
            });
            const audioSent = audio !== undefined || trailingAudio !== undefined;
            if (media !== undefined || audioSent) {
                try {
                    item = await savePendingFiles(item);
                } catch (err: any) {
                    res.status(500).send({ message: pendingFilesFailed(id, 'saved', err) });
                    return;
                }
            }
            res.json(item);
            if (audioSent) {
                // Best effort, after responding, like the images below.
                deleteUnusedAudio(id, [item.audio, item.trailingAudio]).catch((err) =>
                    console.error(`❌ Cleaning up audio of question item ${id} failed:`, err),
                );
            }
            if (media !== undefined) {
                // Best effort, after responding: a leftover image costs a little
                // storage; the next save of the media tries again.
                deleteUnusedImages(QUESTION_ITEM_IMAGES, id, item.media).catch((err) =>
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

    // DELETE /question-items/:id — remove a question item and its images and audio.
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.questionItem.delete({ where: { id } });
            res.status(204).send();
            deleteAllImages(QUESTION_ITEM_IMAGES, id).catch((err) =>
                console.error(`❌ Deleting images of deleted question item ${id} failed:`, err),
            );
            deleteUnusedAudio(id, []).catch((err) =>
                console.error(`❌ Deleting audio of deleted question item ${id} failed:`, err),
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

    // POST /question-items/audio — speak { text, provider?, voice?, rate? }
    // (provider: google, the default, or elevenlabs; see tts.ts), store the MP3 in S3's pending folder and return
    // { url }. The form plays it; saving the item with audio: url keeps it (and
    // moves it into the item's folder), otherwise it's deleted after a day.
    public async generateAudio(req: Request, res: Response): Promise<void> {
        const { text, provider = 'google', voice, rate } = (req.body ?? {}) as {
            text?: unknown;
            provider?: unknown;
            voice?: unknown;
            rate?: unknown;
        };
        if (typeof text !== 'string' || (voice !== undefined && typeof voice !== 'string')) {
            res.status(400).send({ message: 'Send { text, provider?, voice?, rate? } with text and voice as strings.' });
            return;
        }
        if (!isTtsProvider(provider)) {
            res.status(400).send({ message: 'provider must be google or elevenlabs.' });
            return;
        }
        try {
            const url = await generateQuestionAudio(text.trim(), {
                provider,
                rate: rate === undefined ? undefined : Number(rate),
                voice: voice || undefined,
            });
            res.status(201).json({ url });
        } catch (err: any) {
            if (err instanceof TtsInputError) {
                res.status(400).send({ message: err.message });
                return;
            }
            console.error('❌ Generating question audio failed:', err);
            res.status(502).send({ message: `Generating the voice failed: ${err.message}` });
        }
    }
}

export default new QuestionItemController();
