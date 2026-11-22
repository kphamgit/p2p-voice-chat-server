import { Request, Response } from 'express';
import { listTtsProviders } from '../tts.js';

class TtsController {
    // GET /tts/voices — { providers: [{ id, name, defaultVoice, minRate, maxRate,
    // voices: [{ id, label, group }], error? }] } for Google and ElevenLabs. A
    // provider that can't list its voices comes back with an error instead.
    // (Voices are generated through POST /audios, see src/audio.ts.)
    public async voices(_req: Request, res: Response): Promise<void> {
        res.json({ providers: await listTtsProviders() });
    }
}

export default new TtsController();
