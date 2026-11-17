import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { signJwt } from './jwt';
import type { PushMessage, PushOutcome, PushProvider, PushTarget } from './push.provider';

export interface FcmSettings {
  /** Path to the Firebase service account JSON (project_id, client_email, private_key). */
  serviceAccountFile: string;
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: KeyObject;
  tokenUri: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const REQUEST_TIMEOUT_MS = 10_000;

/** Reads the service account file. Errors name the missing field, never a value. */
export function readServiceAccount(file: string): ServiceAccount {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const field = (name: string): string => {
    const value = raw[name];
    if (typeof value !== 'string' || !value)
      throw new Error(`FCM service account file has no ${name}`);
    return value;
  };
  return {
    projectId: field('project_id'),
    clientEmail: field('client_email'),
    privateKey: createPrivateKey(field('private_key')),
    tokenUri:
      typeof raw.token_uri === 'string' ? raw.token_uri : 'https://oauth2.googleapis.com/token',
  };
}

interface FcmErrorBody {
  error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
}

/**
 * Maps an FCM v1 response to an outcome. UNREGISTERED (404), SENDER_ID_MISMATCH and an
 * INVALID_ARGUMENT about the registration token mean the token is gone.
 */
export function classifyFcmResponse(status: number, body: string): PushOutcome {
  if (status === 200) return 'sent';
  let parsed: FcmErrorBody = {};
  try {
    parsed = JSON.parse(body) as FcmErrorBody;
  } catch {
    // not JSON
  }
  const codes = [parsed.error?.status, ...(parsed.error?.details ?? []).map((d) => d.errorCode)];
  if (status === 404 || codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH'))
    return 'invalid-token';
  if (codes.includes('INVALID_ARGUMENT') && /registration token/i.test(parsed.error?.message ?? ''))
    return 'invalid-token';
  return 'failed';
}

/** FCM HTTP v1 with a service-account OAuth token (RS256 JWT bearer grant) through fetch. */
export class FcmProvider implements PushProvider {
  private readonly logger = new Logger('Push');
  private readonly account: ServiceAccount;
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(settings: FcmSettings, account?: ServiceAccount) {
    this.account = account ?? readServiceAccount(settings.serviceAccountFile);
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const token = await this.token();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: target.token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              collapse_key: message.collapseKey,
              priority: 'HIGH',
              ttl: '3600s',
              notification: { tag: message.collapseKey },
            },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const body = await res.text();
    const outcome = classifyFcmResponse(res.status, body);
    if (outcome === 'failed') {
      // FCM error bodies do not echo the registration token.
      this.logger.error(`FCM refused a push: ${String(res.status)} ${body.slice(0, 200)}`);
      if (res.status === 401) this.accessToken = undefined;
    }
    return outcome;
  }

  private async token(now = Date.now()): Promise<string> {
    if (this.accessToken && now < this.accessToken.expiresAt) return this.accessToken.value;
    const iat = Math.floor(now / 1000);
    const assertion = signJwt(
      'RS256',
      {},
      {
        iss: this.account.clientEmail,
        scope: SCOPE,
        aud: this.account.tokenUri,
        iat,
        exp: iat + 3600,
      },
      this.account.privateKey,
    );
    const res = await fetch(this.account.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`FCM OAuth token request failed: ${String(res.status)}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('FCM OAuth token response had no access_token');
    // Refresh a minute early.
    this.accessToken = {
      value: json.access_token,
      expiresAt: now + ((json.expires_in ?? 3600) - 60) * 1000,
    };
    return json.access_token;
  }
}
