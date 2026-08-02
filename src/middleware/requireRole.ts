import { Request, Response, NextFunction } from 'express';

// Route guard: allow only users whose role is one of `roles`. Must run AFTER
// requireAuth (which sets req.user, including req.user.role from the token).
// Returns 403 for an authenticated user without a matching role, 401 if somehow
// unauthenticated.
export function requireRole(...roles: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).send({ message: 'Not authenticated.' });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).send({ message: 'Forbidden: requires role ' + roles.join(' or ') + '.' });
            return;
        }
        next();
    };
}
