CREATE TABLE IF NOT EXISTS booths (
  booth_id TEXT PRIMARY KEY,
  code_number SMALLINT NOT NULL UNIQUE CHECK (code_number BETWEEN 1 AND 99),
  code_generation BIGINT NOT NULL DEFAULT 0
    CONSTRAINT booths_code_generation_nonnegative CHECK (code_generation >= 0),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'soldout')),
  stamp_icon TEXT NOT NULL DEFAULT 'star',
  floor_label TEXT NOT NULL DEFAULT '',
  room_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT booths_code_number_booth_id_unique UNIQUE (code_number, booth_id)
);

CREATE TABLE IF NOT EXISTS users (
  uid INTEGER PRIMARY KEY CHECK (uid BETWEEN 0 AND 799),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ,
  reward_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  reward_claimed_at TIMESTAMPTZ,
  reward_claim_method TEXT,
  token_revoked_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
  CHECK (
    (reward_claimed = FALSE AND reward_claimed_at IS NULL)
    OR
    (reward_claimed = TRUE AND reward_claimed_at IS NOT NULL)
  ),
  CHECK (
    (reward_claimed = FALSE AND reward_claim_method IS NULL)
    OR
    (
      reward_claimed = TRUE
      AND reward_claim_method IN ('digital_stamps', 'offline_leaflet')
    )
  )
);

CREATE TABLE IF NOT EXISTS stamps (
  id SERIAL PRIMARY KEY,
  uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES booths(booth_id) ON UPDATE CASCADE,
  board_slot SMALLINT NOT NULL CHECK (board_slot BETWEEN 0 AND 8),
  stamped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(uid, booth_id),
  UNIQUE(uid, board_slot)
);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id SMALLINT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('manager', 'admin')),
  booth_id TEXT,
  password_hash TEXT NOT NULL,
  token_revoked_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (role = 'admin' AND booth_id IS NULL)
    OR
    (role = 'manager' AND booth_id IS NOT NULL)
  ),
  CONSTRAINT staff_accounts_role_id_check CHECK (
    (role = 'admin' AND id = 0)
    OR
    (role = 'manager' AND id BETWEEN 1 AND 99)
  ),
  CONSTRAINT staff_accounts_booth_code_fkey
    FOREIGN KEY (id, booth_id)
    REFERENCES booths(code_number, booth_id)
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS tag_maps (
  tag_uid TEXT PRIMARY KEY,
  booth_id TEXT NOT NULL UNIQUE REFERENCES booths(booth_id) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS totp_uses (
  id SERIAL PRIMARY KEY,
  uid INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES booths(booth_id) ON UPDATE CASCADE,
  time_step BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(uid, booth_id, time_step)
);

CREATE TABLE IF NOT EXISTS notices (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operation_logs (
  id SERIAL PRIMARY KEY,
  staff_account_id SMALLINT REFERENCES staff_accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  actor_booth_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (actor_role IN ('manager', 'admin'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_notices_single_active
  ON notices(is_active)
  WHERE is_active = TRUE;
