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

Correctness never depends on a timer: `claimSession` checks the expiry timestamp itself.
