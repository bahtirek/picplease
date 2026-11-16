import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EventBusModule } from '../eventbus';
import { SessionsModule } from '../sessions/sessions.module';
import { MODERATION_HOOK, NoopModeration } from './moderation.hook';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/** Depends on Sessions, Auth, Data (global) and EventBus. Jobs imports it for reconcileStale. */
@Module({
  imports: [AuthModule, SessionsModule, EventBusModule],
  controllers: [UploadsController],
  providers: [UploadsService, { provide: MODERATION_HOOK, useClass: NoopModeration }],
  exports: [UploadsService],
})
export class UploadsModule {}
