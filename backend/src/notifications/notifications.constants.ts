import type { SessionState } from '../database/sessions.repository';

/** Owner decision (slice 8b): at most one photo push per session per 60 s. */
export const PUSH_COOLDOWN_SECONDS = 60;

/** Photos can arrive (and so be pushed) while claimed, or finished during the window. */
export const PUSH_SESSION_STATES: readonly SessionState[] = ['claimed', 'finished'];

/** A device can be registered until the session ends. */
export const DEVICE_SESSION_STATES: readonly SessionState[] = ['pending', 'claimed', 'finished'];

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

/** Push tokens: APNs is hex, FCM is base64url-like with ':'. No spaces, slashes or quotes. */
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9_:.-]{1,4096}$/;
