import { Request, Response } from 'express';
import { isTtsProvider, listTtsProviders, synthesizeSpeech, TtsInputError } from '../tts.js';

class TtsController {
    // GET /tts/voices — { providers: [{ id, name, defaultVoice, minRate, maxRate,
    // voices: [{ id, label, group }], error? }] } for Google and ElevenLabs. A
    // provider that can't list its voices comes back with an error instead.
    public async voices(_req: Request, res: Response): Promise<void> {
        res.json({ providers: await listTtsProviders() });
    }

    // GET or POST /tts — speak `text` and return the MP3 (Content-Type:
    // audio/mpeg). Params, from the query string or a JSON body:
    //   text     — what to speak (required)
    //   provider — google (default) or elevenlabs
    //   voice    — one of the provider's voice ids (default: the provider's default)
    //   rate     — speaking rate, 1.0 = normal (Google 0.25–4, ElevenLabs 0.7–1.2)
    // 400 for bad input, 502 if the provider fails.
    public async speak(req: Request, res: Response): Promise<void> {
        const param = (name: string): string | undefined => {
            const value = req.body?.[name] ?? req.query[name];
            return value == null ? undefined : String(value);
        };
        const provider = param('provider') ?? 'google';
        if (!isTtsProvider(provider)) {
            res.status(400).send({ message: 'provider must be google or elevenlabs.' });
            return;
        }
        try {
            const audio = await synthesizeSpeech((param('text') ?? '').trim(), {
                provider,
                rate: Number(param('rate') ?? 1),
                voice: param('voice')?.trim(),
            });
            res.set('Content-Type', 'audio/mpeg');
            res.send(audio);
        } catch (err: any) {
            if (err instanceof TtsInputError) {
                res.status(400).send({ message: err.message });
                return;
            }
            console.error(`❌ Text-to-speech (${provider}) failed:`, err);
            res.status(502).send({ message: 'Text-to-speech failed.' });
        }
    }
}

export default new TtsController();
