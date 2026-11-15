import type { Writable } from 'node:stream';

const SENSITIVE_FIELDS = ['token', 'secret'];

// pino has no recursive wildcard, so cover the field at the top level and a few levels deep.
function fieldPaths(field: string, depth = 4): string[] {
  const paths: string[] = [];
  for (let level = 0; level <= depth; level++) {
    paths.push([...Array<string>(level).fill('*'), field].join('.'));
  }
  return paths;
}

export const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'headers.authorization',
  ...SENSITIVE_FIELDS.flatMap((f) => fieldPaths(f)),
];

export interface LoggerOptions {
  level: string;
  redact: { paths: string[]; censor: string };
  stream?: Writable;
}

export function buildLoggerOptions(nodeEnv: string, stream?: Writable): LoggerOptions {
  return {
    level: nodeEnv === 'test' ? 'warn' : 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(stream ? { stream } : {}),
  };
}
