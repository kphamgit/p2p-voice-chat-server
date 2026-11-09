import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { ACCESS_TOKEN_EXPIRES_IN, signAuthToken, verifyAuthToken } from '../jwt.js';
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken } from '../refreshTokens.js';

const SALT_ROUNDS = 10;

type SessionUser = { id: number; name: string; role: string };

// Sign a 7-day JWT for a user and return it with a safe (hash-free) user
// object. `name` is the login username; `role` drives authorization
// (student/admin). Used by sign-ins that don't ask for a refresh token (the
// admin and web client apps).
function issueToken(user: SessionUser) {
    const token = signAuthToken({ sub: user.id, name: user.name, role: user.role });
    return { token, user: { id: user.id, name: user.name, role: user.role } };
}

// A short-lived access token plus a refresh token (see src/refreshTokens.ts),
// for the student app. `refreshToken` continues an existing sign-in (from
// rotation); without it, a new one is started. `expiresIn` is the access
// token's lifetime in seconds, so the app can refresh just before it runs out
// without trusting the phone's clock.
async function issueSession(user: SessionUser, refreshToken?: string) {
    const token = signAuthToken({ sub: user.id, name: user.name, role: user.role }, ACCESS_TOKEN_EXPIRES_IN);
    return {
        token,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
        refreshToken: refreshToken ?? (await issueRefreshToken(user.id)),
        user: { id: user.id, name: user.name, role: user.role },
    };
}

const SESSION_ENDED = 'Your sign-in has ended. Please sign in again.';

class AuthController {

    // POST /auth/register — create a user (unique username) with a hashed password.
    public async register(req: Request, res: Response): Promise<void> {
        try {
            const { name, password, wantRefreshToken } = req.body as {
                name?: string;
                password?: string;
                wantRefreshToken?: boolean;
            };
            if (!name || !password) {
                res.status(400).send({ message: 'username and password are required.' });
                return;
            }
            const existing = await prisma.user.findUnique({ where: { name } });
            if (existing) {
                res.status(409).send({ message: 'That username is already taken.' });
                return;
            }
            const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
            const user = await prisma.user.create({
                data: { name, passwordHash },
            });
            res.status(201).json(wantRefreshToken === true ? await issueSession(user) : issueToken(user));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error registering user.' });
        }
    }

    // POST /auth/login — verify credentials and return a JWT.
    public async login(req: Request, res: Response): Promise<void> {
        try {
            const { name, password, wantRefreshToken } = req.body as {
                name?: string;
                password?: string;
                wantRefreshToken?: boolean;
            };
            if (!name || !password) {
                res.status(400).send({ message: 'username and password are required.' });
                return;
            }
            const user = await prisma.user.findUnique({ where: { name } });
            // Return the same 401 whether the username is unknown or the password
            // is wrong, so the endpoint doesn't reveal which usernames exist.
            if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
                res.status(401).send({ message: 'Invalid username or password.' });
                return;
            }
            res.json(wantRefreshToken === true ? await issueSession(user) : issueToken(user));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error logging in.' });
        }
    }

    // POST /auth/refresh — trade { refreshToken } for a new access token and
    // refresh token (the old one stops working). 401 if it's unknown, expired,
    // revoked, or was already used.
    public async refresh(req: Request, res: Response): Promise<void> {
        try {
            const { refreshToken } = req.body as { refreshToken?: unknown };
            if (typeof refreshToken !== 'string' || !refreshToken) {
                res.status(400).send({ message: 'refreshToken is required.' });
                return;
            }
            const rotated = await rotateRefreshToken(refreshToken);
            const user = rotated && (await prisma.user.findUnique({ where: { id: rotated.userId } }));
            if (!rotated || !user) {
                res.status(401).send({ message: SESSION_ENDED });
                return;
            }
            // Name and role come fresh from the database, so changes made in
            // the admin reach the app within one access token's lifetime.
            res.json(await issueSession(user, rotated.refreshToken));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error refreshing sign-in.' });
        }
    }

    // POST /auth/logout — sign out the device that holds { refreshToken }: it
    // and every refresh token issued from the same sign-in stop working.
    // Always 204, so it can't be used to probe for valid tokens. (Access
    // tokens already issued still work until they expire, at most 15 minutes.)
    public async logout(req: Request, res: Response): Promise<void> {
        try {
            const { refreshToken } = req.body as { refreshToken?: unknown };
            if (typeof refreshToken === 'string' && refreshToken) {
                await revokeRefreshToken(refreshToken);
            }
            res.status(204).send();
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error signing out.' });
        }
    }

    // POST /auth/upgrade — one-time move for student app installs that signed
    // in before refresh tokens existed: trades the 7-day token they saved
    // (the Authorization header) for a session with a refresh token, so those
    // students don't have to sign in again. Short access tokens are refused,
    // so a stolen 15-minute token can't be stretched into a 90-day sign-in.
    // Remove once the student app versions without refresh tokens are gone.
    public async upgrade(req: Request, res: Response): Promise<void> {
        try {
            const payload = verifyAuthToken(req.headers.authorization!.slice('Bearer '.length).trim());
            const lifetime = (payload.exp ?? 0) - (payload.iat ?? 0);
            if (lifetime <= ACCESS_TOKEN_EXPIRES_IN) {
                res.status(400).send({ message: 'Only a 7-day sign-in token can be upgraded.' });
                return;
            }
            const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
            if (!user) {
                res.status(401).send({ message: SESSION_ENDED });
                return;
            }
            res.json(await issueSession(user));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error upgrading sign-in.' });
        }
    }

    // GET /auth/me — return the current user. Assumes requireAuth ran first, so
    // req.user is present; re-reads the DB for fresh, hash-free profile data.
    public async me(req: Request, res: Response): Promise<void> {
        try {
            const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
            if (!user) {
                // Token was valid but the user has since been deleted.
                res.status(404).send({ message: 'User not found.' });
                return;
            }
            res.json({ id: user.id, name: user.name, role: user.role });
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error fetching user.' });
        }
    }
}

export default new AuthController();
