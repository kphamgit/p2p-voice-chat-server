import { NextFunction, Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../prisma.js';
import UploadToS3, { QUESTION_ITEM_IMAGES } from './upload_to_s3.js';
import { adoptPendingImages, copyImages, deleteAllImages, deleteUnusedImages } from '../media.js';
import { audioJson, plainText } from '../audio.js';

interface ItemBody {
    itemNumber?: number;
    questionText?: string | null;
    questionPrompt?: string | null;
    answerKey?: string | null;
    choices?: string | null;
    format?: number; // required in the DB; omit on create to get the default (1)
    media?: string | null; // text with inline images, ![](<public S3 URL>)
    audioId?: number | null; // the question's audio (an Audio id, see src/audio.ts)
    trailingAudioId?: number | null; // a second audio, played once the question is answered right
    explanation?: string | null;
    showExplanationWhenCorrect?: boolean; // default false
    checkOrder?: boolean; // default false; only applies to question format 8
    halfHandsFree?: boolean; // default false; only applies to question format 7
    hideText?: boolean; // default false; only applies to question format 9
    scoringOptions?: ScoringOptions | null; // only applies to question format 9 (see scoringOptionsProblem)
    itemGroupId?: number;
}

// format may be omitted (create: defaults to 1; update: left unchanged), but not
// null or a non-integer, since the column is required.
function invalidFormat(format: unknown): boolean {
    return format !== undefined && !Number.isInteger(format);
}

// A Shadowing question's (format 9) scoring options, as the phuyenenglish.com
// teacher panel sends them to VoiceAnalyzer (same keys, same meaning).
interface ScoringOptions {
    targeted_words: string; // words that should link to the next one, e.g. "is" (is_a)
    strict_connected_speech: boolean; // check linking (always on when targeted_words is set)
    link_tolerance: number; // how much longer a pause between linked words may be than the reference's (0.5–3)
    stress_words: string; // "accept, apology": the words whose syllable stress is checked
    stress_contrast_ratio: number; // share of the reference's stressed/unstressed contrast to reach (0.1–1)
    melody_min_similarity: number; // melody shape similarity for "Same melody" (0.1–0.9)
    stress_source: 'dictionary' | 'reference'; // who decides the right stressed syllable
    fall_match_ratio: number; // paused check; share of the reference's fall (0.1–1)
    rise_match_ratio: number; // paused check; share of the reference's rise (0.1–1)
    // optional, display only: the stress words' IPA, "accept: əkˈsept, apology: əˈpɒlədʒi"
    // (or a JSON object as text); VoiceAnalyzer returns each word's syllables from it
    stress_words_ipa?: string;
}

const SCORING_RANGES: Record<string, [number, number]> = {
    link_tolerance: [0.5, 3],
    stress_contrast_ratio: [0.1, 1],
    melody_min_similarity: [0.1, 0.9],
    fall_match_ratio: [0.1, 1],
    rise_match_ratio: [0.1, 1],
};

// What's wrong with scoringOptions (omitted and null are fine), or null.
function scoringOptionsProblem(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) return 'scoringOptions must be an object or null.';
    const o = value as Record<string, unknown>;
    for (const key of ['targeted_words', 'stress_words']) {
        if (typeof o[key] !== 'string') return `scoringOptions.${key} must be text.`;
    }
    if (o.stress_words_ipa !== undefined && typeof o.stress_words_ipa !== 'string') {
        return 'scoringOptions.stress_words_ipa must be text.';
    }
    if (typeof o.strict_connected_speech !== 'boolean') return 'scoringOptions.strict_connected_speech must be true or false.';
    if (o.stress_source !== 'dictionary' && o.stress_source !== 'reference') {
        return 'scoringOptions.stress_source must be dictionary or reference.';
    }
    for (const [key, [min, max]] of Object.entries(SCORING_RANGES)) {
        const n = o[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
            return `scoringOptions.${key} must be a number from ${min} to ${max}.`;
        }
    }
    const known = new Set([
        'targeted_words', 'stress_words', 'stress_words_ipa', 'strict_connected_speech', 'stress_source', ...Object.keys(SCORING_RANGES),
    ]);
    const unknown = Object.keys(o).find((k) => !known.has(k));
    return unknown ? `scoringOptions has an unknown option: ${unknown}.` : null;
}

// Prisma's way of storing a JSON column as SQL NULL.
const scoringOptionsData = (value: ScoringOptions | null | undefined) =>
    value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue | undefined);

// For optional text fields (media, explanation): text, null, or omitted.
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

// The 500 message when the item saved but its pasted images couldn't be moved.
// The item still points at the pending copies (kept for a day), so saving the
// item again from Edit retries the move.
function pendingImagesFailed(itemId: number, verb: string, err: any): string {
    console.error(`❌ Moving pending images of question item ${itemId} failed:`, err);
    return `Question item ${itemId} was ${verb}, but its pasted images couldn't be stored (${err.message}). Open it with Edit and save again.`;
}

// Loaded with every question item, for questionItemJson.
export const WITH_AUDIO = { audio: true, trailingAudio: true } satisfies Prisma.QuestionItemInclude;
type ItemWithAudio = Prisma.QuestionItemGetPayload<{ include: typeof WITH_AUDIO }>;

// A question item as the API returns it: its audio and trailing audio as
// objects ({ id, url, text, … }, see audioJson), or null.
export function questionItemJson<T extends ItemWithAudio>(item: T) {
    return {
        ...item,
        audio: item.audio && audioJson(item.audio),
        trailingAudio: item.trailingAudio && audioJson(item.trailingAudio),
    };
}

// What's wrong with the audioId and trailingAudioId sent (omitted and null are
// fine), or null.
async function audioIdsProblem(body: ItemBody): Promise<string | null> {
    for (const name of ['audioId', 'trailingAudioId'] as const) {
        const value = body[name];
        if (value === undefined || value === null) continue;
        if (!Number.isInteger(value) || value < 1) return `${name} must be an audio id, or null.`;
        if (!(await prisma.audio.findUnique({ where: { id: value }, select: { id: true } }))) {
            return `${name}: audio ${value} does not exist.`;
        }
    }
    return null;
}

// A Shadowing question (format 9) must have audio, saying its question text.
// Checked on what the item will be once saved. Null when fine.
async function shadowingProblem(format: number, questionText: string | null, audioId: number | null): Promise<string | null> {
    if (format !== 9) return null;
    if (audioId === null) return 'A Shadowing question needs audio: generate a voice, or pick one from the library.';
    const audio = await prisma.audio.findUnique({ where: { id: audioId }, select: { text: true } });
    if (audio && plainText(audio.text) !== plainText(questionText)) {
        return `A Shadowing question's audio must say its question text, but the audio says “${audio.text}”.`;
    }
    return null;
}

class QuestionItemController {
    // GET /question-items — list all question items, ordered by itemNumber.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const items = await prisma.questionItem.findMany({ orderBy: { itemNumber: 'asc' }, include: WITH_AUDIO });
            res.json(items.map(questionItemJson));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question items.' });
        }
    }

    // POST /question-items — create a question item from
    // { itemNumber, itemGroupId, questionText?, questionPrompt?, answerKey?, choices?, format? (default 1), media?, audioId?, trailingAudioId?, explanation?, showExplanationWhenCorrect?, checkOrder?, halfHandsFree?, hideText?, scoringOptions? }.
    public async create(req: Request, res: Response): Promise<void> {
        try {
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audioId, trailingAudioId, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, hideText, scoringOptions, itemGroupId } = req.body as ItemBody;
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
            if (checkOrder !== undefined && typeof checkOrder !== 'boolean') {
                res.status(400).send({ message: 'checkOrder must be true or false.' });
                return;
            }
            if (halfHandsFree !== undefined && typeof halfHandsFree !== 'boolean') {
                res.status(400).send({ message: 'halfHandsFree must be true or false.' });
                return;
            }
            if (hideText !== undefined && typeof hideText !== 'boolean') {
                res.status(400).send({ message: 'hideText must be true or false.' });
                return;
            }
            const scoringProblem = scoringOptionsProblem(scoringOptions);
            if (scoringProblem) {
                res.status(400).send({ message: scoringProblem });
                return;
            }
            if (itemNumber == null || itemGroupId == null) {
                res.status(400).send({ message: 'itemNumber and itemGroupId are required.' });
                return;
            }
            const audioProblem =
                (await audioIdsProblem(req.body as ItemBody)) ??
                (await shadowingProblem(format ?? 1, questionText ?? null, audioId ?? null));
            if (audioProblem) {
                res.status(400).send({ message: audioProblem });
                return;
            }
            const created = await prisma.questionItem.create({
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audioId, trailingAudioId, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, hideText, scoringOptions: scoringOptionsData(scoringOptions), itemGroupId },
                include: WITH_AUDIO,
            });
            let item;
            try {
                item = await savePendingImages(created);
            } catch (err: any) {
                res.status(500).send({ message: pendingImagesFailed(created.id, 'created', err) });
                return;
            }
            res.status(201).json(questionItemJson(item));
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
                        // The same audios: they're shared, and never change.
                        audioId: source.audioId,
                        trailingAudioId: source.trailingAudioId,
                        showExplanationWhenCorrect: source.showExplanationWhenCorrect,
                        checkOrder: source.checkOrder,
                        halfHandsFree: source.halfHandsFree,
                        hideText: source.hideText,
                        scoringOptions: source.scoringOptions ?? Prisma.DbNull,
                        // media is filled in below, once its images are copied.
                        itemGroupId: source.itemGroupId,
                    },
                    include: WITH_AUDIO,
                });
            });
            if (source.media) {
                try {
                    const media = await copyImages(QUESTION_ITEM_IMAGES, source.media, source.id, copy.id);
                    const updated = await prisma.questionItem.update({ where: { id: copy.id }, data: { media }, include: WITH_AUDIO });
                    res.status(201).json(questionItemJson(updated));
                } catch (err: any) {
                    console.error(`❌ Copying images of question item ${source.id} failed:`, err);
                    res.status(500).send({
                        message: `Question item ${copy.id} was cloned without its media: copying the images failed (${err.message}).`,
                    });
                }
                return;
            }
            res.status(201).json(questionItemJson(copy));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error cloning question item.' });
        }
    }

    // GET /question-items/:id — fetch one question item (with its parent item group).
    public async findOne(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const item = await prisma.questionItem.findUnique({ where: { id }, include: { itemGroup: true, ...WITH_AUDIO } });
            if (!item) {
                res.status(404).send({ message: `Question item ${req.params.id} not found.` });
                return;
            }
            res.json(questionItemJson(item));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving question item.' });
        }
    }

    // PUT /question-items/:id — update any of itemNumber, questionText, questionPrompt, answerKey, choices, format,
    // media, audioId, trailingAudioId, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, hideText,
    // scoringOptions, itemGroupId. Saving media also deletes the item's images it no longer uses.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audioId, trailingAudioId, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, hideText, scoringOptions, itemGroupId } = req.body as ItemBody;
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
            if (checkOrder !== undefined && typeof checkOrder !== 'boolean') {
                res.status(400).send({ message: 'checkOrder must be true or false.' });
                return;
            }
            if (halfHandsFree !== undefined && typeof halfHandsFree !== 'boolean') {
                res.status(400).send({ message: 'halfHandsFree must be true or false.' });
                return;
            }
            if (hideText !== undefined && typeof hideText !== 'boolean') {
                res.status(400).send({ message: 'hideText must be true or false.' });
                return;
            }
            const scoringProblem = scoringOptionsProblem(scoringOptions);
            if (scoringProblem) {
                res.status(400).send({ message: scoringProblem });
                return;
            }
            let audioProblem = await audioIdsProblem(req.body as ItemBody);
            // The Shadowing rule, on the item as it will be, when this changes any of what it's about.
            if (!audioProblem && (format !== undefined || questionText !== undefined || audioId !== undefined)) {
                const current = await prisma.questionItem.findUnique({
                    where: { id },
                    select: { format: true, questionText: true, audioId: true },
                });
                if (current) {
                    audioProblem = await shadowingProblem(
                        format ?? current.format,
                        questionText === undefined ? current.questionText : questionText,
                        audioId === undefined ? current.audioId : audioId,
                    );
                }
            }
            if (audioProblem) {
                res.status(400).send({ message: audioProblem });
                return;
            }
            let item = await prisma.questionItem.update({
                where: { id },
                data: { itemNumber, questionText, questionPrompt, answerKey, choices, format, media, audioId, trailingAudioId, explanation, showExplanationWhenCorrect, checkOrder, halfHandsFree, hideText, scoringOptions: scoringOptionsData(scoringOptions), itemGroupId }, // undefined fields are left unchanged
                include: WITH_AUDIO,
            });
            if (media !== undefined) {
                try {
                    item = await savePendingImages(item);
                } catch (err: any) {
                    res.status(500).send({ message: pendingImagesFailed(id, 'saved', err) });
                    return;
                }
            }
            res.json(questionItemJson(item));
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

    // DELETE /question-items/:id — remove a question item and its images. Its
    // audios stay (other questions or the library may use them); unused ones
    // are deleted after a day (deleteUnusedAudios).
    public async delete(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            await prisma.questionItem.delete({ where: { id } });
            res.status(204).send();
            deleteAllImages(QUESTION_ITEM_IMAGES, id).catch((err) =>
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
}

export default new QuestionItemController();
