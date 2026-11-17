import type { SessionState } from '../database/sessions.repository';
import { SESSION_LIMITS } from '../sessions/sessions.constants';

export const DOWNLOAD_URL_TTL_SECONDS = SESSION_LIMITS.downloadUrlTtlSeconds;

/** States in which a photo may be downloaded or acknowledged (api-contract.md). */
export const DELIVERY_STATES: readonly SessionState[] = ['claimed', 'finished'];
