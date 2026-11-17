import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  type RateLimitSettings,
} from '../../auth/rate-limit.config';
import type { R2Settings } from '../../database/r2.client';
import type { ApnsSettings } from '../../notifications/apns.provider';
import type { FcmSettings } from '../../notifications/fcm.provider';

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
  /** Photo bucket. Never the production bucket outside production. */
  r2: R2Settings;
  /** Push credentials. Each provider is optional; null turns that platform's pushes off. */
  push: { apns: ApnsSettings | null; fcm: FcmSettings | null };
}

export const PRODUCTION_BUCKET = 'picplease-photos-prod';

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

  const r2Endpoint = env.R2_ENDPOINT ?? '';
  if (!r2Endpoint) problems.push('R2_ENDPOINT is required');
  else {
    let url: URL | undefined;
    try {
      url = new URL(r2Endpoint);
    } catch {
      problems.push('R2_ENDPOINT must be a valid URL');
    }
    if (url && url.protocol !== 'https:') problems.push('R2_ENDPOINT must use https');
  }

  const r2Bucket = env.R2_BUCKET ?? '';
  if (!r2Bucket) problems.push('R2_BUCKET is required');
  else if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r2Bucket))
    problems.push('R2_BUCKET must be a valid bucket name');
  else if (nodeEnv !== 'production' && r2Bucket === PRODUCTION_BUCKET)
    problems.push('R2_BUCKET must not be the production bucket outside production');

  const r2AccessKeyId = env.R2_ACCESS_KEY_ID ?? '';
  if (!r2AccessKeyId) problems.push('R2_ACCESS_KEY_ID is required');
  const r2SecretAccessKey = env.R2_SECRET_ACCESS_KEY ?? '';
  if (!r2SecretAccessKey) problems.push('R2_SECRET_ACCESS_KEY is required');

  const apns = loadApns(env, nodeEnv, problems);
  const fcmFile = env.FCM_SERVICE_ACCOUNT_FILE ?? '';
  const fcm: FcmSettings | null = fcmFile ? { serviceAccountFile: fcmFile } : null;

  if (problems.length > 0) throw new ConfigError(problems);
  return {
    nodeEnv,
    port,
    webOrigin,
    databaseUrl,
    linkBaseUrl,
    rateLimit: { max: rateLimitMax, windowMs: rateLimitWindowMs },
    r2: {
      endpoint: r2Endpoint,
      bucket: r2Bucket,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
    push: { apns, fcm },
  };
}

const APNS_REQUIRED = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_KEY_FILE'] as const;

/** All four APNS_* variables or none. APNS_ENVIRONMENT defaults to production only in production. */
function loadApns(
  env: NodeJS.ProcessEnv,
  nodeEnv: NodeEnv,
  problems: string[],
): ApnsSettings | null {
  const set = APNS_REQUIRED.filter((name) => env[name]);
  const environment = env.APNS_ENVIRONMENT || (nodeEnv === 'production' ? 'production' : 'sandbox');
  if (environment !== 'production' && environment !== 'sandbox')
    problems.push('APNS_ENVIRONMENT must be production or sandbox');
  if (set.length === 0) return null;
  if (set.length < APNS_REQUIRED.length) {
    for (const name of APNS_REQUIRED)
      if (!env[name]) problems.push(`${name} is required when any APNS_* variable is set`);
    return null;
  }
  return {
    keyId: env.APNS_KEY_ID ?? '',
    teamId: env.APNS_TEAM_ID ?? '',
    bundleId: env.APNS_BUNDLE_ID ?? '',
    keyFile: env.APNS_KEY_FILE ?? '',
    environment: environment === 'production' ? 'production' : 'sandbox',
  };
}
