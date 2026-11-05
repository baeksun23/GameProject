-- Neon SQL Editor에서 전체 내용을 실행하세요.

CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  nickname VARCHAR(16) NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_rooms (
  code VARCHAR(6) PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  host_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES players(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'connecting', 'playing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS room_signals (
  id BIGSERIAL PRIMARY KEY,
  room_code VARCHAR(6) NOT NULL REFERENCES game_rooms(code) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  signal_type VARCHAR(16) NOT NULL CHECK (signal_type IN ('offer', 'answer', 'candidate')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_rooms_expiry ON game_rooms (expires_at);
CREATE INDEX IF NOT EXISTS idx_room_signals_room_id ON room_signals (room_code, id);
