import { ConfigError, loadConfig } from './config';

const valid = {
  NODE_ENV: 'production',
  PORT: '3000',
  WEB_ORIGIN: 'https://picplease.app',
  DATABASE_URL: 'postgres://app:pw@127.0.0.1:5432/picplease',
  LINK_BASE_URL: 'https://picplease.app',
};

function problemsFor(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe('loadConfig', () => {
  it('returns typed config for a valid environment', () => {
    expect(loadConfig(valid)).toEqual({
      nodeEnv: 'production',
      port: 3000,
      webOrigin: 'https://picplease.app',
      databaseUrl: 'postgres://app:pw@127.0.0.1:5432/picplease',
      linkBaseUrl: 'https://picplease.app',
      rateLimit: { max: 10, windowMs: 60_000 },
    });
  });

  it('does not require variables that are not used yet', () => {
    expect(() => loadConfig(valid)).not.toThrow();
  });

  it('lists every missing variable at once', () => {
    expect(problemsFor({})).toEqual([
      'NODE_ENV is required',
      'PORT is required',
      'WEB_ORIGIN is required',
      'DATABASE_URL is required',
      'LINK_BASE_URL is required',
    ]);
  });

  it.each([['0'], ['70000'], ['abc'], ['30.5']])('rejects PORT=%s', (port) => {
    expect(problemsFor({ ...valid, PORT: port })).toEqual([
      'PORT must be an integer between 1 and 65535',
    ]);
  });

  it.each([['https://picplease.app/'], ['https://picplease.app/s'], ['nope']])(
    'rejects LINK_BASE_URL=%s',
    (link) => {
      expect(problemsFor({ ...valid, LINK_BASE_URL: link })).toHaveLength(1);
    },
  );

  it('requires https for LINK_BASE_URL in production', () => {
    expect(problemsFor({ ...valid, LINK_BASE_URL: 'http://picplease.app' })).toEqual([
      'LINK_BASE_URL must use https in production',
    ]);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(problemsFor({ ...valid, NODE_ENV: 'staging' })).toHaveLength(1);
  });

  it.each([['https://picplease.app/'], ['https://picplease.app/path'], ['not a url']])(
    'rejects WEB_ORIGIN=%s',
    (origin) => {
      expect(problemsFor({ ...valid, WEB_ORIGIN: origin })).toHaveLength(1);
    },
  );

  it('requires https for WEB_ORIGIN in production only', () => {
    expect(problemsFor({ ...valid, WEB_ORIGIN: 'http://localhost:5173' })).toEqual([
      'WEB_ORIGIN must use https in production',
    ]);
    expect(
      problemsFor({ ...valid, NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173' }),
    ).toEqual([]);
  });

  it.each([['mysql://a:b@host/db'], ['not a url']])('rejects DATABASE_URL=%s', (url) => {
    expect(problemsFor({ ...valid, DATABASE_URL: url })).toEqual([
      'DATABASE_URL must be a postgres:// or postgresql:// URL',
    ]);
  });

  it('never puts values in the error message', () => {
    const err = (() => {
      try {
        loadConfig({ ...valid, PORT: 'secret-value-123' });
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected loadConfig to throw');
    })();
    expect(err.message).not.toContain('secret-value-123');
  });

  it('uses rate limit defaults and accepts positive integer overrides', () => {
    expect(
      loadConfig({ ...valid, RATE_LIMIT_MAX: '20', RATE_LIMIT_WINDOW_MS: '30000' }).rateLimit,
    ).toEqual({ max: 20, windowMs: 30_000 });
    expect(problemsFor({ ...valid, RATE_LIMIT_MAX: '0', RATE_LIMIT_WINDOW_MS: '1.5' })).toEqual([
      'RATE_LIMIT_MAX must be a positive integer',
      'RATE_LIMIT_WINDOW_MS must be a positive integer',
    ]);
  });
});
