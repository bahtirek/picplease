import { Client } from 'pg';
import { runMigrations } from '../src/database/migrate';

// Applies pending migrations to DATABASE_URL. Run with `npm run migrate`.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await runMigrations(client);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply');
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Migration failed');
  process.exit(1);
});
