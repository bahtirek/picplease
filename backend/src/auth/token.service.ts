import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** Secrets and the random part of tokens are 32 random bytes (docs/backend/security.md). */
export const RANDOM_BYTES = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 32 bytes as unpadded base64url is always 43 characters.
const RANDOM_PART = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ParsedToken {
  sessionId: string;
  random: string;
}

export interface IssuedToken {
  /** The random part. Combine with the session id via format(); never store or log it. */
  random: string;
  /** hash(random): what the database keeps. */
  hash: string;
}

/**
 * Pairing secrets and bearer tokens. A token is `sessionId.random`, so the guard finds the
 * session by id. Only the SHA-256 of the random part is stored; it can be computed before
 * the session row (and its id) exists.
 */
@Injectable()
export class TokenService {
  /** A pairing secret: 32 random bytes, base64url. */
  generateSecret(): string {
    return randomBytes(RANDOM_BYTES).toString('base64url');
  }

  /** The random part of a bearer token and the hash to store. */
  generateToken(): IssuedToken {
    const random = randomBytes(RANDOM_BYTES).toString('base64url');
    return { random, hash: this.hash(random) };
  }

  format(sessionId: string, random: string): string {
    return `${sessionId}.${random}`;
  }

  /** Returns null for anything that is not exactly `uuid.random43`. */
  parse(token: string): ParsedToken | null {
    const dot = token.indexOf('.');
    if (dot < 0) return null;
    const sessionId = token.slice(0, dot);
    const random = token.slice(dot + 1);
    if (!UUID.test(sessionId) || !RANDOM_PART.test(random)) return null;
    return { sessionId: sessionId.toLowerCase(), random };
  }

  /** SHA-256, lowercase hex. */
  hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /** Constant-time comparison of hash(value) with a stored hash. A missing hash never matches. */
  verify(value: string, expectedHash: string | null | undefined): boolean {
    const actual = Buffer.from(this.hash(value), 'hex');
    // Compare against a fixed dummy when there is nothing valid to compare with, so the
    // work done is the same either way.
    const valid = typeof expectedHash === 'string' && SHA256_HEX.test(expectedHash);
    const expected = Buffer.from(valid ? expectedHash : '0'.repeat(64), 'hex');
    return timingSafeEqual(actual, expected) && valid;
  }
}
