import { HttpException } from '@nestjs/common';
import { AppError } from './app-error';
import { DEFAULT_MESSAGES, type ErrorBody, type ErrorCode } from './error-codes';

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** True when the error was not expected and should be logged as an error. */
  unexpected: boolean;
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  // Fastify errors (bad JSON, body too large, wrong content type) carry statusCode.
  if (exception instanceof Error && 'statusCode' in exception) {
    const { statusCode } = exception as { statusCode: unknown };
    if (typeof statusCode === 'number') return statusCode;
  }
  return undefined;
}

/** Only INVALID_REQUEST keeps a specific message (e.g. validation details). */
function invalidRequestMessage(exception: unknown): string {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'object' && 'message' in response) {
      const { message } = response;
      if (Array.isArray(message) && message.every((m) => typeof m === 'string'))
        return message.join('; ');
      if (typeof message === 'string') return message;
    }
  }
  return DEFAULT_MESSAGES.INVALID_REQUEST;
}

export function mapException(exception: unknown): MappedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: { code: exception.code, message: exception.message },
      unexpected: exception.code === 'INTERNAL_ERROR',
    };
  }

  const status = statusOf(exception);
  if (status !== undefined && status >= 400 && status < 500) {
    const code = STATUS_TO_CODE[status] ?? 'INVALID_REQUEST';
    const message =
      code === 'INVALID_REQUEST' ? invalidRequestMessage(exception) : DEFAULT_MESSAGES[code];
    // Unlisted 4xx (405, 413, 415...) keep their real status with INVALID_REQUEST.
    return { status, body: { code, message }, unexpected: false };
  }

  // Anything else is a bug or an outage: never leak details to the client.
  return {
    status: 500,
    body: { code: 'INTERNAL_ERROR', message: DEFAULT_MESSAGES.INTERNAL_ERROR },
    unexpected: true,
  };
}
