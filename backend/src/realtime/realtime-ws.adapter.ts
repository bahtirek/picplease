import type { IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';

/**
 * Browsers send an Origin header and must come from WEB_ORIGIN. Native apps send none and
 * are let through; their token is checked by the first message.
 */
export function isAllowedWsOrigin(origin: string | undefined, webOrigin: string): boolean {
  return origin === undefined || origin === '' || origin === webOrigin;
}

/**
 * WsAdapter with the WEB_ORIGIN check on upgrade (refused with 403) and Nest's message
 * routing turned off: the gateway reads the auth message itself.
 */
export class RealtimeWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly webOrigin: string,
  ) {
    super(app, { messageParser: () => undefined });
  }

  override create(port: number, options?: Record<string, unknown>): unknown {
    const webOrigin = this.webOrigin;
    return super.create(port, {
      ...options,
      // The callback form lets the refusal be 403 (ws answers 401 otherwise).
      verifyClient: (
        info: { origin?: string; req: IncomingMessage },
        done: (ok: boolean, status?: number) => void,
      ) => {
        if (isAllowedWsOrigin(info.origin, webOrigin)) done(true);
        else done(false, 403);
      },
    });
  }
}
