import { h } from './dom';
import { getApp } from './getApp';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const noCamera: ScreenFactory = (state, { config }) => ({
  root: h(
    'div',
    { className: 'screen center' },
    h('p', {
      text: state.cameraProblem === 'denied' ? TEXT.cameraDenied : TEXT.cameraUnavailable,
    }),
    getApp(config),
  ),
});
