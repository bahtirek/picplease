import { Global, Logger, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../common/config/config';
import { DatabaseService, PG_POOL } from './database.service';
import { SessionsRepository } from './sessions.repository';

export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  // An idle client losing its connection must not crash the process. The message
  // never contains the connection string.
  const logger = new Logger('Database');
  pool.on('error', (err) => {
    logger.error(`Idle database client error: ${err.message}`);
  });
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      // pg connects lazily, so the app starts without a reachable database.
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
    },
    DatabaseService,
    SessionsRepository,
  ],
  exports: [DatabaseService, SessionsRepository],
})
export class DatabaseModule {}
