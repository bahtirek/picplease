import { AppError, type ErrorCode } from '../common/errors';
import type { SessionState } from '../database/sessions.repository';

/** docs/backend/state-and-data.md: the only legal moves, keyed by the current state. */
export const TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  pending: ['claimed', 'revoked', 'expired'],
  claimed: ['finished', 'revoked'],
  finished: ['closed', 'revoked'],
  revoked: [],
  expired: [],
  closed: [],
};

const ALL_STATES = Object.keys(TRANSITIONS) as SessionState[];

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: SessionState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** The states a move to `to` is allowed from; used as the WHERE of conditional updates. */
export function sourcesOf(to: SessionState): SessionState[] {
  return ALL_STATES.filter((from) => canTransition(from, to));
}

/** The error a client sees when its call does not fit the session's current state. */
export function stateErrorCode(current: SessionState): ErrorCode {
  if (isTerminal(current)) return 'SESSION_GONE';
  if (current === 'finished') return 'SESSION_FINISHED';
  if (current === 'claimed') return 'ALREADY_CLAIMED';
  return 'INVALID_REQUEST';
}

/** Throws the matching AppError when `from -> to` is not a legal move. */
export function assertTransition(from: SessionState, to: SessionState): void {
  if (!canTransition(from, to)) throw new AppError(stateErrorCode(from));
}
