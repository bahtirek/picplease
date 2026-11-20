# Web: deploy and real-device check

Files: `web/deploy/deploy.sh` (run as `npm run deploy` from `web/`), `nginx-web.conf`, `nginx-web-headers.conf`. Same approach as the backend (docs/backend/deploy.md): build on the owner's machine, rsync a release, switch a symlink. The page is static, so nothing restarts.

## Layout on the server (same VPS as the API)

| Path | What |
|---|---|
| `/var/www/picplease.app/releases/<commit>_<UTC time>/` | One build (`index.html`, `assets/`, `.well-known/`, `version.json`). Owned by `deploy`, world-readable. The newest 5 are kept. |
| `/var/www/picplease.app/current` | Symlink to the live release; the Nginx `root`. |
| `/etc/nginx/snippets/picplease-web-headers.conf` | Security headers, included in every location. |

## One-time setup (as root, once)

1. Web root:
   ```
   mkdir -p /var/www/picplease.app/releases && chown -R deploy:deploy /var/www/picplease.app
   ```
2. Headers snippet: copy `web/deploy/nginx-web-headers.conf` to `/etc/nginx/snippets/picplease-web-headers.conf`.
3. In the `picplease.app` 443 server block (keep the Certbot certificate lines), replace the placeholder content with `web/deploy/nginx-web.conf`. The port 80 block keeps Certbot's redirect and ACME challenge. Then `nginx -t && systemctl reload nginx`.
4. R2 CORS on `picplease-photos-prod` (owner, done 2026-11-19): `AllowedOrigins` `https://picplease.app`, `AllowedMethods` `PUT`, `AllowedHeaders` `content-type`, `MaxAgeSeconds` 3600. Uploads send only `content-type`, the one header the API signs. To try the page on a computer against the dev bucket, add `http://localhost:5173` to the dev bucket's rule only (and set the local API's `WEB_ORIGIN` to it).

The first `npm run deploy` then installs the first release.

## Each deploy (owner's machine, from `web/`)

```
npm run deploy
```

Needs Node 24, SSH access as `deploy`, a clean committed tree, and no `.env.local` or `.env.production.local` (they would override the production values in `.env.production`). Steps: lint, test, build (with the size and dist checks), write `dist/version.json` with the commit, rsync the release, switch `current`, prune, then poll `https://picplease.app/version.json` until it shows the commit. `DEPLOY_HOST` (default `deploy@api.picplease.app`) and `VERSION_URL` can be overridden.

Rollback: `npm run deploy -- rollback` (the release before the current one) or `npm run deploy -- rollback <release>`.

`index.html` is served with `no-cache` and the hashed assets for a year, so a deploy reaches new visitors at once and a page already open keeps working.

## What is served

| Path | Answer |
|---|---|
| `/s/<anything>` | `index.html`, `no-cache` |
| `/assets/*` | Vite's hashed bundles, cached a year, immutable |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | `application/json`, cached an hour, no redirect |
| `/version.json` | the live commit, `no-store` |
| anything else, including `/` | 404 (there is no landing page yet) |

Every answer carries the headers from hosting.md: HSTS, CSP (`default-src 'none'`; scripts, styles and images from the page itself; `connect-src` only the API, its WebSocket and the R2 endpoint; no framing), `Permissions-Policy: camera=(self)` (microphone, location and payment off), `Referrer-Policy: no-referrer`, `nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`.

Checked in W7 (2026-11-19) with the config in an `nginx:stable` container: `nginx -t` passes, every row above answers as listed, and a build loaded in headless Chrome runs under the CSP and renders its screens (a claim to an address outside `connect-src` is blocked).

## App link files

- `apple-app-site-association`: `/s/*` opens `44NBW3DS2Q.app.picplease`. iOS only uses it once the app has the Associated Domains entitlement `applinks:picplease.app` (helper app, milestone 6). Apple fetches it through its CDN: `https://app-site-association.cdn-apple.com/a/v1/picplease.app` shows what Apple sees.
- `assetlinks.json`: `[]` until the Android signing fingerprints exist (docs/open-items.md). With an empty list, Android opens links in the browser, which shows this page.

## Real-device check (owner, after the first deploy)

On an iPhone (Safari) and an Android phone (Chrome), with a traveler session from the iOS app on another phone:

1. Scan the QR with the phone's camera. The page opens, and the address bar no longer shows the part after `#`.
2. "Allow camera": the system prompt shows, and the rear camera opens.
3. Shoot 6 photos quickly: the 6th tap shows "All 5 sending, one second…", and the shutter comes back by itself. All 6 arrive in the traveler's camera roll, upright, with no location in their details.
4. Switch to another app for under 30 s and come back: still shooting, and the camera works again.
5. Switch away for over 30 s: on return the page shows the wrap-up and thanks. The traveler's app shows the summary.
6. New session. Close the tab while shooting: within about 30 s the traveler's session finishes (summary on the traveler's phone). If it only finishes after about 2 minutes, the keepalive finish did not arrive (most likely its CORS preflight). Note the browser and version: the fallback is a text/plain body, which needs a backend change.
7. Lock the screen while photos are sending, then unlock: the page carries on or wraps up as in steps 4 and 5.
8. The traveler taps Stop: the page shows "Session ended. Thanks for your help!".
9. Airplane mode while shooting: the banner shows and the shutter is blocked. Back online: the shutter works.
10. Deny the camera, or block it in site settings: the no-camera screen shows the denied text.
11. Reload during shooting: the page comes back to "Allow camera" without a new claim.
12. Scan an old or used code: "This code was already used" or "This code isn't valid anymore".
13. Tap Finish with photos still sending: "Sending photo, please keep this open.", then "Thanks for helping!".

Record the results (device, OS and browser versions) in docs/PROGRESS.md.
