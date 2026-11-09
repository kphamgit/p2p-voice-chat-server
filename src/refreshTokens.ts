// Refresh tokens: how the student app stays signed in without a long-lived
// access token.
//
// Signing in with { wantRefreshToken: true } returns a 15-minute access token
// (the JWT sent with every request) plus a refresh token, a random secret the
// app keeps in the phone's Keychain. When the access token runs out, the app
// trades the refresh token at POST /auth/refresh for a new pair. Each trade
// marks the old refresh token used and issues a new one in the same family
// (one family per sign-in on a device), and pushes the expiry 90 days out, so
// a student who opens the app at least every 90 days never has to sign in
// again.
//
// Reuse detection: a used refresh token presented again (more than a minute
// later) means someone else has a copy, so the whole family is revoked and
// that device must sign in again. The one-minute grace covers an app that
// sent a refresh but lost the response and retries.
//
// Only a SHA-256 hash of each token is stored, so a database leak doesn't
// hand out working tokens.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';

const REFRESH_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 60 * 1000;

// Revoked tokens are kept a week (for looking into problems), then deleted.
const KEEP_REVOKED_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

// A new refresh token for the user, in `familyId` (a new family, i.e. a new
// device sign-in, if omitted).
export async function issueRefreshToken(userId: number, familyId: string = randomUUID()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await prisma.refreshToken.create({
        data: {
            userId,
            familyId,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS),
        },
    });
    return token;
}

async function revokeFamily(familyId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

// Trades a refresh token for a new one (see the top of this file). Returns
// the user it belongs to and the new token, or null if it's unknown,
// expired, revoked, or reused (which also revokes its family).
export async function rotateRefreshToken(token: string): Promise<{ userId: number; refreshToken: string } | null> {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    const now = new Date();
    if (!row || row.revokedAt || row.expiresAt <= now) return null;

    // Mark it used, unless something else already did (so two requests
    // racing with the same token can't both pass as first use).
    const claimed = await prisma.refreshToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
    });
    if (claimed.count === 0) {
        const usedAt = (await prisma.refreshToken.findUnique({ where: { id: row.id } }))?.usedAt;
        if (!usedAt || now.getTime() - usedAt.getTime() > REUSE_GRACE_MS) {
            console.warn(`⚠️ Refresh token reused; revoking sign-in family ${row.familyId} of user ${row.userId}`);
            await revokeFamily(row.familyId);
            return null;
        }
    }
    return { userId: row.userId, refreshToken: await issueRefreshToken(row.userId, row.familyId) };
}

// Signs out the device a refresh token belongs to (revokes its family).
// Unknown tokens are ignored.
export async function revokeRefreshToken(token: string): Promise<void> {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (row) await revokeFamily(row.familyId);
}

// Deletes expired refresh tokens and ones revoked over a week ago.
export async function deleteOldRefreshTokens(): Promise<void> {
    const { count } = await prisma.refreshToken.deleteMany({
        where: {
            OR: [
                { expiresAt: { lt: new Date() } },
                { revokedAt: { lt: new Date(Date.now() - KEEP_REVOKED_MS) } },
            ],
        },
    });
    if (count) console.log(`🧹 Deleted ${count} old refresh token(s)`);
}
