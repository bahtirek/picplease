import { AppError } from '../common/errors';
import { assertTransition, canTransition, isTerminal, sourcesOf } from './session-state';

describe('session state rulebook', () => {
  it('matches the transitions table', () => {
    expect(sourcesOf('claimed')).toEqual(['pending']);
    expect(sourcesOf('finished')).toEqual(['claimed']);
    expect(sourcesOf('closed')).toEqual(['finished']);
    expect(sourcesOf('revoked')).toEqual(['pending', 'claimed', 'finished']);
    expect(sourcesOf('expired')).toEqual(['pending']);
    expect(canTransition('finished', 'claimed')).toBe(false);
  });

  it('marks revoked, expired and closed terminal', () => {
    expect(['revoked', 'expired', 'closed'].every((s) => isTerminal(s as 'closed'))).toBe(true);
    expect(['pending', 'claimed', 'finished'].some((s) => isTerminal(s as 'pending'))).toBe(false);
  });

  it('assertTransition throws the client error for the current state', () => {
    const codeOf = (fn: () => void): string | undefined => {
      try {
        fn();
      } catch (err) {
        return (err as AppError).code;
      }
      return undefined;
    };
    expect(
      codeOf(() => {
        assertTransition('claimed', 'finished');
      }),
    ).toBeUndefined();
    expect(
      codeOf(() => {
        assertTransition('revoked', 'finished');
      }),
    ).toBe('SESSION_GONE');
    expect(
      codeOf(() => {
        assertTransition('finished', 'finished');
      }),
    ).toBe('SESSION_FINISHED');
    expect(
      codeOf(() => {
        assertTransition('claimed', 'claimed');
      }),
    ).toBe('ALREADY_CLAIMED');
  });
});
