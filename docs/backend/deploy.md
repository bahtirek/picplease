# Backend: deploy

Owner decisions (slice 9): build on the owner's machine and copy the compiled release with rsync; the server needs no git and no repository access. `/health` reports the build (`build.commit`, `build.builtAt`). The app runs as its own no-login user. The `pgboss` schema is created once by an admin.

Files: `backend/deploy/deploy.sh` (run as `npm run deploy`), `picplease-api.service`, `picplease-migrate.service`, `sudoers-picplease`, `nginx-api.conf`.

## Layout on the server

| Path | What |
|---|---|
| `/opt/picplease/releases/<commit>_<UTC time>/` | One release: `dist/`, `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `node_modules/` (production only). Owned by `deploy`. The newest 5 are kept. |
| `/opt/picplease/current` | Symlink to the live release. |
| `/etc/picplease/api.env` | Environment for the app (secrets). `root:picplease`, mode `0640`. |
| `/etc/picplease/apns.p8`, `/etc/picplease/fcm.json` | Push credentials, when available. `root:picplease`, mode `0640`. |
| `picplease-api.service` | Runs `node dist/src/main.js` as user `picplease` on `127.0.0.1:3000`. Logs go to the journal. |
| `picplease-migrate.service` | One-shot: `node dist/scripts/migrate.js` from the current release. |

## One-time setup (as root, once)

1. Node 24 is installed; check `which node` is `/usr/bin/node` (otherwise change `ExecStart` in both units). `rsync` is installed.
2. App user and directories:
   ```
   useradd --system --no-create-home --shell /usr/sbin/nologin picplease
   mkdir -p /opt/picplease/releases && chown -R deploy:deploy /opt/picplease
   mkdir -p /etc/picplease && chown root:picplease /etc/picplease && chmod 0750 /etc/picplease
   ```
3. `/etc/picplease/api.env` (`root:picplease`, `0640`), every variable in stack.md:
   ```
   NODE_ENV=production
   PORT=3000
   DATABASE_URL=postgres://picplease_app:<password>@127.0.0.1:5432/picplease
   LINK_BASE_URL=https://picplease.app
   WEB_ORIGIN=https://picplease.app
   EVENT_BUS=postgres
   R2_ENDPOINT=https://5e30bb91025217d71df1d3412cf6e152.r2.cloudflarestorage.com
   R2_BUCKET=picplease-photos-prod
   R2_ACCESS_KEY_ID=<prod key>
   R2_SECRET_ACCESS_KEY=<prod secret>
   # APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_FILE=/etc/picplease/apns.p8 (all four or none)
   # FCM_SERVICE_ACCOUNT_FILE=/etc/picplease/fcm.json
   ```
4. pg-boss schema, owned by the app user (the app user keeps no CREATE right on the database):
   ```
   sudo -u postgres psql -d picplease -c 'CREATE SCHEMA pgboss AUTHORIZATION picplease_app'
   ```
   The scheduler checks for the schema and creates it only when missing; pg-boss itself is started with `createSchema: false`, because its `CREATE SCHEMA IF NOT EXISTS` needs CREATE on the database even when the schema exists (checked on Postgres 18).
5. Units and sudoers rule (copy the files from `backend/deploy/`):
   ```
   cp picplease-api.service picplease-migrate.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable picplease-api.service
   visudo -cf sudoers-picplease && install -m 0440 -o root -g root sudoers-picplease /etc/sudoers.d/picplease
   ```
   `deploy` may then run only `systemctl start picplease-migrate.service` and `systemctl restart picplease-api.service`.
6. Nginx: in the `api.picplease.app` 443 server block, replace the placeholder `/health` location with the two locations in `nginx-api.conf` (`/ws` with the WebSocket upgrade, and `/`). Then `nginx -t && systemctl reload nginx`. X-Forwarded-For is overwritten with the client address because the app trusts only `127.0.0.1` and rate limits by that address.

The first `npm run deploy` then installs the first release, applies all migrations and starts the API.

## Each deploy (owner's machine, from `backend/`)

```
npm run deploy
```

Needs Node 24, SSH access as `deploy` (key in the agent), and a clean, committed tree. `DEPLOY_HOST` (default `deploy@api.picplease.app`) and `HEALTH_URL` (default `https://api.picplease.app/health`) can be overridden. Steps:

1. Lint and build HEAD; `dist/build-info.json` must carry the commit.
2. rsync the release into `/opt/picplease/releases/<commit>_<time>/` (no sources, no `.env`).
3. On the server: `npm ci --omit=dev`, point `current` at the release, run the migrate unit. If migrations fail, `current` goes back to the previous release and the API is not restarted. Otherwise restart the API and prune old releases.
4. Poll `/health` until `build.commit` is the deployed commit (about 60 s at most).

Done when the live `/health` shows the new commit.

## Rollback

```
npm run deploy -- rollback              # the release before the current one
npm run deploy -- rollback <release>    # a named directory in /opt/picplease/releases
```

Points `current` at that release, restarts the API and checks `/health`. Migrations are not reversed, so every migration must stay compatible with the release before it.

## Troubleshooting

`journalctl -u picplease-api -n 50`, `journalctl -u picplease-migrate -n 50`, `systemctl status picplease-api`. The app refuses to start on bad configuration and prints which variables are wrong.
