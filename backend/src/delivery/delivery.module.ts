import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EventBusModule } from '../eventbus';
import { SessionsModule } from '../sessions/sessions.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryListener } from './delivery.listener';
import { DeliveryService } from './delivery.service';
import { PhotoCleanup } from './photo-cleanup';

/**
 * Depends on Sessions, Auth, Data (global) and EventBus. Realtime imports it for catch-up;
 * Jobs imports it for the 48 hour sweep (PhotoCleanup.deleteMany).
 */
@Module({
  imports: [AuthModule, SessionsModule, EventBusModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryListener, PhotoCleanup],
  exports: [DeliveryService, PhotoCleanup],
})
export class DeliveryModule {}
