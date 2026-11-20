/** Start-up: parse the link, claim (or reuse this tab's token after a reload), pick the first screen. */
import { ApiError, type ApiClient } from './api';
import { readLink, type HistoryLike, type LocationLike } from './linkParser';
import type { CodeProblemReason, Store } from './state';
import type { TokenStore } from './tokenStore';

export interface StartupDeps {
  location: LocationLike;
  history: HistoryLike;
  api: Pick<ApiClient, 'claim'>;
  tokens: TokenStore;
  store: Store;
}

export async function start(deps: StartupDeps): Promise<void> {
  const { store, tokens } = deps;
  store.set({ screen: 'opening', session: null, codeProblem: null });

  const link = readLink(deps.location, deps.history);
  if (!link) {
    fail(store, 'invalid');
    return;
  }

  // After a reload the fragment is gone; the tab's own stored token carries on.
  const stored = tokens.load(link.sessionId);
  if (stored) {
    store.set({ screen: 'cameraAccess', session: stored });
    return;
  }
  if (link.secret === null) {
    fail(store, 'invalid');
    return;
  }

  try {
    const claimed = await deps.api.claim(link.sessionId, link.secret);
    const session = {
      sessionId: link.sessionId,
      token: claimed.helperToken,
      limits: claimed.limits,
    };
    tokens.save(session);
    store.set({ screen: 'cameraAccess', session });
  } catch (error) {
    fail(store, claimProblem(error));
  }
}

/** The claim is not retried: the secret may already be spent if only the answer was lost. */
export function claimProblem(error: unknown): CodeProblemReason {
  if (!(error instanceof ApiError)) return 'unreachable';
  switch (error.code) {
    case 'ALREADY_CLAIMED':
      return 'used';
    case 'NOT_FOUND':
    case 'UNAUTHORIZED':
    case 'SESSION_GONE':
    case 'SESSION_FINISHED':
    case 'INVALID_REQUEST':
      return 'invalid';
    default:
      return 'unreachable';
  }
}

function fail(store: Store, reason: CodeProblemReason): void {
  store.set({ screen: 'codeProblem', session: null, codeProblem: reason });
}
