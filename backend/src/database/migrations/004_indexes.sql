CREATE INDEX sessions_state_last_activity_idx ON sessions (state, last_activity_at);
CREATE INDEX sessions_created_at_idx ON sessions (created_at);
CREATE INDEX photos_session_status_idx ON photos (session_id, status);
CREATE INDEX photos_created_at_idx ON photos (created_at);
