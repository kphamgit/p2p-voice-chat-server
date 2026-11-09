import jwt from 'jsonwebtoken';

// Token lifetimes in seconds. Numeric form avoids the StringValue typing
// pitfall in @types/jsonwebtoken's `expiresIn`.
//
// A sign-in without a refresh token (the admin and web client apps) gets a
// 7-day token. The student app asks for a refresh token too (see
// src/refreshTokens.ts), so its access tokens can be short: 15 minutes.
export const JWT_EXPIRES_IN = 60 * 60 * 24 * 7;
export const ACCESS_TOKEN_EXPIRES_IN = 15 * 60;

// Claims we put in (and read back out of) auth tokens.
export interface AuthTokenPayload {
    sub: number;
    name: string;
    role: string;
}

// Read the signing secret at call time so a missing value surfaces as a 500
// on the request rather than crashing the server at startup.
export function getJwtSecret(): string {
    const secret = process.env['JWT_SECRET'];
    if (!secret) {
        throw new Error('JWT_SECRET is not set.');
    }
    return secret;
}

export function signAuthToken(payload: AuthTokenPayload, expiresIn: number = JWT_EXPIRES_IN): string {
    return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

// Verify a token's signature and expiry, returning its decoded claims.
// Throws (JsonWebTokenError / TokenExpiredError) on any failure.
export function verifyAuthToken(token: string): jwt.JwtPayload {
    return jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
}
