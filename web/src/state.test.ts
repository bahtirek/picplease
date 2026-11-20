import { describe, expect, it, vi } from 'vitest';
import { createStore, INITIAL_STATE } from './state';

describe('state', () => {
  it('starts on opening and notifies subscribers of each change', () => {
    const store = createStore();
    expect(store.get()).toEqual(INITIAL_STATE);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ screen: 'codeProblem', codeProblem: 'used' });
    expect(listener).toHaveBeenCalledWith({
      screen: 'codeProblem',
      session: null,
      codeProblem: 'used',
    });
    unsubscribe();
    store.set({ screen: 'opening' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hands out frozen snapshots', () => {
    const store = createStore();
    const before = store.get();
    store.set({ screen: 'ended' });
    expect(Object.isFrozen(store.get())).toBe(true);
    expect(before.screen).toBe('opening');
  });
});
