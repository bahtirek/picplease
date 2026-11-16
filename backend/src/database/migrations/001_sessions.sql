CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'claimed', 'finished', 'revoked', 'expired', 'closed')),
  secret_hash text NOT NULL,
  helper_token_hash text,
  requester_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  finished_at timestamptz,
  closed_at timestamptz,
  revoked_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
