# Backend: session states and data model

## Session state machine

States: `pending`, `claimed`, `finished`, `revoked`, `expired`, `closed`.

| Move | Trigger | Allowed from |
|---|---|---|
| to `claimed` | helper claims | `pending` |
| to `finished` | helper finishes, grace timer ends, or idle sweep | `claimed` |
| to `closed` | delivery window closes | `finished` |
| to `revoked` | requester stops | `pending`, `claimed`, `finished` |
| to `expired` | 5 minute timer | `pending` |

`revoked`, `expired` and `closed` are terminal. All moves are conditional database updates ("only if the state is still X"), so races resolve in the database.

## Data model

**sessions**: `id` (random UUID), `state`, `secret_hash`, `helper_token_hash`, `requester_token_hash`, `created_at`, `expires_at` (created + 5 min), `claimed_at`, `finished_at`, `closed_at`, `revoked_at`, `last_activity_at`, `photos_in_flight` (migration 005), `last_push_at` (migration 006, the 60 s push cooldown).

**photos**: `id` (random UUID), `session_id` (cascade delete), `r2_key`, `status` (`pending` or `uploaded`), `content_type`, `size_bytes`, `url_expires_at`, `created_at`, `uploaded_at`, `downloaded_at`, `object_deleted_at`.

**devices**: `id`, `session_id` (cascade delete), `platform` (`ios` or `android`), `push_token`, `created_at`. Unique on session and token.

Indexes: sessions on (`state`, `last_activity_at`) and on `created_at`; photos on (`session_id`, `status`) and on `created_at`.

Migrations are ordered plain `.sql` files: `001_sessions`, `002_photos`, `003_devices`, `004_indexes`, `005_photos_in_flight`, `006_push_cooldown`.

R2 object key: built by the server only, `sessions/{sessionId}/{photoId}.jpg`. Never from client input.
