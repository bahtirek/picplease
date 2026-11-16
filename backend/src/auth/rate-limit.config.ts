import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { RouteConfig } from '@nestjs/platform-fastify';
import { AppError } from '../common/errors';

/** docs/backend/decisions.md: 10 per minute per IP for create and claim (tunable by env). */
export const DEFAULT_RATE_LIMIT_MAX = 10;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimitSettings {
  max: number;
  windowMs: number;
}

/**
 * Plugin options. `global: false` means only routes marked with @RateLimited() are limited.
 * Each marked route counts per client IP on its own. The key is the IP Fastify resolves,
 * which trusts X-Forwarded-For only from the local Nginx (see app.factory.ts).
 */
export function buildRateLimitOptions(settings: RateLimitSettings): RateLimitPluginOptions {
  return {
    global: false,
    max: settings.max,
    timeWindow: settings.windowMs,
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  };
}

/** Marks a route as rate limited with the app-wide settings. */
export const RateLimited = (): MethodDecorator => RouteConfig({ rateLimit: {} });
