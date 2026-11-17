import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EventBusModule } from '../eventbus';
import { SessionsModule } from '../sessions/sessions.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DeliveryService } from '../delivery/delivery.service';
import { CatchupService, type PendingPhotosSource, PENDING_PHOTOS_SOURCE } from './catchup.service';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeListener } from './realtime.listener';
import { WsAuthGuard } from './ws-auth.guard';

/** Depends on Auth, Sessions and Delivery. Notifications imports it for presence. */
@Module({
  imports: [AuthModule, SessionsModule, EventBusModule, DeliveryModule],
  providers: [
    RealtimeGateway,
    RealtimeListener,
    WsAuthGuard,
    PresenceService,
    CatchupService,
    {
      provide: PENDING_PHOTOS_SOURCE,
      inject: [DeliveryService],
      useFactory: (delivery: DeliveryService): PendingPhotosSource => ({
        listPending: async (sessionId) => (await delivery.listPending(sessionId)).photos,
      }),
    },
  ],
  exports: [PresenceService, RealtimeGateway],
})
export class RealtimeModule {}
