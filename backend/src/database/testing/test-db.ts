import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import type { AppConfig } from '../../common/config/config';
import { DatabaseService } from '../database.service';
import { runMigrations } from '../migrate';

/**
 * Reads DATABASE_URL_TEST (loaded from backend/.env when present). Refuses any database
 * whose name does not end in _test, because the tests delete rows.
 */
export function testDatabaseUrl(): string {
  const envFile = join(__dirname, '..', '..', '..', '.env');
  if (!process.env.DATABASE_URL_TEST && existsSync(envFile)) process.loadEnvFile(envFile);

  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set. Repository tests need a real Postgres.');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error('DATABASE_URL_TEST must point at a database whose name ends in _test.');
  }
  return url;
}

export interface TestDb {
  pool: Pool;
  database: DatabaseService;
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates a fresh schema for one test file, migrates it and hands back a pool bound to it.
 * Jest runs files in parallel workers, so each file gets its own tables. close() drops it.
 */
export async function openTestDb(): Promise<TestDb> {
  const url = testDatabaseUrl();
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
  }

  const config: AppConfig = {
    nodeEnv: 'test',
    port: 0,
    webOrigin: 'http://localhost',
    databaseUrl: url,
  };
  const database = new DatabaseService(pool, config);
  return {
    pool,
    database,
    truncateAll: async () => {
      await pool.query('TRUNCATE sessions CASCADE');
    },
    close: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}
