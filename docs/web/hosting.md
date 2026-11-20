# Web: hosting rules

- Build output (`web/dist`) copied to the VPS web root for picplease.app; Nginx serves it with TLS (Let's Encrypt). .app domains are HTTPS-only.
- `location /s/ { try_files /index.html =404; }` so shared links open the page.
- `/.well-known/` files served with `Content-Type: application/json`, no redirects.
- Hashed asset filenames get long cache lifetimes; `index.html` is `no-cache`.
- Headers: `Permissions-Policy: camera=(self)`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and a CSP allowing connect-src to https://api.picplease.app, wss://api.picplease.app and the R2 endpoint.
- Never log request paths with fragments (fragments are not sent anyway); do not add analytics.
- R2 CORS: allow PUT (and the signed headers) from `https://picplease.app`.
