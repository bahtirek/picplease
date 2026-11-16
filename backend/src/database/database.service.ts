import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Client, type ClientBase, type Pool, type PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../common/config/config';

export const PG_POOL = Symbol('PG_POOL');

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<ClientBase, 'query'>;

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Runs fn on one client inside BEGIN/COMMIT; rolls back if fn throws. */
  async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection is unusable; drop it instead of returning it to the pool.
        broken = true;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }

  /**
   * A dedicated connection outside the pool, for LISTEN. The caller owns it and must
   * call end() on it.
   */
  async listenConnection(): Promise<Client> {
    const client = new Client({ connectionString: this.config.databaseUrl });
    await client.connect();
    return client;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
