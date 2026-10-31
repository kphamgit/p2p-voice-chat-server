import { Request, Response } from 'express';
import { prisma } from '../prisma.js';

class UserController {

    // GET /users — list every user. Fields are selected explicitly so the
    // password hash is never sent to the client.
    public async findAll(_req: Request, res: Response): Promise<void> {
        try {
            const users = await prisma.user.findMany({
                select: { id: true, name: true, role: true, createdAt: true },
                orderBy: { id: 'asc' },
            });
            res.status(200).json(users);
        } catch (err: any) {
            res.status(500).send({ message: err.message || 'Error retrieving users.' });
        }
    }
}

export default new UserController();
