import { Request, Response } from 'express';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

// Load the language model once at startup — it's too slow to load per request.
const nlp = winkNLP(model);
const its = nlp.its;

// Cap input size so one request can't tie up the server.
const MAX_TEXT_LENGTH = 10_000;

class LemmatizeController {

    // POST /lemmatize — lemmatize { text }; returns each word with its lemma
    // (punctuation, numbers, etc. are skipped).
    public async lemmatize(req: Request, res: Response): Promise<void> {
        try {
            const { text } = req.body as { text?: unknown };
            if (typeof text !== 'string' || !text.trim()) {
                res.status(400).send({ message: 'text is required.' });
                return;
            }
            if (text.length > MAX_TEXT_LENGTH) {
                res.status(400).send({ message: `text must be at most ${MAX_TEXT_LENGTH} characters.` });
                return;
            }
            const words = nlp.readDoc(text).tokens().filter((t) => t.out(its.type) === 'word');
            const tokens = words.out() as string[];
            // `its.lemma`'s typings don't match `out()`'s signature (a wink-nlp
            // types bug); it works fine at runtime, hence the cast.
            const lemmas = words.out(its.lemma as any) as string[];
            res.json({ tokens: tokens.map((word, i) => ({ word, lemma: lemmas[i] })) });
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error lemmatizing text.' });
        }
    }
}

export default new LemmatizeController();
