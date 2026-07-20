import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../prisma.js';
import { signAuthToken } from '../jwt.js';

const SALT_ROUNDS = 10;

// Sign a JWT for a user and return it with a safe (hash-free) user object.
// `name` is the login username.
function issueToken(user: { id: number; name: string }) {
    const token = signAuthToken({ sub: user.id, name: user.name });
    return { token, user: { id: user.id, name: user.name } };
}

class AuthController {

    // POST /auth/register — create a user (unique username) with a hashed password.
    public async register(req: Request, res: Response): Promise<void> {
        try {
            const { name, password } = req.body as {
                name?: string;
                password?: string;
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
            res.status(201).json(issueToken(user));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error registering user.' });
        }
    }

    // POST /auth/login — verify credentials and return a JWT.
    public async login(req: Request, res: Response): Promise<void> {
        try {
            const { name, password } = req.body as { name?: string; password?: string };
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
            res.json(issueToken(user));
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error logging in.' });
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
            res.json({ id: user.id, name: user.name });
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error fetching user.' });
        }
    }
}

export default new AuthController();
