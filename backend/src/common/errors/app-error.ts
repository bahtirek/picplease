import { DEFAULT_MESSAGES, ERROR_STATUS, type ErrorCode } from './error-codes';

/**
 * The one error type modules throw. The global filter turns it into {code, message}.
 * Leave `message` out for NOT_FOUND and UNAUTHORIZED: the contract requires those
 * to look identical whatever the cause.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string = DEFAULT_MESSAGES[code],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}
