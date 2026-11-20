/**
 * Reads the pairing link `https://picplease.app/s/<sessionId>#<secret>`.
 * The secret is in the fragment so it never reaches a server; it is removed from the address bar
 * as soon as it has been read.
 */
export interface ParsedLink {
  sessionId: string;
  /** Null when the fragment has no secret (for example after a reload, once it was cleared). */
  secret: string | null;
}

const SESSION_PATH = /^\/s\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const SECRET = /^[A-Za-z0-9_-]{1,200}$/;

/** Returns null when the path is not a session link. */
export function parseLink(href: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const match = SESSION_PATH.exec(url.pathname);
  const id = match?.[1];
  if (!id) return null;

  let secret: string | null = null;
  if (url.hash.length > 1) {
    let raw: string;
    try {
      raw = decodeURIComponent(url.hash.slice(1));
    } catch {
      raw = '';
    }
    secret = SECRET.test(raw) ? raw : null;
  }
  return { sessionId: id.toLowerCase(), secret };
}

export interface LocationLike {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface HistoryLike {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** Parses the current address, then clears the fragment so the secret is no longer visible. */
export function readLink(location: LocationLike, history: HistoryLike): ParsedLink | null {
  const parsed = parseLink(location.href);
  if (location.hash !== '') {
    history.replaceState(history.state, '', location.pathname + location.search);
  }
  return parsed;
}
