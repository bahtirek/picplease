# web/ (helper page)

Read docs/web/overview.md first; other docs/web files only when the slice needs them.

## Rules
- Vite, strict TypeScript, Vitest (happy-dom for screen tests, via `// @vitest-environment happy-dom`), ESLint, Prettier, plain DOM, no runtime dependencies. Ask before adding any dependency.
- Camera stream only: no file inputs, no gallery.
- Token in sessionStorage only. Never log tokens or secrets. Remove the secret from the address bar after reading.
- Only wording from docs/mobile/ui-wording.md, kept in src/screens/text.ts.
- Gzip JS plus CSS stays under 40 KB.
- Never push. Commit at the end of every slice (owner decision 2026-11-19).

## Commands
Run from web/ with Node 24 (`.nvmrc`; npm refuses other versions).
- `npm install` — install dependencies
- `cp .env.example .env.local` — dev config (API on localhost:3000); production values are in the committed `.env.production`
- `npm run dev` — Vite dev server
- `npm run build` — type-check, build to web/dist, then the size check (fails over 40 KB gzip JS plus CSS) and the dist check
- `npm run check:size` — size check alone on web/dist
- `npm run check:dist` — dist fits the CSP (no inline scripts or styles, no other origins) and has valid app link files
- `npm run deploy` — owner only: test, build HEAD, upload to the VPS, switch, check /version.json; `npm run deploy -- rollback` (docs/web/deploy.md)
- `npm test` — all Vitest tests; `npm test -- <path>` for one file
- `npm run lint` / `npm run format` / `npm run format:check`
