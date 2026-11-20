import { h } from './dom';
import type { ScreenFactory } from './types';

export const opening: ScreenFactory = () => ({
  root: h(
    'div',
    { className: 'screen center', attrs: { 'aria-busy': 'true' } },
    h('div', { className: 'spinner', attrs: { role: 'progressbar' } }),
  ),
});
