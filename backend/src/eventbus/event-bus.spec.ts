import { randomBytes } from 'node:crypto';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import type { EventBus, EventPayload } from './event-bus.interface';
import { InMemoryEventBus } from './in-memory-event-bus';
import { PostgresEventBus } from './postgres-event-bus';

/** Resolves with the next payload a handler receives, or rejects after ms. */
function nextEvent(bus: EventBus, ms = 3000): { promise: Promise<EventPayload>; stop: () => void } {
  let stop = () => {};
  const promise = new Promise<EventPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('no event within timeout'));
    }, ms);
    stop = bus.subscribe('session.created', (payload) => {
      clearTimeout(timer);
      stop();
      resolve(payload);
    });
  });
  return { promise, stop };
}

/** Lets in-flight notifications arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

function sharedTests(getBus: () => EventBus): void {
  it('delivers to one subscriber', async () => {
    const received = nextEvent(getBus());
    await getBus().publish('session.created', { sessionId: 'a' });
    expect(await received.promise).toEqual({ sessionId: 'a' });
  });

  it('delivers to several subscribers, and only for their event', async () => {
    const bus = getBus();
    const first = jest.fn();
    const second = jest.fn();
    const other = jest.fn();
    const stops = [
      bus.subscribe('session.created', first),
      bus.subscribe('session.created', second),
      bus.subscribe('session.claimed', other),
    ];
    const done = nextEvent(bus);
    await bus.publish('session.created', { sessionId: 'b' });
    await done.promise;
    await settle();
    expect(first).toHaveBeenCalledWith({ sessionId: 'b' });
    expect(second).toHaveBeenCalledWith({ sessionId: 'b' });
    expect(other).not.toHaveBeenCalled();
    stops.forEach((stop) => {
      stop();
    });
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = getBus();
    const handler = jest.fn();
    const stop = bus.subscribe('session.created', handler);
    stop();
    stop();
    const done = nextEvent(bus);
    await bus.publish('session.created', { sessionId: 'c' });
    await done.promise;
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers the payload unchanged, and a failing handler does not affect others', async () => {
    const bus = getBus();
    const payload = { sessionId: 'd', photoId: 'p1', count: 3, done: true, note: null };
    const stopFailing = bus.subscribe('session.created', () => {
      throw new Error('handler failure');
    });
    const received = nextEvent(bus);
    await bus.publish('session.created', payload);
    expect(await received.promise).toEqual(payload);
    stopFailing();
  });
}

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus;
  beforeEach(() => {
    bus = new InMemoryEventBus();
  });
  sharedTests(() => bus);
});

describe('PostgresEventBus (real Postgres)', () => {
  let db: TestDb;
  let bus: PostgresEventBus;

  beforeAll(async () => {
    db = await openTestDb();
  });
  beforeEach(async () => {
    // A channel per test keeps parallel test files and earlier tests from interfering.
    bus = new PostgresEventBus(db.database, {
      channel: `test_${randomBytes(6).toString('hex')}`,
      reconnectMinMs: 50,
      reconnectMaxMs: 200,
    });
    bus.start();
    await bus.whenListening();
  });
  afterEach(() => bus.stop());
  afterAll(() => db.close());

  sharedTests(() => bus);

  it('reconnects and listens again after the connection drops', async () => {
    const { rows } = await db.pool.query<{ n: number }>(
      `SELECT count(*) FILTER (WHERE pg_terminate_backend(pid))::int AS n
       FROM pg_stat_activity WHERE query = format('LISTEN "%s"', $1::text)`,
      [bus.channel],
    );
    expect(rows[0]?.n).toBe(1);

    // Wait until the old connection is noticed as gone and a new one listens.
    const deadline = Date.now() + 5000;
    let delivered: EventPayload | undefined;
    while (!delivered && Date.now() < deadline) {
      await bus.whenListening();
      const received = nextEvent(bus, 300);
      await bus.publish('session.created', { sessionId: 'after-drop' });
      delivered = await received.promise.catch(() => undefined);
    }
    expect(delivered).toEqual({ sessionId: 'after-drop' });
  });

  it('never delivers an event from a rolled-back transaction', async () => {
    const handler = jest.fn();
    const stop = bus.subscribe('session.created', handler);

    await expect(
      db.database.transaction(async (tx) => {
        await bus.publish('session.created', { sessionId: 'rolled-back' }, tx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    // Notifications arrive in order, so once the committed one is here the
    // rolled-back one would already have arrived.
    const committed = nextEvent(bus);
    await db.database.transaction((tx) =>
      bus.publish('session.created', { sessionId: 'committed' }, tx),
    );
    expect(await committed.promise).toEqual({ sessionId: 'committed' });
    await settle();
    expect(handler.mock.calls).toEqual([[{ sessionId: 'committed' }]]);
    stop();
  });

  it('refuses a payload over the notification size limit', async () => {
    await expect(bus.publish('session.created', { blob: 'x'.repeat(8000) })).rejects.toThrow(
      'too large',
    );
  });
});
