import type { PhotosRepository, WindowCounts } from '../database/photos.repository';

export type WindowState = WindowCounts;

/** Counts in flight, left and delivered for a session in one statement. */
export function loadWindowState(
  photos: PhotosRepository,
  sessionId: string,
): Promise<WindowState | null> {
  return photos.windowCounts(sessionId);
}

/**
 * The window closes when the helper has finished, nothing is in flight and every uploaded
 * photo has been downloaded. Once true it stays true: a finished session gets no new
 * upload slots, so nothing can be added after the check.
 */
export function isClosable(state: WindowState): boolean {
  return state.state === 'finished' && state.inFlight === 0 && state.left === 0;
}
