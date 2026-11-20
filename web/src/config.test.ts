import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const dev = {
  VITE_API_BASE: 'http://localhost:3000',
  VITE_WS_URL: 'ws://localhost:3000/ws',
  VITE_APP_STORE_URL: '',
  VITE_PLAY_STORE_URL: '',
  PROD: false,
};

describe('loadConfig', () => {
  it('reads the development values, empty store links become null', () => {
    expect(loadConfig(dev)).toEqual({
      apiBase: 'http://localhost:3000',
      wsUrl: 'ws://localhost:3000/ws',
      appStoreUrl: null,
      playStoreUrl: null,
    });
  });

  it('reads store links when set', () => {
    const config = loadConfig({
      ...dev,
      VITE_APP_STORE_URL: 'https://apps.apple.com/app/id1',
      VITE_PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=app.picplease',
    });
    expect(config.appStoreUrl).toBe('https://apps.apple.com/app/id1');
    expect(config.playStoreUrl).toBe('https://play.google.com/store/apps/details?id=app.picplease');
  });

  it('refuses a missing API base or WebSocket URL', () => {
    expect(() => loadConfig({ ...dev, VITE_API_BASE: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...dev, VITE_WS_URL: ' ' })).toThrow(ConfigError);
  });

  it('refuses invalid URLs and a trailing slash', () => {
    expect(() => loadConfig({ ...dev, VITE_API_BASE: 'not a url' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...dev, VITE_API_BASE: 'http://localhost:3000/' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...dev, VITE_APP_STORE_URL: 'http://apps.apple.com' })).toThrow(
      ConfigError,
    );
  });

  it('requires https and wss in production', () => {
    expect(() => loadConfig({ ...dev, PROD: true })).toThrow(ConfigError);
    expect(
      loadConfig({
        ...dev,
        PROD: true,
        VITE_API_BASE: 'https://api.picplease.app',
        VITE_WS_URL: 'wss://api.picplease.app/ws',
      }).apiBase,
    ).toBe('https://api.picplease.app');
  });
});
