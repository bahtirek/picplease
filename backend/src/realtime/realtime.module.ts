import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EventBusModule } from '../eventbus';
import { SessionsModule } from '../sessions/sessions.module';
import { CatchupService, noPendingPhotos, PENDING_PHOTOS_SOURCE } from './catchup.service';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeListener } from './realtime.listener';
import { WsAuthGuard } from './ws-auth.guard';

/**
 * Depends on Auth, Sessions and (from slice 8) Delivery. Notifications imports it for
 * presence.
 */
@Module({
  imports: [AuthModule, SessionsModule, EventBusModule],
  providers: [
    RealtimeGateway,
    RealtimeListener,
    WsAuthGuard,
    PresenceService,
    CatchupService,
    { provide: PENDING_PHOTOS_SOURCE, useValue: noPendingPhotos },
  ],
  exports: [PresenceService, RealtimeGateway],
})
export class RealtimeModule {}
