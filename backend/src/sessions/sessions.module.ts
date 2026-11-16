import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { EventBusModule } from '../eventbus';
import { QrService } from './qr.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

/** Depends on Auth, Data (global) and EventBus. Uploads, Delivery and Jobs import it. */
@Module({
  imports: [AuthModule, EventBusModule],
  controllers: [SessionsController],
  providers: [SessionsService, QrService],
  exports: [SessionsService],
})
export class SessionsModule {}
