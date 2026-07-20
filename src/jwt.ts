import jwt from 'jsonwebtoken';

// Token lifetime in seconds (7 days). Numeric form avoids the StringValue
// typing pitfall in @types/jsonwebtoken's `expiresIn`.
const JWT_EXPIRES_IN = 60 * 60 * 24 * 7;

// Claims we put in (and read back out of) auth tokens.
export interface AuthTokenPayload {
    sub: number;
    name: string;
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

export function signAuthToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

// Verify a token's signature and expiry, returning its decoded claims.
// Throws (JsonWebTokenError / TokenExpiredError) on any failure.
export function verifyAuthToken(token: string): jwt.JwtPayload {
    return jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
}
