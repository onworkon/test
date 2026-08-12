CREATE TABLE IF NOT EXISTS booths (
  booth_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'soldout')),
  stamp_icon TEXT DEFAULT 'star',
  floor_label TEXT DEFAULT '',
  room_label TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  uid INTEGER PRIMARY KEY CHECK (uid BETWEEN 0 AND 500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  reward_claimed BOOLEAN DEFAULT FALSE,
  token_revoked_at TIMESTAMPTZ DEFAULT '1970-01-01 00:00:00+00'
);

CREATE TABLE IF NOT EXISTS stamps (
  id SERIAL PRIMARY KEY,
  uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES booths(booth_id),
  stamped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(uid, booth_id)
);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('manager', 'admin')),
  booth_id TEXT REFERENCES booths(booth_id),
  password_hash TEXT NOT NULL,
  token_revoked_at TIMESTAMPTZ DEFAULT '1970-01-01 00:00:00+00',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (role = 'admin' AND booth_id IS NULL)
    OR
    (role = 'manager' AND booth_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS tag_maps (
  tag_uid TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL REFERENCES booths(booth_id)
);

CREATE TABLE IF NOT EXISTS totp_uses (
  id SERIAL PRIMARY KEY,
  uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES booths(booth_id),
  time_step BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(uid, booth_id, time_step)
);

CREATE TABLE IF NOT EXISTS notices (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id SERIAL PRIMARY KEY,
  staff_account_id INTEGER REFERENCES staff_accounts(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  actor_booth_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stamps_uid ON stamps(uid);
CREATE INDEX IF NOT EXISTS idx_stamps_booth ON stamps(booth_id);
CREATE INDEX IF NOT EXISTS idx_users_reward ON users(reward_claimed);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(last_active);
CREATE INDEX IF NOT EXISTS idx_staff_accounts_role ON staff_accounts(role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_accounts_admin_single
  ON staff_accounts(role)
  WHERE role = 'admin';
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_accounts_manager_booth
  ON staff_accounts(booth_id)
  WHERE role = 'manager';
CREATE INDEX IF NOT EXISTS idx_operation_logs_created ON operation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operation_logs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
