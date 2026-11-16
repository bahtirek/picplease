import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EVENT_BUS } from './event-bus.interface';
import { PostgresEventBus } from './postgres-event-bus';

/** Provides EVENT_BUS. Tests override it with InMemoryEventBus. */
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      inject: [DatabaseService],
      useFactory: (database: DatabaseService) => new PostgresEventBus(database),
    },
  ],
  exports: [EVENT_BUS],
})
export class EventBusModule {}
