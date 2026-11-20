# Web: slices

One slice per fresh Claude Code session. Plan first, then edit. Update docs/PROGRESS.md at the end.

| Slice | Goal | Docs to read |
|---|---|---|
| W1 | Scaffold, build, test, size check | overview.md |
| L1 | Link secret in the fragment: backend link builder and QR, iOS deep-link parser, docs (sessions.md, mobile/decisions.md) | overview.md "Owner decisions" |
| W2 | linkParser, state, api, error mapping | modules.md, api-usage.md |
| W3 | camera, compressor | flow-and-states.md |
| W4 | uploader | flow-and-states.md, api-usage.md |
| W5 | screens and wording | flow-and-states.md, docs/mobile/ui-wording.md |
| W6 | lifecycle, beacon, realtime | flow-and-states.md |
| W7 | Nginx, headers, link files, real-device check | hosting.md, tests.md |

## W1 prompt
```
Read docs/web/overview.md only. Plan first, do not edit yet.
Then scaffold web/: Vite, strict TypeScript, Vitest, plain DOM, zero runtime dependencies.
Config from VITE_ variables listed in web/.env.example. The page shows a placeholder and builds to web/dist.
Add a build check that fails if gzip JS plus CSS exceeds 40 KB.
Do not write any feature code (camera, api, uploader) yet. Ask before adding any dependency.
Done when: npm test, npm run build and the size check pass, web/CLAUDE.md "Commands" and docs/PROGRESS.md are updated.
```
