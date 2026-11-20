/** Mounts the screen for the current state; a new screen replaces the old one, else it updates. */
import type { Screen, Store } from '../state';
import { shooting } from './shooting';
import { cameraAccess } from './cameraAccess';
import { codeProblem } from './codeProblem';
import { ended } from './ended';
import { noCamera } from './noCamera';
import { opening } from './opening';
import { sending } from './sending';
import { thanks } from './thanks';
import type { Mounted, ScreenContext, ScreenFactory } from './types';

export const SCREENS: Record<Screen, ScreenFactory> = {
  opening,
  cameraAccess,
  shooting,
  sending,
  thanks,
  codeProblem,
  noCamera,
  ended,
};

export function mountScreens(
  container: HTMLElement,
  store: Store,
  context: ScreenContext,
): () => void {
  let current: { screen: Screen; mounted: Mounted } | null = null;

  const render = (): void => {
    const state = store.get();
    if (current?.screen === state.screen) {
      current.mounted.update?.(state);
      return;
    }
    current?.mounted.destroy?.();
    const mounted = SCREENS[state.screen](state, context);
    container.replaceChildren(mounted.root);
    current = { screen: state.screen, mounted };
  };

  render();
  return store.subscribe(render);
}
