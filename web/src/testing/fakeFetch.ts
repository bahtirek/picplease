import type { FetchLike } from '../api';

export interface Call {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = { status: number; body?: unknown } | Error;

/** A fetch that records each call and answers from the queue (the last reply repeats). */
export function fakeFetch(...replies: Reply[]): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      init,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body,
    });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (!reply) return Promise.reject(new Error('no reply queued'));
    if (reply instanceof Error) return Promise.reject(reply);
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return Promise.resolve(new Response(text, { status: reply.status }));
  };
  return Object.assign(fn, { calls });
}
