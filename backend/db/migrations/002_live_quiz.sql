CREATE TABLE IF NOT EXISTS quiz_live_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  room_code VARCHAR(5) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting',
  current_question_index INTEGER NOT NULL DEFAULT 0,
  question_time_seconds INTEGER NOT NULL DEFAULT 30,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  question_started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quiz_live_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES quiz_live_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player_name VARCHAR(255) NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS quiz_live_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES quiz_live_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES quiz_live_participants(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES quiz_options(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, question_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_live_sessions_quiz ON quiz_live_sessions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_live_sessions_code ON quiz_live_sessions(room_code);
CREATE INDEX IF NOT EXISTS idx_quiz_live_sessions_status ON quiz_live_sessions(status);
CREATE INDEX IF NOT EXISTS idx_quiz_live_participants_session ON quiz_live_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_live_answers_session ON quiz_live_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_live_answers_question ON quiz_live_answers(question_id);
