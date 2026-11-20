/**
 * fetch wrappers for the helper calls (docs/web/api-usage.md). The token always travels in the
 * Authorization header, never in a URL. Nothing here logs.
 */

export const SERVER_ERROR_CODES = [
  'NOT_FOUND',
  'UNAUTHORIZED',
  'ALREADY_CLAIMED',
  'SESSION_FINISHED',
  'SESSION_GONE',
  'UPLOAD_LIMIT_REACHED',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];
/** NETWORK: no answer (offline, timeout, CORS refusal). */
export type ApiErrorCode = ServerErrorCode | 'NETWORK';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number | null,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface Limits {
  maxInFlight: number;
  maxPhotoBytes: number;
  uploadUrlTtlSeconds: number;
}

/** Used only when the claim response leaves a limit out (docs/web/overview.md). */
export const DEFAULT_LIMITS: Limits = {
  maxInFlight: 5,
  maxPhotoBytes: 5 * 1024 * 1024,
  uploadUrlTtlSeconds: 600,
};

export interface ClaimResult {
  sessionId: string;
  helperToken: string;
  limits: Limits;
}

export interface UploadTarget {
  photoId: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export type SessionState = 'pending' | 'claimed' | 'finished' | 'revoked' | 'expired' | 'closed';

export interface SessionStatus {
  sessionId: string;
  state: SessionState;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const STATES: readonly SessionState[] = [
  'pending',
  'claimed',
  'finished',
  'revoked',
  'expired',
  'closed',
];

/** The body's code wins; the HTTP status is the fallback. */
export function errorFromResponse(status: number, body: unknown): ApiError {
  if (isRecord(body) && typeof body.code === 'string') {
    const code = SERVER_ERROR_CODES.find((c) => c === body.code);
    if (code) {
      return new ApiError(code, status, typeof body.message === 'string' ? body.message : code);
    }
  }
  return new ApiError(codeForStatus(status), status);
}

function codeForStatus(status: number): ServerErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 410) return 'SESSION_GONE';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL_ERROR';
  return 'INVALID_REQUEST';
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async claim(sessionId: string, secret: string): Promise<ClaimResult> {
    const body = await this.request(`/sessions/${seg(sessionId)}/claim`, null, { secret });
    if (!isRecord(body) || typeof body.helperToken !== 'string' || body.helperToken === '') {
      throw badResponse();
    }
    return {
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : sessionId,
      helperToken: body.helperToken,
      limits: readLimits(body.limits),
    };
  }

  async issueUpload(sessionId: string, token: string): Promise<UploadTarget> {
    const body = await this.request(`/sessions/${seg(sessionId)}/photos`, token, {
      contentType: 'image/jpeg',
    });
    if (
      !isRecord(body) ||
      typeof body.photoId !== 'string' ||
      typeof body.url !== 'string' ||
      typeof body.expiresAt !== 'string' ||
      !isStringMap(body.headers)
    ) {
      throw badResponse();
    }
    return {
      photoId: body.photoId,
      url: body.url,
      headers: body.headers,
      expiresAt: body.expiresAt,
    };
  }

  async confirm(photoId: string, token: string): Promise<void> {
    await this.request(`/photos/${seg(photoId)}/confirm`, token, {});
  }

  async finish(sessionId: string, token: string, graceSeconds?: number): Promise<SessionStatus> {
    const payload = graceSeconds === undefined ? {} : { graceSeconds };
    return readStatus(await this.request(`/sessions/${seg(sessionId)}/finish`, token, payload));
  }

  async resume(sessionId: string, token: string): Promise<SessionStatus> {
    return readStatus(await this.request(`/sessions/${seg(sessionId)}/resume`, token, {}));
  }

  private async request(path: string, token: string | null, payload: object): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== null) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchFn(this.baseUrl + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ApiError('NETWORK', null);
    }

    let body: unknown;
    try {
      const text = await response.text();
      body = text === '' ? null : (JSON.parse(text) as unknown);
    } catch {
      body = null;
    }
    if (!response.ok) throw errorFromResponse(response.status, body);
    return body;
  }
}

function seg(id: string): string {
  return encodeURIComponent(id);
}

function badResponse(): ApiError {
  return new ApiError('INTERNAL_ERROR', null, 'Unexpected response');
}

function readStatus(body: unknown): SessionStatus {
  if (!isRecord(body) || typeof body.sessionId !== 'string') throw badResponse();
  const state = STATES.find((s) => s === body.state);
  if (!state) throw badResponse();
  return { sessionId: body.sessionId, state };
}

function readLimits(raw: unknown): Limits {
  const source = isRecord(raw) ? raw : {};
  const pick = (key: keyof Limits): number => {
    const value = source[key];
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : DEFAULT_LIMITS[key];
  };
  return {
    maxInFlight: pick('maxInFlight'),
    maxPhotoBytes: pick('maxPhotoBytes'),
    uploadUrlTtlSeconds: pick('uploadUrlTtlSeconds'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}
