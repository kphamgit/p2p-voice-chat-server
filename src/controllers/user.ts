import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

const ROLES = ['student', 'admin'] as const;
type Role = (typeof ROLES)[number];

// Fields safe to send to the client (never the password hash).
const PUBLIC_USER_FIELDS = { id: true, name: true, role: true, createdAt: true } as const;

class UserController {

    // GET /users — list every user. Fields are selected explicitly so the
    // password hash is never sent to the client.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const users = await prisma.user.findMany({
                select: PUBLIC_USER_FIELDS,
                orderBy: { id: 'asc' },
            });
            res.status(200).json(users);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving users.' });
        }
    }

    // PUT /users/:id — update a user's name and/or role. Undefined fields are
    // left unchanged. Admins can't remove their own admin role, so they can't
    // lock themselves out of the admin app.
    public async update(req: Request, res: Response): Promise<void> {
        try {
            const id = Number(req.params.id);
            const { name, role } = req.body as { name?: string; role?: string };
            if (name !== undefined && !name.trim()) {
                res.status(400).send({ message: 'Username cannot be empty.' });
                return;
            }
            if (role !== undefined && !ROLES.includes(role as Role)) {
                res.status(400).send({ message: `role must be one of: ${ROLES.join(', ')}.` });
                return;
            }
            if (id === req.user?.id && role !== undefined && role !== 'admin') {
                res.status(400).send({ message: "You can't remove your own admin role." });
                return;
            }
            const user = await prisma.user.update({
                where: { id },
                data: { name: name?.trim(), role: role as Role | undefined },
                select: PUBLIC_USER_FIELDS,
            });
            res.json(user);
        } catch (err: any) {
            if (err?.code === 'P2025') {
                res.status(404).send({ message: `User ${req.params.id} not found.` });
                return;
            }
            if (err?.code === 'P2002') {
                res.status(409).send({ message: 'That username is already taken.' });
                return;
            }
            res.status(500).send({ message: err.message || 'Error updating user.' });
        }
    }
}

export default new UserController();
