import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors';
import { type DevicePlatform, DevicesRepository } from '../database/devices.repository';
import {
  DEVICE_SESSION_STATES,
  PUSH_COOLDOWN_SECONDS,
  PUSH_SESSION_STATES,
} from './notifications.constants';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push.provider';

/** The only photo push text. Generic on purpose: no photo content, count or names. */
export function photoReadyMessage(sessionId: string): PushMessage {
  return {
    title: 'PicPlease',
    body: 'You have new photos to save.',
    collapseKey: `photos-${sessionId}`,
    data: { type: 'photo.ready', sessionId },
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly devices: DevicesRepository,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  /** Upsert. Refused with SESSION_GONE once the session is revoked, expired or closed. */
  async registerDevice(sessionId: string, platform: DevicePlatform, token: string): Promise<void> {
    const device = await this.devices.upsert(sessionId, platform, token, DEVICE_SESSION_STATES);
    if (!device) throw new AppError('SESSION_GONE');
  }

  /**
   * One push per burst: takes the session's 60 s push slot (one conditional UPDATE), then
   * sends the same collapsed message to each device. Returns how many pushes were accepted.
   */
  async notifyPhotoReady(sessionId: string): Promise<number> {
    const targets = await this.devices.claimPushSlot(
      sessionId,
      PUSH_COOLDOWN_SECONDS,
      PUSH_SESSION_STATES,
    );
    if (targets.length === 0) return 0;
    const message = photoReadyMessage(sessionId);
    const outcomes = await Promise.all(
      targets.map(async (device) => {
        const outcome = await this.push.send(
          { platform: device.platform, token: device.pushToken },
          message,
        );
        if (outcome === 'invalid-token')
          await this.removeInvalidToken(device.platform, device.pushToken);
        return outcome;
      }),
    );
    return outcomes.filter((o) => o === 'sent').length;
  }

  async removeInvalidToken(platform: DevicePlatform, token: string): Promise<void> {
    const removed = await this.devices.removeToken(platform, token);
    // Never log the token itself.
    if (removed > 0)
      this.logger.log(`Removed ${String(removed)} ${platform} device(s) with a dead push token`);
  }
}
