import './style.css';
import { ApiClient } from './api';
import { loadConfig } from './config';
import { start } from './startup';
import { createStore } from './state';
import { TokenStore } from './tokenStore';

const config = loadConfig(import.meta.env);
const store = createStore();

// Placeholder render until the screens arrive in W5.
const app = document.getElementById('app');
store.subscribe((state) => {
  if (app) app.textContent = state.screen;
});

void start({
  location: window.location,
  history: window.history,
  api: new ApiClient({ baseUrl: config.apiBase }),
  tokens: new TokenStore(),
  store,
});
