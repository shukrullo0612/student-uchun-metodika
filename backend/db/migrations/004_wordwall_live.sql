CREATE TABLE IF NOT EXISTS wordwall_live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES wordwall_sets(id) ON DELETE CASCADE,
  room_code VARCHAR(5) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wordwall_live_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES wordwall_live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_name VARCHAR(255) NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_wordwall_live_sessions_set ON wordwall_live_sessions(set_id);
CREATE INDEX IF NOT EXISTS idx_wordwall_live_sessions_code ON wordwall_live_sessions(room_code);
CREATE INDEX IF NOT EXISTS idx_wordwall_live_sessions_status ON wordwall_live_sessions(status);
CREATE INDEX IF NOT EXISTS idx_wordwall_live_participants_session ON wordwall_live_participants(session_id);
