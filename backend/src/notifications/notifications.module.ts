import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { APP_CONFIG, type AppConfig } from '../common/config/config';
import { EventBusModule } from '../eventbus';
import { RealtimeModule } from '../realtime/realtime.module';
import { ApnsProvider } from './apns.provider';
import { DevicesController } from './devices.controller';
import { FcmProvider } from './fcm.provider';
import { NotificationsService } from './notifications.service';
import { PhotoListener } from './photo.listener';
import { PlatformPushProvider, PUSH_PROVIDER } from './push.provider';

/** Depends on Realtime (presence), Data (global), Auth and EventBus. Tests override PUSH_PROVIDER. */
@Module({
  imports: [AuthModule, EventBusModule, RealtimeModule],
  controllers: [DevicesController],
  providers: [
    NotificationsService,
    PhotoListener,
    {
      provide: PUSH_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: ({ push }: AppConfig) =>
        new PlatformPushProvider({
          ios: push.apns ? new ApnsProvider(push.apns) : null,
          android: push.fcm ? new FcmProvider(push.fcm) : null,
        }),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
