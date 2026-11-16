import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import type { AppConfig } from '../src/common/config/config';

const config: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  webOrigin: 'https://picplease.app',
  databaseUrl: 'postgres://user:pass@127.0.0.1:5432/unused',
};

class MemoryStream extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.lines.push(chunk.toString());
    cb();
  }
}

describe('app (e2e)', () => {
  let app: NestFastifyApplication;
  const logs = new MemoryStream();

  beforeAll(async () => {
    app = await createApp(config, { logStream: logs });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns {"status":"ok"}', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('CORS', () => {
    it('allows WEB_ORIGIN on a simple request', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://picplease.app' },
      });
      expect(res.headers['access-control-allow-origin']).toBe('https://picplease.app');
    });

    it('answers a preflight from WEB_ORIGIN with Authorization and Content-Type', async () => {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://picplease.app',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://picplease.app');
      const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
      expect(allowed).toContain('authorization');
      expect(allowed).toContain('content-type');
    });

    it.each([
      ['https://evil.example'],
      ['http://picplease.app'],
      ['https://picplease.app.evil.example'],
    ])('sends no CORS headers to %s', async (origin) => {
      const res = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not affect requests without an Origin header (native apps)', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('logging redaction', () => {
    it('redacts the Authorization header and fields named token or secret', () => {
      const log = app.getHttpAdapter().getInstance().log;
      log.warn(
        {
          req: { headers: { authorization: 'Bearer abc.def.ghi' } },
          token: 'top-level-token',
          secret: 'top-level-secret',
          body: { token: 'nested-token', deeper: { secret: 'nested-secret' } },
          keep: 'visible',
        },
        'redaction check',
      );
      const output = logs.lines.join('');
      expect(output).toContain('redaction check');
      expect(output).toContain('visible');
      for (const leaked of [
        'abc.def.ghi',
        'top-level-token',
        'top-level-secret',
        'nested-token',
        'nested-secret',
      ]) {
        expect(output).not.toContain(leaked);
      }
      expect(output).toContain('[REDACTED]');
    });
  });
});
