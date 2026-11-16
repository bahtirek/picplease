import { randomUUID } from 'node:crypto';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const tokens = new TokenService();

  it('generates 32-byte secrets and token parts that do not repeat', () => {
    const secrets = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const secret = tokens.generateSecret();
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
      secrets.add(secret);
      const { random } = tokens.generateToken();
      expect(Buffer.from(random, 'base64url')).toHaveLength(32);
      secrets.add(random);
    }
    expect(secrets.size).toBe(2000);
  });

  it('hashes to SHA-256 hex and verifies the original value', () => {
    const secret = tokens.generateSecret();
    const hash = tokens.hash(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret);
    expect(tokens.verify(secret, hash)).toBe(true);

    const { random, hash: tokenHash } = tokens.generateToken();
    expect(tokens.verify(random, tokenHash)).toBe(true);
  });

  it('fails verification for a wrong value or a missing or malformed hash', () => {
    const hash = tokens.hash(tokens.generateSecret());
    expect(tokens.verify(tokens.generateSecret(), hash)).toBe(false);
    expect(tokens.verify('', hash)).toBe(false);
    expect(tokens.verify('x', null)).toBe(false);
    expect(tokens.verify('x', undefined)).toBe(false);
    expect(tokens.verify('x', 'abc')).toBe(false);
    expect(tokens.verify('x', hash.toUpperCase().replace(/./, 'Z'))).toBe(false);
  });

  it('format and parse round-trip', () => {
    const sessionId = randomUUID();
    const { random } = tokens.generateToken();
    const token = tokens.format(sessionId, random);
    expect(token).toBe(`${sessionId}.${random}`);
    expect(tokens.parse(token)).toEqual({ sessionId, random });
  });

  it('rejects malformed tokens', () => {
    const id = randomUUID();
    const { random } = tokens.generateToken();
    const malformed = [
      '',
      '.',
      id,
      random,
      `${id}.`,
      `.${random}`,
      `${id}.${random}x`,
      `${id}.${random.slice(1)}`,
      `${id}.${random.slice(1)}+`,
      `not-a-uuid.${random}`,
      `${id}x.${random}`,
      `${id}.${random}.${random}`,
      ` ${id}.${random}`,
    ];
    for (const token of malformed) expect(tokens.parse(token)).toBeNull();
  });
});
