-- Owner decision (slice 8b): at most one "photos ready" push per session per 60 s.
-- The cooldown check and the stamp are one conditional UPDATE on this column.
ALTER TABLE sessions ADD COLUMN last_push_at timestamptz;
