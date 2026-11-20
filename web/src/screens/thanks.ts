import { h } from './dom';
import { getApp } from './getApp';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const thanks: ScreenFactory = (_state, { config }) => ({
  root: h('div', { className: 'screen center' }, h('h1', { text: TEXT.thanks }), getApp(config)),
});
