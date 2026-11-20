import { describe, expect, it, vi } from 'vitest';
import { parseLink, readLink, type HistoryLike, type LocationLike } from './linkParser';

const ID = '3428da7f-d9f8-48a5-879b-971b2e1c3a54';
const SECRET = 'Abc_def-123'.padEnd(43, 'x');

function locationOf(href: string): LocationLike {
  const url = new URL(href);
  return { href, pathname: url.pathname, search: url.search, hash: url.hash };
}

function fakeHistory() {
  const replaceState = vi.fn<HistoryLike['replaceState']>();
  const history: HistoryLike = { state: { keep: true }, replaceState };
  return { history, replaceState };
}

describe('linkParser', () => {
  it('reads id and secret, then clears the fragment (test 1)', () => {
    const { history, replaceState } = fakeHistory();
    const link = readLink(locationOf(`https://picplease.app/s/${ID}#${SECRET}`), history);
    expect(link).toEqual({ sessionId: ID, secret: SECRET });
    expect(replaceState).toHaveBeenCalledWith({ keep: true }, '', `/s/${ID}`);
  });

  it('keeps the query when clearing the fragment', () => {
    const { history, replaceState } = fakeHistory();
    readLink(locationOf(`https://picplease.app/s/${ID}?x=1#${SECRET}`), history);
    expect(replaceState).toHaveBeenCalledWith({ keep: true }, '', `/s/${ID}?x=1`);
  });

  it('gives no secret for a link without one (test 2: leads to codeProblem)', () => {
    expect(parseLink(`https://picplease.app/s/${ID}`)).toEqual({ sessionId: ID, secret: null });
    expect(parseLink(`https://picplease.app/s/${ID}#`)).toEqual({ sessionId: ID, secret: null });
  });

  it('does not touch history when there is no fragment', () => {
    const { history, replaceState } = fakeHistory();
    readLink(locationOf(`https://picplease.app/s/${ID}`), history);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('still clears the fragment of a link it rejects', () => {
    const { history, replaceState } = fakeHistory();
    expect(readLink(locationOf(`https://picplease.app/x#${SECRET}`), history)).toBeNull();
    expect(replaceState).toHaveBeenCalled();
  });

  it('rejects other paths and malformed ids', () => {
    expect(parseLink('https://picplease.app/')).toBeNull();
    expect(parseLink(`https://picplease.app/s/not-a-uuid#${SECRET}`)).toBeNull();
    expect(parseLink(`https://picplease.app/s/${ID}/extra#${SECRET}`)).toBeNull();
  });

  it('lowercases the id and ignores a malformed secret', () => {
    expect(parseLink(`https://picplease.app/s/${ID.toUpperCase()}#${SECRET}`)?.sessionId).toBe(ID);
    expect(parseLink(`https://picplease.app/s/${ID}#a b`)?.secret).toBeNull();
    expect(parseLink(`https://picplease.app/s/${ID}#%E0%A4%A`)?.secret).toBeNull();
  });

  it('ignores the old ?t= form', () => {
    expect(parseLink(`https://picplease.app/s/${ID}?t=${SECRET}`)?.secret).toBeNull();
  });
});
