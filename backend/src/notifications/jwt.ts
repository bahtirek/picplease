import { type KeyObject, sign } from 'node:crypto';

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/**
 * Signs a compact JWT with node:crypto. ES256 uses the raw r||s signature (ieee-p1363) that
 * JWS requires; RS256 is PKCS#1 v1.5 with SHA-256.
 */
export function signJwt(
  alg: 'ES256' | 'RS256',
  header: Record<string, string>,
  claims: Record<string, string | number>,
  key: KeyObject,
): string {
  const input = `${b64url(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${b64url(JSON.stringify(claims))}`;
  const signature =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}
