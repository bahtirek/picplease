import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppError } from './app-error';
import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode } from './error-codes';
import { mapException } from './error-mapping';

function fastifyError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code: 'FST_ERR_X' });
}

describe('mapException', () => {
  it.each(Object.entries(ERROR_STATUS) as [ErrorCode, number][])(
    'maps AppError %s to HTTP %i with its default message',
    (code, status) => {
      expect(mapException(new AppError(code))).toEqual({
        status,
        body: { code, message: DEFAULT_MESSAGES[code] },
        unexpected: code === 'INTERNAL_ERROR',
      });
    },
  );

  it('keeps a custom AppError message', () => {
    expect(
      mapException(new AppError('INVALID_REQUEST', 'graceSeconds must be <= 30')).body,
    ).toEqual({
      code: 'INVALID_REQUEST',
      message: 'graceSeconds must be <= 30',
    });
  });

  it('uses the same body for NOT_FOUND whatever caused it', () => {
    const a = mapException(new AppError('NOT_FOUND'));
    const b = mapException(new NotFoundException('Cannot GET /sessions/abc'));
    expect(a).toEqual(b);
  });

  it('hides the detail of 401 HttpExceptions', () => {
    expect(mapException(new UnauthorizedException('token expired at 12:00')).body).toEqual({
      code: 'UNAUTHORIZED',
      message: DEFAULT_MESSAGES.UNAUTHORIZED,
    });
  });

  it('maps 429 HttpException to RATE_LIMITED', () => {
    expect(mapException(new HttpException('slow down', 429))).toMatchObject({
      status: 429,
      body: { code: 'RATE_LIMITED' },
    });
  });

  it('keeps validation messages for 400', () => {
    const err = new BadRequestException(['name must be a string', 'age must be a number']);
    expect(mapException(err)).toEqual({
      status: 400,
      body: { code: 'INVALID_REQUEST', message: 'name must be a string; age must be a number' },
      unexpected: false,
    });
  });

  it.each([[405], [413], [415]])(
    'maps unlisted 4xx %i to INVALID_REQUEST, keeping the status',
    (status) => {
      expect(mapException(fastifyError(status, 'x'))).toMatchObject({
        status,
        body: { code: 'INVALID_REQUEST' },
        unexpected: false,
      });
    },
  );

  it('does not invent a domain code for a bare 409', () => {
    expect(mapException(new ConflictException()).body.code).toBe('INVALID_REQUEST');
  });

  it.each([
    ['a plain Error', new Error('db password is hunter2')],
    ['a thrown string', 'boom'],
    ['a 503 HttpException', new HttpException('upstream down', 503)],
    ['a Fastify 500', fastifyError(500, 'internal')],
  ])('maps %s to a generic INTERNAL_ERROR', (_name, exception) => {
    expect(mapException(exception)).toEqual({
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: DEFAULT_MESSAGES.INTERNAL_ERROR },
      unexpected: true,
    });
  });
});
