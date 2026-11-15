/** Error codes from docs/backend/api-contract.md, with their HTTP status. */
export const ERROR_STATUS = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  ALREADY_CLAIMED: 409,
  SESSION_FINISHED: 409,
  SESSION_GONE: 410,
  UPLOAD_LIMIT_REACHED: 429,
  RATE_LIMITED: 429,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: 'Not found.',
  UNAUTHORIZED: 'Missing or invalid token.',
  ALREADY_CLAIMED: 'This session has already been claimed.',
  SESSION_FINISHED: 'This session is finished.',
  SESSION_GONE: 'This session is no longer available.',
  UPLOAD_LIMIT_REACHED: 'Too many uploads in progress.',
  RATE_LIMITED: 'Too many requests.',
  INVALID_REQUEST: 'Invalid request.',
  INTERNAL_ERROR: 'Unexpected server error.',
};

export interface ErrorBody {
  code: ErrorCode;
  message: string;
}
