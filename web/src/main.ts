import './style.css';
import { loadConfig } from './config';

// W1 placeholder: checks the config and shows an empty page. Flow code arrives in W2 onwards.
loadConfig(import.meta.env);

const app = document.getElementById('app');
if (app) {
  app.textContent = 'PicPlease';
}
