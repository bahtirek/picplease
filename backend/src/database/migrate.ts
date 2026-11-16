import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientBase } from 'pg';

/** The .sql files sit next to this file (the build copies them into dist/). */
export const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Any fixed number; it only has to be the same for every process running migrations.
const MIGRATION_LOCK_KEY = 4_771_001;
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

/**
 * Applies the migration files that have not run yet, in name order, each in its own
 * transaction. An advisory lock keeps two processes from migrating at the same time.
 * Returns the names it applied.
 */
export async function runMigrations(client: ClientBase, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort();

  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    const applied: string[] = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`, { cause: err });
      }
      applied.push(name);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
