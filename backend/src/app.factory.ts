import 'reflect-metadata';
import type { Writable } from 'node:stream';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config/config';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { buildCorsOptions } from './common/http/cors';
import { buildLoggerOptions } from './common/logging/logger-options';

export interface CreateAppOptions {
  /** Where request logs go. Defaults to stdout. Tests pass a stream to inspect output. */
  logStream?: Writable;
  /** Turn logging off entirely (used by the OpenAPI export). */
  silent?: boolean;
  /** Extra modules, for tests only. */
  imports?: Type[];
}

export async function createApp(
  config: AppConfig,
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: options.silent ? false : buildLoggerOptions(config.nodeEnv, options.logStream),
    // Nginx on the same host is the only proxy.
    trustProxy: '127.0.0.1',
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, options.imports),
    adapter,
    {
      logger: options.silent || config.nodeEnv === 'test' ? false : ['log', 'warn', 'error'],
    },
  );

  app.useGlobalFilters(new AllExceptionsFilter(adapter.getInstance().log));
  app.enableCors(buildCorsOptions(config.webOrigin));
  app.enableShutdownHooks();
  return app;
}
