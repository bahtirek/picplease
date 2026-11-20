import { h } from './dom';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const sending: ScreenFactory = (state) => {
  const count = h('p', { className: 'count', text: TEXT.sent(state.uploads.sent) });
  return {
    root: h(
      'div',
      { className: 'screen center', attrs: { 'aria-live': 'polite' } },
      h('div', { className: 'spinner', attrs: { role: 'progressbar' } }),
      h('p', { text: TEXT.keepOpen }),
      count,
    ),
    update(next) {
      count.textContent = TEXT.sent(next.uploads.sent);
    },
  };
};
