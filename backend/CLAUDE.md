# Backend rules

- NestJS on the Fastify adapter, strict TypeScript, Node 24. Plain SQL with pg. pg-boss for jobs. Plain WebSocket (ws), no Socket.IO.
- Modules follow docs/backend/modules/*.md. No module calls Jobs directly; Sessions only publishes events.
- Atomic steps (claim, slot reservation, state transitions) are each ONE conditional SQL statement.
- Errors return {code, message} through the global exception filter. Codes are in docs/backend/api-contract.md.
- Repository tests use a real Postgres (DATABASE_URL_TEST). R2 is faked in unit tests.
- Config comes from environment variables. Copy .env.example to .env locally. Never commit .env.
