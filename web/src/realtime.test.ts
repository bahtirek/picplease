import { describe, expect, it, vi } from 'vitest';
import { CLOSE_GONE, CLOSE_UNAUTHORIZED, HelperRealtime, type SocketLike } from './realtime';

const URL_WS = 'wss://api.picplease.app/ws';
const TOKEN = 'session.token';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  closedWith: number | undefined;
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closedWith = code;
  }
  open(): void {
    this.onopen?.();
  }
  message(type: string, data: unknown = {}): void {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
  serverClose(code: number): void {
    this.onclose?.({ code });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const flow = { sessionFinished: vi.fn(() => Promise.resolve()), sessionEnded: vi.fn() };
  const sleep = vi.fn(() => Promise.resolve());
  const realtime = new HelperRealtime({
    url: URL_WS,
    token: TOKEN,
    flow,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    sleep,
    jitter: () => 1,
  });
  realtime.start();
  const last = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket');
    return socket;
  };
  return { realtime, sockets, flow, sleep, last };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('realtime', () => {
  it('authenticates with the first message, never in the URL', () => {
    const { last } = setup();
    last().open();
    expect(last().url).toBe(URL_WS);
    expect(last().sent.map((s) => JSON.parse(s) as unknown)).toEqual([
      { type: 'auth', token: TOKEN },
    ]);
  });

  it.each([CLOSE_UNAUTHORIZED, CLOSE_GONE])(
    'moves to ended on close %i and does not reconnect (test 13)',
    async (code) => {
      const { last, flow, sockets } = setup();
      last().open();
      last().serverClose(code);
      await flush();
      expect(flow.sessionEnded).toHaveBeenCalledOnce();
      expect(sockets).toHaveLength(1);
    },
  );

  it('session.finished and session.ended reach the flow', () => {
    const { last, flow } = setup();
    last().message('session.finished', { sessionId: 's' });
    expect(flow.sessionFinished).toHaveBeenCalledOnce();
    last().message('session.ended', { sessionId: 's' });
    expect(flow.sessionEnded).toHaveBeenCalledOnce();
  });

  it.each([
    ['claimed', null],
    ['finished', 'sessionFinished'],
    ['revoked', 'sessionEnded'],
    ['expired', 'sessionEnded'],
    ['closed', 'sessionEnded'],
  ] as const)('a snapshot in state %s leads to %s', (state, action) => {
    const { last, flow } = setup();
    last().message('snapshot', { role: 'helper', session: { state } });
    if (action) expect(flow[action]).toHaveBeenCalledOnce();
    else
      expect(flow.sessionFinished.mock.calls.length + flow.sessionEnded.mock.calls.length).toBe(0);
  });

  it('ignores unknown types and bad messages', () => {
    const { last, flow } = setup();
    last().message('photo.ready');
    last().onmessage?.({ data: 'not json' });
    last().onmessage?.({ data: 42 });
    last().onmessage?.({ data: 'null' });
    expect(flow.sessionFinished).not.toHaveBeenCalled();
    expect(flow.sessionEnded).not.toHaveBeenCalled();
  });

  it('reconnects after other closes with growing waits, reset by a snapshot', async () => {
    const { last, sleep, sockets } = setup();
    last().serverClose(1006);
    await flush();
    last().serverClose(1006);
    await flush();
    last().serverClose(1011);
    await flush();
    expect(sockets).toHaveLength(4);
    expect(sleep.mock.calls.map((c) => c as unknown[])).toEqual([[1000], [2000], [4000]]);

    last().message('snapshot', { session: { state: 'claimed' } });
    last().serverClose(1006);
    await flush();
    expect(sleep.mock.calls.at(-1)).toEqual([1000]);
  });

  it('stop closes the socket and does not reconnect', async () => {
    const { realtime, last, sockets, flow } = setup();
    const socket = last();
    realtime.stop();
    expect(socket.closedWith).toBe(1000);
    socket.serverClose(1000);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(flow.sessionEnded).not.toHaveBeenCalled();
  });
});
