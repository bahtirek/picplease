import { h } from './dom';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const codeProblem: ScreenFactory = (state) => {
  const text =
    state.codeProblem === 'used'
      ? TEXT.codeUsed
      : state.codeProblem === 'unreachable'
        ? TEXT.offline
        : TEXT.codeInvalid;
  return { root: h('div', { className: 'screen center' }, h('p', { text })) };
};
