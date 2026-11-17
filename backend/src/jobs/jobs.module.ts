import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { EventBusModule } from '../eventbus';
import { SessionsModule } from '../sessions/sessions.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ExpirePairingJob } from './expire-pairing.job';
import { HardDeleteJob } from './hard-delete.job';
import { InactivityJob } from './inactivity.job';
import { DEFAULT_JOBS_SETTINGS, JOBS_SETTINGS } from './jobs.constants';
import { SchedulerService } from './scheduler.service';
import { StaleUploadsJob } from './stale-uploads.job';

/**
 * pg-boss timers and sweeps. Depends on Sessions, Uploads, Delivery, Data (global) and
 * EventBus; nothing depends on Jobs. Left out of the app when NODE_ENV=test.
 */
@Module({
  imports: [SessionsModule, UploadsModule, DeliveryModule, EventBusModule],
  providers: [
    { provide: JOBS_SETTINGS, useValue: DEFAULT_JOBS_SETTINGS },
    SchedulerService,
    ExpirePairingJob,
    InactivityJob,
    StaleUploadsJob,
    HardDeleteJob,
  ],
})
export class JobsModule {}
