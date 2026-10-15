import { Request, Response } from 'express';
import { getTurnIceServers, isTurnConfigured } from '../turn.js';

class TurnController {
    // GET /turn-credentials — ICE servers (Metered TURN URLs + a short-lived
    // username/password) for the voice-chat client. Auth-gated, so only signed-in
    // users can use the relay. 503 when TURN isn't configured; clients then fall
    // back to direct (STUN-only) connections.
    public async get(_req: Request, res: Response): Promise<void> {
        if (!isTurnConfigured()) {
            res.status(503).send({ message: 'TURN is not configured on the server.' });
            return;
        }
        try {
            const iceServers = await getTurnIceServers();
            // Credentials are per-deployment, not per-user, but still shouldn't be cached by proxies.
            res.set('Cache-Control', 'no-store');
            res.json({ iceServers });
        } catch (err: any) {
            console.error('❌ TURN credentials unavailable:', err);
            res.status(502).send({ message: 'Could not get TURN credentials.' });
        }
    }
}

export default new TurnController();
