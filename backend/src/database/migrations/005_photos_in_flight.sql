-- Owner decision (slice 7b): a per-session counter of pending photos, so the 5-in-flight
-- limit is one conditional UPDATE. A count(*) in the same statement would read a stale
-- snapshot under READ COMMITTED and let two simultaneous requests both pass.
ALTER TABLE sessions
  ADD COLUMN photos_in_flight integer NOT NULL DEFAULT 0 CHECK (photos_in_flight >= 0);

UPDATE sessions s
   SET photos_in_flight = p.n
  FROM (SELECT session_id, count(*)::int AS n FROM photos WHERE status = 'pending' GROUP BY session_id) p
 WHERE p.session_id = s.id;
