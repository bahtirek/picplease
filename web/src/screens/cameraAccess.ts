import { h } from './dom';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const cameraAccess: ScreenFactory = (_state, { flow }) => {
  const button = h('button', {
    className: 'button primary',
    text: TEXT.allowCameraButton,
    attrs: { type: 'button' },
    onClick: () => {
      button.disabled = true;
      void flow.allowCamera().finally(() => {
        button.disabled = false;
      });
    },
  });
  return {
    root: h('div', { className: 'screen center' }, h('p', { text: TEXT.allowCameraBody }), button),
  };
};
