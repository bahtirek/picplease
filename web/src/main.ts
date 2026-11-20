import './style.css';
import { ApiClient } from './api';
import { loadConfig } from './config';
import { HelperFlow } from './flow';
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

void start({ location: window.location, history: window.history, api, tokens, store });
