import type { WebConfig } from '../config';
import type { HelperFlow } from '../flow';
import type { AppState } from '../state';

export interface ScreenContext {
  config: Pick<WebConfig, 'appStoreUrl' | 'playStoreUrl'>;
  flow: Pick<HelperFlow, 'allowCamera' | 'shoot' | 'finishTapped'>;
  /** The one viewfinder element, kept across renders so the stream stays attached. */
  video: HTMLVideoElement;
}

export interface Mounted {
  root: HTMLElement;
  /** Called on every state change while this screen is shown. */
  update?(state: Readonly<AppState>): void;
  /** Called when another screen replaces this one. */
  destroy?(): void;
}

export type ScreenFactory = (state: Readonly<AppState>, context: ScreenContext) => Mounted;
