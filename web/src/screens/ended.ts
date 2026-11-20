import { h } from './dom';
import { getApp } from './getApp';
import { TEXT } from './text';
import type { ScreenFactory } from './types';

export const ended: ScreenFactory = (_state, { config }) => ({
  root: h('div', { className: 'screen center' }, h('p', { text: TEXT.ended }), getApp(config)),
});
