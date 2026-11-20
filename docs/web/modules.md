# Web: modules

All under `web/src/`. One file, one job.

| File | Job |
|---|---|
| main.ts | Wiring only: config, store, ApiClient, TokenStore, then `start` |
| startup.ts | Start-up: parse link, claim (or reuse the tab's stored token after a reload), choose first screen; claim errors become a `codeProblem` reason (`used`, `invalid`, `unreachable`) |
| tokenStore.ts | Helper token and limits in sessionStorage, keyed by session id; memory only if storage is blocked |
| state.ts | Single state object and a tiny subscribe function; screen state names from flow-and-states.md |
| linkParser.ts | Extract session id from the path and secret from the fragment; clear the fragment |
| lifecycle.ts | Visibility, pagehide, idle timer; finish, resume and the beacon |
| api.ts | fetch wrappers for claim, photos, confirm, finish, resume; maps `{code,message}` errors to `ApiError` with a typed `code` (the body's code wins, the HTTP status is the fallback; no answer or a timeout is `NETWORK`) |
| camera.ts | getUserMedia (rear camera, `ideal`), attach to the viewfinder (muted, inline), stop tracks, capture frame; `enableCamera` moves to shooting or noCamera with a `cameraProblem` (`denied` or `unavailable`) |
| compressor.ts | Canvas resize (one draw, already scaled to 1920 px) and JPEG encode at 0.7, then 0.5 and 0.35 only if over the size limit; returns a Blob under the limit and releases the canvas |
| uploader.ts | Queue, max 5 in flight, PUT to R2, confirm, retries |
| realtime.ts | Optional WebSocket, first-message auth, close codes 4401 and 4410 |
| screens/ | One small file per screen state, plain DOM, no framework |

Dependencies point downward: screens use state and the modules; modules never import screens.
