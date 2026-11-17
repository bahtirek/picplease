import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { signJwt } from './jwt';
import type { PushMessage, PushOutcome, PushProvider, PushTarget } from './push.provider';

export interface ApnsSettings {
  keyId: string;
  teamId: string;
  /** The app's bundle id, sent as apns-topic. */
  bundleId: string;
  /** Path to the .p8 signing key (token-based auth). */
  keyFile: string;
  environment: 'production' | 'sandbox';
}

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
} as const;

/** Apple accepts a provider token for an hour and refuses refreshes more often than 20 minutes. */
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 10 * 60 * 1000;
/** A photo push is useless after an hour; APNs drops it instead of delivering it late. */
const EXPIRY_SECONDS = 3600;

const GONE_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);

/** Maps an APNs response to an outcome. 410 and the token reasons mean the token is gone. */
export function classifyApnsResponse(status: number, body: string): PushOutcome {
  if (status === 200) return 'sent';
  if (status === 410) return 'invalid-token';
  let reason = '';
  try {
    const parsed = (JSON.parse(body) as { reason?: unknown }).reason;
    if (typeof parsed === 'string') reason = parsed;
  } catch {
    // not JSON
  }
  return GONE_REASONS.has(reason) ? 'invalid-token' : 'failed';
}

/** APNs over HTTP/2 with a token-based (ES256) provider key. One connection, reopened on demand. */
export class ApnsProvider implements PushProvider {
  private readonly logger = new Logger('Push');
  private readonly key: KeyObject;
  private client: ClientHttp2Session | undefined;
  private token: { value: string; madeAt: number } | undefined;

  constructor(
    private readonly settings: ApnsSettings,
    key?: KeyObject,
  ) {
    this.key = key ?? createPrivateKey(readFileSync(settings.keyFile));
  }

  providerToken(now = Date.now()): string {
    if (!this.token || now - this.token.madeAt > TOKEN_LIFETIME_MS) {
      const value = signJwt(
        'ES256',
        { kid: this.settings.keyId },
        { iss: this.settings.teamId, iat: Math.floor(now / 1000) },
        this.key,
      );
      this.token = { value, madeAt: now };
    }
    return this.token.value;
  }

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const payload = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
        'thread-id': message.collapseKey,
      },
      ...message.data,
    });
    return new Promise((resolve) => {
      let done = false;
      const finish = (outcome: PushOutcome) => {
        if (done) return;
        done = true;
        resolve(outcome);
      };
      let req;
      try {
        req = this.session().request({
          ':method': 'POST',
          ':path': `/3/device/${encodeURIComponent(target.token)}`,
          authorization: `bearer ${this.providerToken()}`,
          'apns-topic': this.settings.bundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-collapse-id': message.collapseKey,
          'apns-expiration': String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
          'content-type': 'application/json',
        });
      } catch (err) {
        this.logger.error(`APNs request failed: ${(err as Error).message}`);
        finish('failed');
        return;
      }
      let status = 0;
      const chunks: Buffer[] = [];
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        this.logger.error('APNs request timed out');
        req.close(constants.NGHTTP2_CANCEL);
        finish('failed');
      });
      req.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const outcome = classifyApnsResponse(status, body);
        if (outcome === 'failed') {
          // Status and Apple's reason only; the token is in the path, never in the body.
          this.logger.error(`APNs refused a push: ${String(status)} ${body.slice(0, 200)}`);
          if (status === 403) this.token = undefined;
        }
        finish(outcome);
      });
      req.on('error', (err: Error) => {
        this.logger.error(`APNs stream error: ${err.message}`);
        finish('failed');
      });
      req.end(payload);
    });
  }

  close(): void {
    this.client?.close();
    this.client = undefined;
  }

  private session(): ClientHttp2Session {
    if (this.client && !this.client.closed && !this.client.destroyed) return this.client;
    const client = connect(HOSTS[this.settings.environment]);
    client.on('error', (err: Error) => {
      this.logger.error(`APNs connection error: ${err.message}`);
    });
    const forget = () => {
      if (this.client === client) this.client = undefined;
    };
    client.on('close', forget);
    client.on('goaway', forget);
    client.setTimeout(IDLE_CLOSE_MS, () => {
      client.close();
    });
    client.unref();
    this.client = client;
    return client;
  }
}
