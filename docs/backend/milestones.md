# Backend: build order

1. **Foundations** (mostly done): server, DNS, certificates, R2 buckets, repository, OpenAPI pipeline.
2. **Pair and claim**: Data layer (migrations, sessions repository), Auth, EventBus, Sessions, Realtime snapshot basics. Done when create, claim, status and revoke work through the API, two simultaneous claims produce exactly one winner, and an unclaimed session expires.
3. **The photo path**: Uploads, Delivery, R2 client with CORS verified, Realtime, Jobs, Notifications last. Done when a scripted client sends a photo through R2 into delivery and the limit, idle finish, stale check, 48 hour delete and window-closing rule all pass.
