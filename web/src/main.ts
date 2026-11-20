import './style.css';
import { ApiClient } from './api';
import { loadConfig } from './config';
import { HelperFlow } from './flow';
import { Lifecycle } from './lifecycle';
import { HelperRealtime } from './realtime';
import { mountScreens } from './screens/render';
import { start } from './startup';
import { createStore } from './state';
import { TokenStore } from './tokenStore';

const config = loadConfig(import.meta.env);
const store = createStore();
const api = new ApiClient({ baseUrl: config.apiBase });
const tokens = new TokenStore();
const video = document.createElement('video');
const flow = new HelperFlow({ store, api, tokens, video });

const app = document.getElementById('app');
if (app) mountScreens(app, store, { config, flow, video });

flow.setOnline(navigator.onLine);
window.addEventListener('online', () => {
  flow.setOnline(true);
});
window.addEventListener('offline', () => {
  flow.setOnline(false);
});

const lifecycle = new Lifecycle({
  store,
  flow,
  api,
  apiBase: config.apiBase,
  document,
  window,
});
lifecycle.start();

// Realtime runs from the claim until thanks or ended.
let realtime: HelperRealtime | null = null;
store.subscribe((state) => {
  const over = state.screen === 'thanks' || state.screen === 'ended';
  if (!realtime && state.session && !over) {
    realtime = new HelperRealtime({ url: config.wsUrl, token: state.session.token, flow });
    realtime.start();
  } else if (realtime && over) {
    realtime.stop();
    lifecycle.stop();
  }
});

void start({ location: window.location, history: window.history, api, tokens, store });
