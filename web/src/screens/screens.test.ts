// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, type AppState, type HelperSession } from '../state';
import { mountScreens } from './render';
import { TEXT } from './text';
import type { ScreenContext } from './types';

const SESSION: HelperSession = {
  sessionId: '3428da7f-d9f8-48a5-879b-971b2e1c3a54',
  token: 't',
  limits: { maxInFlight: 5, maxPhotoBytes: 5 * 1024 * 1024, uploadUrlTtlSeconds: 600 },
};
const APP_STORE = 'https://apps.apple.com/app/id123';
const PLAY = 'https://play.google.com/store/apps/details?id=app.picplease';

function mount(patch: Partial<AppState>, config: Partial<ScreenContext['config']> = {}) {
  const store = createStore();
  store.set({ session: SESSION, ...patch });
  const flow = {
    allowCamera: vi.fn(() => Promise.resolve()),
    shoot: vi.fn(() => 'accepted' as const),
    finishTapped: vi.fn(() => Promise.resolve()),
  };
  const container = document.createElement('main');
  document.body.replaceChildren(container);
  const video = document.createElement('video');
  mountScreens(container, store, {
    config: { appStoreUrl: null, playStoreUrl: null, ...config },
    flow,
    video,
  });
  return { container, store, flow, video };
}

const text = (el: Element) => el.textContent.replace(/\s+/g, ' ').trim();
const visible = (el: Element | null) => el !== null && !(el as HTMLElement).hidden;

describe('screens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('thanks shows the store links from env (test 17)', () => {
    const { container } = mount(
      { screen: 'thanks' },
      { appStoreUrl: APP_STORE, playStoreUrl: PLAY },
    );
    expect(text(container)).toContain(TEXT.thanks);
    expect(text(container)).toContain(TEXT.getApp);
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.href]);
    expect(links).toEqual([
      [TEXT.appStore, APP_STORE],
      [TEXT.googlePlay, PLAY],
    ]);
    expect(container.querySelector('a')?.getAttribute('rel')).toContain('noopener');
  });

  it('hides a store button whose link is not set, and the section when none is', () => {
    const one = mount({ screen: 'thanks' }, { playStoreUrl: PLAY }).container;
    expect([...one.querySelectorAll('a')].map((a) => a.textContent)).toEqual([TEXT.googlePlay]);
    const none = mount({ screen: 'thanks' }).container;
    expect(none.querySelector('.get-app')).toBeNull();
    expect(text(none)).toBe(TEXT.thanks);
  });

  it.each([
    ['used', TEXT.codeUsed],
    ['invalid', TEXT.codeInvalid],
    ['unreachable', TEXT.offline],
  ] as const)('codeProblem %s shows its message', (reason, message) => {
    expect(text(mount({ screen: 'codeProblem', codeProblem: reason }).container)).toBe(message);
  });

  it.each([
    ['denied', TEXT.cameraDenied],
    ['unavailable', TEXT.cameraUnavailable],
  ] as const)('noCamera %s shows its message and Get the app', (problem, message) => {
    const { container } = mount(
      { screen: 'noCamera', cameraProblem: problem },
      { appStoreUrl: APP_STORE },
    );
    expect(text(container)).toContain(message);
    expect(container.querySelector('a')?.href).toBe(APP_STORE);
  });

  it('camera access asks, and the button calls allowCamera', () => {
    const { container, flow } = mount({ screen: 'cameraAccess' });
    expect(text(container)).toContain(TEXT.allowCameraBody);
    const button = container.querySelector('button');
    expect(button?.textContent).toBe(TEXT.allowCameraButton);
    button?.click();
    expect(flow.allowCamera).toHaveBeenCalledOnce();
  });

  it('shooting shows the viewfinder, count, shutter and Finish', () => {
    const { container, flow, video, store } = mount({ screen: 'shooting' });
    expect(container.contains(video)).toBe(true);
    expect(text(container)).toContain(TEXT.sent(0));
    const shutter = container.querySelector<HTMLButtonElement>('.shutter');
    expect(shutter?.getAttribute('aria-label')).toBe(TEXT.shutterLabel);
    shutter?.click();
    expect(flow.shoot).toHaveBeenCalledOnce();
    container.querySelector<HTMLButtonElement>('.link')?.click();
    expect(flow.finishTapped).toHaveBeenCalledOnce();

    store.set({ uploads: { inFlight: 0, sent: 3, failed: 0 } });
    expect(text(container)).toContain(TEXT.sent(3));
    expect(container.contains(video)).toBe(true);
  });

  it('shows the Sending… toast after a shot, and it goes away by itself', () => {
    vi.useFakeTimers();
    const { container } = mount({ screen: 'shooting' });
    const toast = container.querySelector('.toast');
    expect(visible(toast)).toBe(false);
    container.querySelector<HTMLButtonElement>('.shutter')?.click();
    expect(visible(toast)).toBe(true);
    expect(toast?.textContent).toBe(TEXT.sendingToast);
    vi.advanceTimersByTime(2000);
    expect(visible(toast)).toBe(false);
  });

  it('5 in flight: buffer alert and a disabled shutter, until a slot frees', () => {
    const { container, store } = mount({ screen: 'shooting' });
    const shutter = container.querySelector<HTMLButtonElement>('.shutter');
    const alert = container.querySelector('.alert');
    store.set({ uploads: { inFlight: 5, sent: 0, failed: 0 } });
    expect(visible(alert)).toBe(true);
    expect(alert?.textContent).toBe(TEXT.bufferFull);
    expect(shutter?.disabled).toBe(true);
    store.set({ uploads: { inFlight: 4, sent: 1, failed: 0 } });
    expect(visible(alert)).toBe(false);
    expect(shutter?.disabled).toBe(false);
  });

  it('offline: banner shows and the shutter is blocked', () => {
    const { container, store } = mount({ screen: 'shooting' });
    store.set({ online: false });
    expect(visible(container.querySelector('.banner'))).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.shutter')?.disabled).toBe(true);
  });

  it('sending asks to keep the page open and counts up', () => {
    const { container, store } = mount({ screen: 'sending' });
    expect(text(container)).toContain(TEXT.keepOpen);
    store.set({ uploads: { inFlight: 1, sent: 2, failed: 0 } });
    expect(text(container)).toContain(TEXT.sent(2));
  });

  it('ended shows the session ended message', () => {
    expect(text(mount({ screen: 'ended' }).container)).toBe(TEXT.ended);
  });

  it('a new screen replaces the old one', () => {
    const { container, store } = mount({ screen: 'opening' });
    expect(container.querySelector('.spinner')).not.toBeNull();
    store.set({ screen: 'ended' });
    expect(container.querySelector('.spinner')).toBeNull();
    expect(container.children).toHaveLength(1);
  });
});
