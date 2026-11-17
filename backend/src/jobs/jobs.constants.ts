/** Queue names. Timer queues hold one job per session (singletonKey = sessionId). */
export const QUEUES = {
  expirePairing: 'expire-pairing',
  graceFinish: 'grace-finish',
  idleFinish: 'idle-finish',
  staleUploads: 'stale-uploads',
  hardDelete: 'hard-delete',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Sweeps and their cron schedules (UTC). */
export const CRONS = {
  [QUEUES.idleFinish]: '* * * * *',
  [QUEUES.staleUploads]: '* * * * *',
  [QUEUES.hardDelete]: '*/15 * * * *',
} as const;

/** A claimed session with no activity this long is finished by the idle sweep. */
export const IDLE_FINISH_SECONDS = 2 * 60;

/** A pending photo counts as stale this long after its upload URL expired (owner decision). */
export const STALE_UPLOAD_MARGIN_SECONDS = 60;

/** Photos and session rows are deleted at this age (docs/backend/decisions.md). */
export const RETENTION_SECONDS = 48 * 60 * 60;

/** Batch sizes for one sweep run. */
export const SWEEP_BATCH = 100;
export const CLEANUP_BATCH = 1000;
/** A sweep stops after this many full batches; the next run continues. */
export const MAX_BATCHES = 10;

export interface JobsSettings {
  /** Postgres schema pg-boss installs into. */
  schema: string;
  /** How often workers poll for due jobs. */
  pollingIntervalSeconds: number;
}

export const JOBS_SETTINGS = Symbol('JOBS_SETTINGS');

export const DEFAULT_JOBS_SETTINGS: JobsSettings = { schema: 'pgboss', pollingIntervalSeconds: 2 };
