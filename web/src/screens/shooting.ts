/**
 * Camera screen: viewfinder, shutter, sent count, Finish, plus the offline banner, the "Sending…"
 * toast and the buffer-full alert (docs/mobile/helper.md "Camera rules").
 */
import type { AppState } from '../state';
import { h } from './dom';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const TOAST_MS = 1500;

export const shooting: ScreenFactory = (state, { flow, video }) => {
  const offline = h('div', { className: 'banner', text: TEXT.offline, attrs: { role: 'status' } });
  const full = h('div', { className: 'alert', text: TEXT.bufferFull, attrs: { role: 'status' } });
  const toast = h('div', {
    className: 'toast',
    text: TEXT.sendingToast,
    attrs: { role: 'status' },
  });
  const count = h('p', { className: 'count' });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const shutter = h('button', {
    className: 'shutter',
    attrs: { type: 'button', 'aria-label': TEXT.shutterLabel },
    onClick: () => {
      if (flow.shoot() !== 'accepted') return;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.hidden = true;
      }, TOAST_MS);
    },
  });

  const finish = h('button', {
    className: 'link',
    text: TEXT.finish,
    attrs: { type: 'button' },
    onClick: () => {
      void flow.finishTapped();
    },
  });

  video.className = 'viewfinder';
  toast.hidden = true;

  const update = (next: Readonly<AppState>): void => {
    const isFull =
      next.session !== null && next.uploads.inFlight >= next.session.limits.maxInFlight;
    offline.hidden = next.online;
    full.hidden = !isFull || !next.online;
    shutter.disabled = !next.online || isFull;
    count.textContent = TEXT.sent(next.uploads.sent);
  };
  update(state);

  return {
    root: h(
      'div',
      { className: 'screen shooting' },
      video,
      h('div', { className: 'overlay top' }, offline, full, toast),
      h('div', { className: 'overlay bottom' }, count, shutter, finish),
    ),
    update,
    destroy() {
      clearTimeout(toastTimer);
    },
  };
};
