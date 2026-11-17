import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DevicePlatform } from '../database/devices.repository';

/** What a push carries. Generic text only, never photo content, IDs of photos or URLs. */
export interface PushMessage {
  title: string;
  body: string;
  /** Same key for every push of a session, so the phone shows only the latest one. */
  collapseKey: string;
  /** Small string map for the app (e.g. which session to open). */
  data: Record<string, string>;
}

export interface PushTarget {
  platform: DevicePlatform;
  token: string;
}

/**
 * sent: the provider accepted it. invalid-token: the provider says the token is gone, so
 * remove it. failed: anything else (network, auth, provider error); keep the token.
 * disabled: no credentials for this platform.
 */
export type PushOutcome = 'sent' | 'invalid-token' | 'failed' | 'disabled';

export interface PushProvider {
  /** Never throws and never logs the token. */
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
  close?(): Promise<void> | void;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/** Routes each push to the adapter for its platform (APNs for ios, FCM for android). */
export class PlatformPushProvider implements PushProvider, OnApplicationShutdown {
  private readonly logger = new Logger('Push');

  constructor(private readonly adapters: Record<DevicePlatform, PushProvider | null>) {
    for (const [platform, adapter] of Object.entries(adapters))
      if (!adapter) this.logger.warn(`No push credentials for ${platform}; its pushes are off`);
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const adapter = this.adapters[target.platform];
    if (!adapter) return 'disabled';
    try {
      return await adapter.send(target, message);
    } catch (err) {
      this.logger.error(`${target.platform} push failed: ${(err as Error).message}`);
      return 'failed';
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const adapter of Object.values(this.adapters)) await adapter?.close?.();
  }
}
