import { generateKeyPairSync, verify } from 'node:crypto';
import { ApnsProvider, classifyApnsResponse } from './apns.provider';
import { classifyFcmResponse } from './fcm.provider';
import { signJwt } from './jwt';

/** Splits a compact JWT into its three parts. */
function parts(jwt: string): [string, string, string] {
  const [h = '', c = '', s = ''] = jwt.split('.');
  return [h, c, s];
}

describe('push adapters', () => {
  it('APNs provider token is an ES256 JWT with kid and iss', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const apns = new ApnsProvider(
      { keyId: 'KEY123', teamId: 'TEAM123', bundleId: 'x', keyFile: '', environment: 'sandbox' },
      privateKey,
    );
    const now = Date.UTC(2026, 10, 16);
    const jwt = apns.providerToken(now);
    const [h, c, s] = parts(jwt);
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({
      alg: 'ES256',
      typ: 'JWT',
      kid: 'KEY123',
    });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: 'TEAM123',
      iat: now / 1000,
    });
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${c}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(s, 'base64url'),
    );
    expect(ok).toBe(true);
    // Reused within the hour, renewed after 50 minutes.
    expect(apns.providerToken(now + 60_000)).toBe(jwt);
    expect(apns.providerToken(now + 51 * 60_000)).not.toBe(jwt);
  });

  it('RS256 JWT verifies with the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const [h, c, s] = parts(signJwt('RS256', {}, { iss: 'svc@example' }, privateKey));
    expect(verify('sha256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'))).toBe(
      true,
    );
  });

  it.each([
    [200, '', 'sent'],
    [410, '{"reason":"Unregistered"}', 'invalid-token'],
    [400, '{"reason":"BadDeviceToken"}', 'invalid-token'],
    [400, '{"reason":"DeviceTokenNotForTopic"}', 'invalid-token'],
    [400, '{"reason":"PayloadTooLarge"}', 'failed'],
    [403, '{"reason":"ExpiredProviderToken"}', 'failed'],
    [503, 'nope', 'failed'],
  ])('APNs %i %s -> %s', (status, body, outcome) => {
    expect(classifyApnsResponse(status, body)).toBe(outcome);
  });

  const fcmError = (status: string, message: string, errorCode?: string) =>
    JSON.stringify({ error: { status, message, details: errorCode ? [{ errorCode }] : [] } });

  it.each([
    [200, '{}', 'sent'],
    [
      404,
      fcmError('NOT_FOUND', 'Requested entity was not found.', 'UNREGISTERED'),
      'invalid-token',
    ],
    [403, fcmError('PERMISSION_DENIED', 'mismatch', 'SENDER_ID_MISMATCH'), 'invalid-token'],
    [
      400,
      fcmError('INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'),
      'invalid-token',
    ],
    [400, fcmError('INVALID_ARGUMENT', 'Invalid JSON payload'), 'failed'],
    [401, fcmError('UNAUTHENTICATED', 'bad auth'), 'failed'],
    [503, 'oops', 'failed'],
  ])('FCM %i -> %s', (status, body, outcome) => {
    expect(classifyFcmResponse(status, body)).toBe(outcome);
  });
});
