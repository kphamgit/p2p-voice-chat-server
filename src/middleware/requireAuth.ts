import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken } from '../jwt.js';

// The authenticated user we attach to the request after verifying a token.
export interface AuthUser {
    id: number;
    name: string;
    role: string;
}

// Augment Express's Request so `req.user` is typed on protected routes.
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

// Guard a route: require a valid `Authorization: Bearer <token>` header.
// On success attaches `req.user` and calls next(); otherwise responds 401.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).send({ message: 'Missing or malformed Authorization header.' });
        return;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
        const payload = verifyAuthToken(token);
        req.user = {
            id: Number(payload.sub),
            name: String(payload.name),
            // Older tokens (issued before roles existed) have no role → treat as student.
            role: String(payload.role ?? 'student'),
        };
        next();
    } catch {
        // Covers bad signature, malformed token, and expiry.
        res.status(401).send({ message: 'Invalid or expired token.' });
    }
}
