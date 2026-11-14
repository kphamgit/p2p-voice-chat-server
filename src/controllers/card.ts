import { Request, Response } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import {
    ANSWER_TIME_LIMIT_MS,
    FAST_ANSWER_MS,
    applySm2,
    gradeAnswer,
    startOfReviewDay,
} from '../spacedRepetition.js';

// The vocabulary review (spaced repetition): see src/spacedRepetition.ts for the
// scheduling and grading, and docs/sm2-port.md for the design.

// Signs the correct option's key. Without it no question can be built or
// checked (a per-process fallback would grade every answer given before a
// restart as wrong), so the endpoints that need it answer 503.
const answerSecret = () => process.env['CARD_ANSWER_SECRET'] || null;
const NO_SECRET = { message: "CARD_ANSWER_SECRET isn't set on the server." };

interface Option {
    key: string; // opaque: only the server can tell which key is the correct one
    definition: string;
}
interface Question {
    nonce: string;
    options: Option[];
}

// A card that can supply a wrong answer.
interface PoolCard {
    text: string;
    partOfSpeech: string;
    definition: string;
}

// Cards that can supply a wrong answer, one per distinct definition. Cards
// without a definition are left out.
async function distractorPool(): Promise<PoolCard[]> {
    const cards = await prisma.card.findMany({
        where: { definition: { not: '' } },
        select: { text: true, partOfSpeech: true, definition: true },
        orderBy: { id: 'asc' },
    });
    const seen = new Set<string>();
    return cards.filter((c) => !seen.has(c.definition) && seen.add(c.definition));
}

function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
}

// The key of a question's correct option: an HMAC of (user, card, nonce) with
// the server secret, so it looks just as random as the wrong options' keys.
// The client can't tell which option is right; only the server can check an answer.
function correctOptionKey(secret: string, userId: number, cardId: number, nonce: string): string {
    return crypto.createHmac('sha256', secret).update(`${userId}:${cardId}:${nonce}`).digest('hex').slice(0, 16);
}

// Compares in constant time, so the response time doesn't reveal how much of a key matched.
function sameKey(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// A multiple-choice question for a card: its own definition plus up to 3 wrong
// ones, preferring the same part of speech (a noun's definition is easy to rule
// out for a verb). Other cards for the same word are skipped, since another
// sense of the word can read like a correct answer.
function buildQuestion(
    secret: string,
    card: { id: number; text: string; definition: string; partOfSpeech: string },
    userId: number,
    pool: PoolCard[],
): Question {
    const word = card.text.trim().toLowerCase();
    const candidates = shuffle(
        pool.filter((c) => c.definition !== card.definition && c.text.trim().toLowerCase() !== word),
    );
    const samePos = candidates.filter((c) => c.partOfSpeech === card.partOfSpeech).map((c) => c.definition);
    const otherPos = candidates.filter((c) => c.partOfSpeech !== card.partOfSpeech).map((c) => c.definition);
    const distractors = [...samePos, ...otherPos].slice(0, 3);

    const nonce = crypto.randomBytes(8).toString('hex');
    const options: Option[] = [
        { key: correctOptionKey(secret, userId, card.id, nonce), definition: card.definition },
        ...distractors.map((definition) => ({ key: crypto.randomBytes(8).toString('hex'), definition })),
    ];
    return { nonce, options: shuffle(options) };
}

// A positive whole number from a route or query parameter, or null.
function positiveInt(value: unknown): number | null {
    const n = Number(value);
    return typeof value === 'string' && Number.isInteger(n) && n > 0 ? n : null;
}

const REVIEW_LOG_LIMIT = 500;

export default class CardController {
    // GET /cards/due — the student's due cards: only cards they added to their
    // review (a CardReview exists) whose nextReviewAt is now or past (or unset).
    // Each comes with a question (nonce + shuffled options) but, for the student,
    // without its definition (the answer endpoint returns it). An admin may pass
    // ?userId= to see another user's due cards, definitions included.
    // Response: { dueCards, timeLimitMs, fastAnswerMs } (the client's countdown uses the limits).
    static async due(req: Request, res: Response): Promise<void> {
        const secret = answerSecret();
        if (!secret) {
            res.status(503).send(NO_SECRET);
            return;
        }
        let userId = req.user!.id;
        if (req.query['userId'] !== undefined) {
            if (req.user!.role !== 'admin') {
                res.status(403).send({ message: "Only an admin can see another user's due cards." });
                return;
            }
            const id = positiveInt(req.query['userId']);
            if (!id || !(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) {
                res.status(404).send({ message: 'User not found.' });
                return;
            }
            userId = id;
        }
        const now = new Date();
        const reviews = await prisma.cardReview.findMany({
            where: { userId, OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] },
            include: { card: true },
            orderBy: { id: 'asc' },
        });
        const pool = await distractorPool();
        const includeDefinition = userId !== req.user!.id;
        const dueCards = reviews
            // A card without a definition can't be quizzed; it stays due until one is added.
            .filter((r) => r.card.definition)
            .map(({ card, easiness, interval, repetitions, nextReviewAt }) => ({
                id: card.id,
                text: card.text,
                ...(includeDefinition && { definition: card.definition }),
                partOfSpeech: card.partOfSpeech,
                ...buildQuestion(secret, card, req.user!.id, pool),
                easiness,
                interval,
                repetitions,
                nextReviewAt,
            }));
        res.json({ dueCards, timeLimitMs: ANSWER_TIME_LIMIT_MS, fastAnswerMs: FAST_ANSWER_MS });
    }

    // GET /cards/:id/question — a fresh question (new nonce, wrong answers and
    // order) for one card. Used when a missed card comes back in the same session.
    static async question(req: Request, res: Response): Promise<void> {
        const secret = answerSecret();
        if (!secret) {
            res.status(503).send(NO_SECRET);
            return;
        }
        const id = positiveInt(req.params['id']);
        const card = id ? await prisma.card.findUnique({ where: { id } }) : null;
        if (!card) {
            res.status(404).send({ message: 'Card not found.' });
            return;
        }
        res.json(buildQuestion(secret, card, req.user!.id, await distractorPool()));
    }

    // POST /cards/:id/answer { nonce, choice, latencyMs, chosenDefinition } — check
    // and grade a multiple-choice answer. `choice` is an option key, "dont_know" or
    // "timeout"; latencyMs is the time from the options appearing to the answer.
    // chosenDefinition (the picked option's text) is only logged, for a wrong
    // answer, so the admin can see which meaning was confused; grading never uses it.
    //
    // Only an answer to a DUE card is graded (SM-2). Grading moves the card to
    // tomorrow or later, so any further answer that day (a missed card shown
    // again in the same session) is practice: checked, but the schedule is left
    // alone. The server decides this, never the client, so a student can't learn
    // the right key from a practice attempt and then resubmit it for a grade.
    //
    // Response: { graded, correct, correctKey, definition, quality, reason, lapsed }.
    static async answer(req: Request, res: Response): Promise<void> {
        const secret = answerSecret();
        if (!secret) {
            res.status(503).send(NO_SECRET);
            return;
        }
        const id = positiveInt(req.params['id']);
        const card = id ? await prisma.card.findUnique({ where: { id } }) : null;
        if (!card) {
            res.status(404).send({ message: 'Card not found.' });
            return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const nonce = typeof body['nonce'] === 'string' ? body['nonce'] : '';
        if (!nonce) {
            res.status(400).send({ message: 'nonce is required.' });
            return;
        }
        const choice = typeof body['choice'] === 'string' ? body['choice'] : '';
        const latency = Number(body['latencyMs'] ?? 0);
        if (!Number.isFinite(latency)) {
            res.status(400).send({ message: 'latencyMs must be a number.' });
            return;
        }
        const latencyMs = Math.max(0, Math.round(latency));
        const userId = req.user!.id;

        const correctKey = correctOptionKey(secret, userId, card.id, nonce);
        const correct = sameKey(choice, correctKey);
        const grade = gradeAnswer(correct, choice, latencyMs);
        let { reason } = grade;

        const review = await prisma.cardReview.upsert({
            where: { userId_cardId: { userId, cardId: card.id } },
            update: {},
            create: { userId, cardId: card.id, easiness: 2.5, interval: 0, repetitions: 0 },
        });
        const now = new Date();
        const graded = review.nextReviewAt === null || review.nextReviewAt <= now;
        if (graded) {
            applySm2(review, grade.quality, now);
            await prisma.cardReview.update({
                where: { id: review.id },
                data: {
                    easiness: review.easiness,
                    interval: review.interval,
                    repetitions: review.repetitions,
                    nextReviewAt: review.nextReviewAt,
                },
            });
            reason += ` Next review in ${review.interval} day${review.interval === 1 ? '' : 's'}.`;
        } else {
            reason += ' Practice only: this card was already graded today.';
        }

        await prisma.reviewLog.create({
            data: {
                userId,
                cardId: card.id,
                result: grade.result,
                chosenDefinition:
                    grade.result === 'wrong' && typeof body['chosenDefinition'] === 'string'
                        ? body['chosenDefinition'].slice(0, 2000)
                        : '',
                latencyMs,
                quality: grade.quality,
                graded,
                intervalDays: review.interval,
                easiness: review.easiness,
                timeLimitMs: ANSWER_TIME_LIMIT_MS,
                fastAnswerMs: FAST_ANSWER_MS,
            },
        });

        res.json({
            graded,
            correct,
            correctKey,
            definition: card.definition,
            quality: grade.quality,
            reason,
            lapsed: grade.quality < 4,
        });
    }

    // POST /cards/from-sense/:senseId/add-to-review — add a dictionary sense's
    // card to the student's review, creating the card from the sense first if
    // there's none yet (text = head word, definition, partOfSpeech = POS name).
    // The student has only just met the word, so it isn't graded now (the client
    // shows a study card); the first quiz is due at the start of tomorrow.
    // Repeating it changes nothing. Response: the card plus `created` (whether it
    // was just added to this student's review).
    static async addSenseToReview(req: Request, res: Response): Promise<void> {
        const senseId = positiveInt(req.params['senseId']);
        if (!senseId) {
            res.status(404).send({ message: 'Sense not found.' });
            return;
        }
        let card = await prisma.card.findFirst({ where: { senseId }, orderBy: { id: 'asc' } });
        if (!card) {
            const sense = await prisma.sense.findUnique({
                where: { id: senseId },
                include: { pos: { include: { dictEntry: true } } },
            });
            if (!sense) {
                res.status(404).send({ message: 'Sense not found.' });
                return;
            }
            card = await prisma.card.create({
                data: {
                    senseId,
                    text: sense.pos.dictEntry.headWord,
                    definition: sense.definition ?? '',
                    partOfSpeech: sense.pos.name ?? '',
                },
            });
        }
        const userId = req.user!.id;
        let created = false;
        try {
            await prisma.cardReview.create({
                data: {
                    userId,
                    cardId: card.id,
                    easiness: 2.5,
                    interval: 0,
                    repetitions: 0,
                    nextReviewAt: startOfReviewDay(new Date(), 1), // first quiz tomorrow
                },
            });
            created = true;
        } catch (err) {
            // Already in this student's review (unique userId + cardId): nothing to do.
            if ((err as { code?: string }).code !== 'P2002') throw err;
        }
        const { id, text, definition, partOfSpeech, difficulty } = card;
        res.json({ id, text, definition, partOfSpeech, difficulty, created });
    }

    // GET /cards/review-log?userId=&cardId= — admin only: a student's review
    // answers, newest first (at most REVIEW_LOG_LIMIT), practice included.
    // Response: { entries, limit }.
    static async reviewLog(req: Request, res: Response): Promise<void> {
        if (req.query['userId'] === undefined || req.query['userId'] === '') {
            res.status(400).send({ message: 'userId is required.' });
            return;
        }
        const userId = positiveInt(req.query['userId']);
        const cardId = req.query['cardId'] ? positiveInt(req.query['cardId']) : undefined;
        if (!userId || cardId === null) {
            res.status(400).send({ message: 'userId and cardId must be whole numbers.' });
            return;
        }
        const logs = await prisma.reviewLog.findMany({
            where: { userId, ...(cardId && { cardId }) },
            include: { card: { select: { text: true, partOfSpeech: true, definition: true } } },
            orderBy: [{ answeredAt: 'desc' }, { id: 'desc' }],
            take: REVIEW_LOG_LIMIT,
        });
        const entries = logs.map(({ card, userId: _userId, ...log }) => ({
            ...log,
            text: card.text,
            partOfSpeech: card.partOfSpeech,
            definition: card.definition,
        }));
        res.json({ entries, limit: REVIEW_LOG_LIMIT });
    }
}
