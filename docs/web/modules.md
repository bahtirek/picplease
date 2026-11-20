# Web: modules

All under `web/src/`. One file, one job.

| File | Job |
|---|---|
| main.ts | Start-up: parse link, claim, choose first screen |
| state.ts | Single state object and a tiny subscribe function; screen state names from flow-and-states.md |
| linkParser.ts | Extract session id from the path and secret from the fragment; clear the fragment |
| lifecycle.ts | Visibility, pagehide, idle timer; finish, resume and the beacon |
| api.ts | fetch wrappers for claim, photos, confirm, finish, resume; maps `{code,message}` errors to typed errors |
| camera.ts | getUserMedia (rear camera), stop tracks, capture frame |
| compressor.ts | Canvas resize and JPEG encode; returns a Blob under 5 MB |
| uploader.ts | Queue, max 5 in flight, PUT to R2, confirm, retries |
| realtime.ts | Optional WebSocket, first-message auth, close codes 4401 and 4410 |
| screens/ | One small file per screen state, plain DOM, no framework |

Dependencies point downward: screens use state and the modules; modules never import screens.
