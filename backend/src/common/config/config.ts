import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type RateLimitSettings,
} from '../../auth/rate-limit.config';

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  /** Base of the links in QR codes, e.g. https://picplease.app (no trailing slash). */
  linkBaseUrl: string;
  /** For create and claim. RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS are optional. */
  rateLimit: RateLimitSettings;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];

function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  problems: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1) {
    problems.push(`${name} must be a positive integer`);
    return fallback;
  }
  return value;
}

/**
 * Reads and validates the environment once at startup.
 * Only variables used so far are required. Error messages name the variable,
 * never its value, so secrets can't leak into logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const problems: string[] = [];

  const nodeEnvRaw = env.NODE_ENV;
  let nodeEnv: NodeEnv = 'development';
  if (!nodeEnvRaw) problems.push('NODE_ENV is required');
  else if (!isNodeEnv(nodeEnvRaw)) problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')}`);
  else nodeEnv = nodeEnvRaw;

  const portRaw = env.PORT;
  const port = Number(portRaw);
  if (!portRaw) problems.push('PORT is required');
  else if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535)
    problems.push('PORT must be an integer between 1 and 65535');

  const webOrigin = env.WEB_ORIGIN ?? '';
  if (!webOrigin) problems.push('WEB_ORIGIN is required');
  else {
    let url: URL | undefined;
    try {
      url = new URL(webOrigin);
    } catch {
      problems.push('WEB_ORIGIN must be a valid URL');
    }
    if (url) {
      if (url.origin !== webOrigin)
        problems.push(
          'WEB_ORIGIN must be a bare origin (scheme://host[:port], no path or trailing slash)',
        );
      if (nodeEnv === 'production' && url.protocol !== 'https:')
        problems.push('WEB_ORIGIN must use https in production');
    }
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) problems.push('DATABASE_URL is required');
  else if (!isPostgresUrl(databaseUrl))
    problems.push('DATABASE_URL must be a postgres:// or postgresql:// URL');

  const linkBaseUrl = env.LINK_BASE_URL ?? '';
  if (!linkBaseUrl) problems.push('LINK_BASE_URL is required');
  else {
    let url: URL | undefined;
    try {
      url = new URL(linkBaseUrl);
    } catch {
      problems.push('LINK_BASE_URL must be a valid URL');
    }
    if (url) {
      if (url.origin !== linkBaseUrl)
        problems.push(
          'LINK_BASE_URL must be a bare origin (scheme://host[:port], no trailing slash)',
        );
      if (nodeEnv === 'production' && url.protocol !== 'https:')
        problems.push('LINK_BASE_URL must use https in production');
    }
  }

  const rateLimitMax = positiveInt(env, 'RATE_LIMIT_MAX', DEFAULT_RATE_LIMIT_MAX, problems);
  const rateLimitWindowMs = positiveInt(
    env,
    'RATE_LIMIT_WINDOW_MS',
    DEFAULT_RATE_LIMIT_WINDOW_MS,
    problems,
  );

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv,
    port,
    webOrigin,
    databaseUrl,
    linkBaseUrl,
    rateLimit: { max: rateLimitMax, windowMs: rateLimitWindowMs },
  };
}
