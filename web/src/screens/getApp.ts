import { h } from './dom';
import { TEXT } from './text';
import type { ScreenContext } from './types';

/** "Get the app" with a button per store link that is set; nothing when neither is set. */
export function getApp(config: ScreenContext['config']): HTMLElement | null {
  const links = [
    config.appStoreUrl && storeLink(config.appStoreUrl, TEXT.appStore),
    config.playStoreUrl && storeLink(config.playStoreUrl, TEXT.googlePlay),
  ].filter((link): link is HTMLAnchorElement => Boolean(link));
  if (links.length === 0) return null;
  return h(
    'section',
    { className: 'get-app' },
    h('h2', { text: TEXT.getApp }),
    h('div', { className: 'store-links' }, ...links),
  );
}

function storeLink(href: string, label: string): HTMLAnchorElement {
  return h('a', {
    className: 'button',
    text: label,
    attrs: { href, rel: 'noopener noreferrer', target: '_blank' },
  });
}
