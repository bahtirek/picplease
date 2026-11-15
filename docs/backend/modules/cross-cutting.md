# Backend module: Cross-cutting

Rules for how modules depend on each other are in docs/backend/modules/README.md.

- A global exception filter returns the `{code, message}` body (`common/api-exception.filter.ts`).
- Security headers and rate limiting through the Fastify plugins.
- Logging with request ids. Never log tokens or secrets.
- CORS allows only `WEB_ORIGIN` (`https://picplease.app`), with the `Authorization` and `Content-Type` headers. The WebSocket upgrade checks the same origin for browser clients.
- Logging redacts the `Authorization` header and any field named token or secret.
- The OpenAPI file is exported to `backend/openapi.json` by an npm script. No interactive docs page is served in production.
