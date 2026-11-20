/** Single state object and a tiny subscribe function. Screen names from docs/web/flow-and-states.md. */
import type { Limits } from './api';
import type { CameraProblem } from './camera';

export type Screen =
  | 'opening'
  | 'cameraAccess'
  | 'shooting'
  | 'sending'
  | 'thanks'
  | 'codeProblem'
  | 'noCamera'
  | 'ended';

/**
 * Why the code could not be used, so the screen can pick its wording:
 * used = someone claimed it first; invalid = wrong, unknown or gone (these look identical on
 * purpose); unreachable = no answer or a server error.
 */
export type CodeProblemReason = 'used' | 'invalid' | 'unreachable';

export interface HelperSession {
  sessionId: string;
  token: string;
  limits: Limits;
}

export interface AppState {
  screen: Screen;
  session: HelperSession | null;
  codeProblem: CodeProblemReason | null;
  /** Why noCamera shows: denied (allow it in settings) or unavailable (no usable camera). */
  cameraProblem: CameraProblem | null;
}

export type Listener = (state: Readonly<AppState>) => void;

export interface Store {
  get(): Readonly<AppState>;
  set(patch: Partial<AppState>): void;
  subscribe(listener: Listener): () => void;
}

export const INITIAL_STATE: AppState = {
  screen: 'opening',
  session: null,
  codeProblem: null,
  cameraProblem: null,
};

export function createStore(initial: AppState = INITIAL_STATE): Store {
  let state: Readonly<AppState> = Object.freeze({ ...initial });
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      state = Object.freeze({ ...state, ...patch });
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
