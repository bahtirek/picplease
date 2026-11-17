# Backend module: Jobs (pg-boss)

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `scheduler.service.ts`, `expire-pairing.job.ts`, `inactivity.job.ts`, `stale-uploads.job.ts`, `hard-delete.job.ts`, `jobs.constants.ts`, `jobs.module.ts`.

| Job | Rule |
|---|---|
| Expire pairing | On `session.created`, schedule a 5 minute timer. On `session.claimed`, cancel. On fire, `Sessions.expirePending` (does nothing if claimed). |
| Grace finish | On `session.finish-requested`, start a timer (30 seconds max). On `session.resumed`, cancel. On fire, `Sessions.markFinished`. |
| Idle finish | Every minute, finish claimed sessions whose `last_activity_at` is 2 minutes old or more. The finish lands 2 to 3 minutes after the last activity. |
| Stale uploads | Every minute, `Uploads.reconcileStale` for pending photos whose URL has expired. |
| Hard delete | Delete R2 objects for photos downloaded or older than 48 hours, then delete session rows older than 48 hours (cascades). |

Owner decisions (slice 8a):
- Hard delete runs every 15 minutes. A session older than 48 hours keeps its row until every one of its photos has `object_deleted_at` set, so a refused R2 delete is retried on the next run instead of losing the key.
- Stale uploads picks pending photos whose URL expired at least 60 seconds ago, so an upload started just before expiry can finish.
- pg-boss lives in its own schema `pgboss` and is left out of the app when NODE_ENV=test; Jobs tests build the services themselves with a throwaway pg-boss schema.

Correctness never depends on a timer: `claimSession` checks the expiry timestamp itself.
