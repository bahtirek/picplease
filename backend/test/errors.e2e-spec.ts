import { Writable } from 'node:stream';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { AppError } from '../src/common/errors';

@Controller('test-errors')
class ThrowingController {
  @Get('gone')
  gone(): never {
    throw new AppError('SESSION_GONE');
  }

  @Get('crash')
  crash(): never {
    throw new Error('connection to db failed: password=hunter2');
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

@Module({ controllers: [ThrowingController] })
class ThrowingModule {}

class MemoryStream extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.lines.push(chunk.toString());
    cb();
  }
}

describe('errors (e2e)', () => {
  let app: NestFastifyApplication;
  const logs = new MemoryStream();

  beforeAll(async () => {
    app = await createApp(
      {
        nodeEnv: 'test',
        port: 0,
        webOrigin: 'https://picplease.app',
        databaseUrl: 'postgres://user:pass@127.0.0.1:5432/unused',
      },
      { logStream: logs, imports: [ThrowingModule] },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns {code, message} for an AppError', async () => {
    const res = await app.inject({ method: 'GET', url: '/test-errors/gone' });
    expect(res.statusCode).toBe(410);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toEqual({
      code: 'SESSION_GONE',
      message: 'This session is no longer available.',
    });
  });

  it('returns NOT_FOUND for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
  });

  it('returns INVALID_REQUEST for malformed JSON', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-errors/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"bad":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns INVALID_REQUEST with 415 for an unsupported content type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test-errors/echo',
      headers: { 'content-type': 'application/x-unknown' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns a generic INTERNAL_ERROR and logs the cause server-side', async () => {
    const res = await app.inject({ method: 'GET', url: '/test-errors/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
    expect(res.body).not.toContain('hunter2');
    expect(logs.lines.join('')).toContain('unhandled error');
  });

  it('keeps CORS headers on error responses for WEB_ORIGIN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-errors/gone',
      headers: { origin: 'https://picplease.app' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://picplease.app');
  });
});
