/** Page configuration from VITE_ variables (see web/.env.example). Values are public. */
export interface WebConfig {
  apiBase: string;
  wsUrl: string;
  appStoreUrl: string | null;
  playStoreUrl: string | null;
}

export type ConfigEnv = Record<string, string | boolean | undefined>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function requiredUrl(env: ConfigEnv, key: string, protocols: readonly string[]): string {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ConfigError(`${key} is not set`);
  }
  return checkedUrl(key, raw.trim(), protocols);
}

function optionalUrl(env: ConfigEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return checkedUrl(key, raw.trim(), ['https:']);
}

function checkedUrl(key: string, value: string, protocols: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${key} is not a valid URL`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new ConfigError(`${key} must use ${protocols.join(' or ')}`);
  }
  return value;
}

/** Production builds must use https and wss; development may use http and ws. */
export function loadConfig(env: ConfigEnv): WebConfig {
  const prod = env.PROD === true;
  const apiBase = requiredUrl(env, 'VITE_API_BASE', prod ? ['https:'] : ['https:', 'http:']);
  if (apiBase.endsWith('/')) {
    throw new ConfigError('VITE_API_BASE must not end with a slash');
  }
  return {
    apiBase,
    wsUrl: requiredUrl(env, 'VITE_WS_URL', prod ? ['wss:'] : ['wss:', 'ws:']),
    appStoreUrl: optionalUrl(env, 'VITE_APP_STORE_URL'),
    playStoreUrl: optionalUrl(env, 'VITE_PLAY_STORE_URL'),
  };
}
