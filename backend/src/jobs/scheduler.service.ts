import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Client } from 'pg';
import { type JobWithMetadata, PgBoss } from 'pg-boss';
import { APP_CONFIG, type AppConfig } from '../common/config/config';
import { SessionsRepository } from '../database/sessions.repository';
import { EVENT_BUS, type EventBus, type EventPayload, type Unsubscribe } from '../eventbus';
import { MAX_GRACE_SECONDS } from '../sessions/sessions.constants';
import { ExpirePairingJob } from './expire-pairing.job';
import { HardDeleteJob } from './hard-delete.job';
import { InactivityJob } from './inactivity.job';
import { CRONS, JOBS_SETTINGS, type JobsSettings, QUEUES, type QueueName } from './jobs.constants';
import { StaleUploadsJob } from './stale-uploads.job';

interface TimerData {
  sessionId: string;
}

type TimerQueue = typeof QUEUES.expirePairing | typeof QUEUES.graceFinish;

/**
 * Owns pg-boss. Turns session events into per-session timers and runs the sweeps on cron.
 * Timers only tidy state; every job's action is a conditional move that does nothing if
 * the session has moved on, so a lost or late timer is harmless.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly boss: PgBoss;
  private readonly pollingIntervalSeconds: number;
  private readonly databaseUrl: string;
  private readonly schema: string;
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(JOBS_SETTINGS) settings: JobsSettings,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly sessionsRepo: SessionsRepository,
    private readonly expirePairing: ExpirePairingJob,
    private readonly inactivity: InactivityJob,
    private readonly staleUploads: StaleUploadsJob,
    private readonly hardDelete: HardDeleteJob,
  ) {
    this.pollingIntervalSeconds = settings.pollingIntervalSeconds;
    this.databaseUrl = config.databaseUrl;
    this.schema = settings.schema;
    this.boss = new PgBoss({
      connectionString: config.databaseUrl,
      schema: settings.schema,
      // ensureSchema() creates it only when missing. pg-boss's own CREATE SCHEMA IF NOT EXISTS
      // needs CREATE on the database even when the schema exists, which the production user lacks.
      createSchema: false,
      max: 3,
      application_name: 'picplease-jobs',
    });
    this.boss.on('error', (err: unknown) => {
      this.logger.error(`pg-boss: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureSchema();
    await this.boss.start();
    for (const name of Object.values(QUEUES)) await this.boss.createQueue(name);

    await this.workTimers(QUEUES.expirePairing, (id) => this.expirePairing.run(id));
    await this.workTimers(QUEUES.graceFinish, (id) => this.inactivity.finishAfterGrace(id));
    await this.workSweep(QUEUES.idleFinish, () => this.inactivity.finishIdle());
    await this.workSweep(QUEUES.staleUploads, () => this.staleUploads.run());
    await this.workSweep(QUEUES.hardDelete, () => this.hardDelete.run());
    for (const [name, cron] of Object.entries(CRONS)) await this.boss.schedule(name, cron);

    this.unsubscribers = [
      this.bus.subscribe('session.created', (p) => this.onCreated(p)),
      this.bus.subscribe('session.claimed', (p) => this.onClaimed(p)),
      this.bus.subscribe('session.finish-requested', (p) => this.onFinishRequested(p)),
      this.bus.subscribe('session.resumed', (p) => this.onResumed(p)),
    ];
  }

  /**
   * Creates the pg-boss schema if it is missing. In production an admin creates it beforehand
   * (owned by the app user), so this only checks; tests and dev create it here.
   */
  private async ensureSchema(): Promise<void> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ present: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS present',
        [this.schema],
      );
      if (!rows[0]?.present)
        await client.query(`CREATE SCHEMA ${client.escapeIdentifier(this.schema)}`);
    } finally {
      await client.end();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** On session.created: expire the pairing at the session's expires_at. */
  async onCreated(payload: EventPayload): Promise<void> {
    const sessionId = idOf(payload);
    if (!sessionId) return;
    const session = await this.sessionsRepo.findById(sessionId);
    if (session?.state !== 'pending') return;
    await this.startTimer(QUEUES.expirePairing, sessionId, session.expiresAt);
  }

  async onClaimed(payload: EventPayload): Promise<void> {
    const sessionId = idOf(payload);
    if (sessionId) await this.cancelTimers(QUEUES.expirePairing, sessionId);
  }

  /** On session.finish-requested: finish after the grace, capped at 30 seconds. */
  async onFinishRequested(payload: EventPayload): Promise<void> {
    const sessionId = idOf(payload);
    if (!sessionId) return;
    const requested = typeof payload.graceSeconds === 'number' ? payload.graceSeconds : 0;
    const seconds = Math.min(Math.max(requested, 0), MAX_GRACE_SECONDS);
    await this.cancelTimers(QUEUES.graceFinish, sessionId);
    await this.startTimer(QUEUES.graceFinish, sessionId, new Date(Date.now() + seconds * 1000));
  }

  async onResumed(payload: EventPayload): Promise<void> {
    const sessionId = idOf(payload);
    if (sessionId) await this.cancelTimers(QUEUES.graceFinish, sessionId);
  }

  /** Timer jobs still waiting to run for a session (for tests and diagnostics). */
  async queuedTimers(queue: TimerQueue, sessionId: string): Promise<JobWithMetadata<TimerData>[]> {
    return this.boss.findJobs<TimerData>(queue, { key: sessionId, queued: true });
  }

  private async startTimer(queue: TimerQueue, sessionId: string, at: Date): Promise<void> {
    const data: TimerData = { sessionId };
    await this.boss.sendAfter(queue, data, { singletonKey: sessionId }, at);
  }

  private async cancelTimers(queue: TimerQueue, sessionId: string): Promise<void> {
    const jobs = await this.queuedTimers(queue, sessionId);
    if (jobs.length > 0)
      await this.boss.cancel(
        queue,
        jobs.map((j) => j.id),
      );
  }

  private async workTimers(
    queue: TimerQueue,
    fire: (sessionId: string) => Promise<unknown>,
  ): Promise<void> {
    const options = { pollingIntervalSeconds: this.pollingIntervalSeconds };
    await this.boss.work<TimerData>(queue, options, async (jobs) => {
      for (const job of jobs) await fire(job.data.sessionId);
    });
  }

  private async workSweep(queue: QueueName, run: () => Promise<unknown>): Promise<void> {
    const options = { pollingIntervalSeconds: this.pollingIntervalSeconds };
    await this.boss.work(queue, options, async () => {
      await run();
    });
  }
}

function idOf(payload: EventPayload): string | null {
  return typeof payload.sessionId === 'string' ? payload.sessionId : null;
}
