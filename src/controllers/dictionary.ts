import { Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { SyncBusyError, syncDictionary, syncErrorMessage } from '../dictionarySync.js';

export default class DictionaryController {
    // POST /dictionary/sync { dryRun?: boolean } — sync the dictionary from the
    // Django database (DJANGO_DATABASE_URL); see src/dictionarySync.ts.
    // Returns { tables: [{ table, new, changed, deleted }], applied }.
    static async sync(req: Request, res: Response): Promise<void> {
        const djangoUrl = process.env['DJANGO_DATABASE_URL'];
        if (!djangoUrl) {
            res.status(503).send({ message: "DJANGO_DATABASE_URL isn't set on the server." });
            return;
        }
        const dryRun = req.body?.dryRun === true;
        try {
            res.json(await syncDictionary(prisma, djangoUrl, dryRun));
        } catch (err) {
            if (err instanceof SyncBusyError) {
                res.status(409).send({ message: err.message });
                return;
            }
            console.error('Dictionary sync failed:', err);
            res.status(500).send({ message: `Sync failed; nothing was changed. ${syncErrorMessage(err)}` });
        }
    }

    // GET /dictionary/entries?word=…&source=… — the entries for a word (exact
    // match, ignoring case) with their parts of speech, senses (and examples)
    // and idioms in order. From one source if `source` is given (e.g.
    // "ho-ngoc-duc-stardict"), otherwise from every source.
    static async lookup(req: Request, res: Response): Promise<void> {
        const word = typeof req.query['word'] === 'string' ? req.query['word'].trim() : '';
        if (!word) {
            res.status(400).send({ message: 'word is required.' });
            return;
        }
        const source = typeof req.query['source'] === 'string' && req.query['source'] ? req.query['source'] : undefined;
        const entries = await prisma.dictEntry.findMany({
            where: { headWord: { equals: word, mode: 'insensitive' }, ...(source && { source }) },
            orderBy: [{ source: 'asc' }, { id: 'asc' }],
            include: {
                partOfSpeeches: {
                    orderBy: { id: 'asc' },
                    include: {
                        senses: {
                            orderBy: [{ senseNumber: 'asc' }, { id: 'asc' }],
                            include: { examples: { orderBy: [{ exampleNumber: 'asc' }, { id: 'asc' }] } },
                        },
                        idioms: { orderBy: { id: 'asc' } },
                    },
                },
            },
        });
        res.json(entries);
    }
}
