UPDATE booths SET
  description = COALESCE(description, ''),
  stamp_icon = COALESCE(stamp_icon, 'star'),
  floor_label = COALESCE(floor_label, ''),
  room_label = COALESCE(room_label, ''),
  sort_order = COALESCE(sort_order, 0),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW());

ALTER TABLE booths
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN stamp_icon SET NOT NULL,
  ALTER COLUMN floor_label SET NOT NULL,
  ALTER COLUMN room_label SET NOT NULL,
  ALTER COLUMN sort_order SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

UPDATE users SET
  created_at = COALESCE(created_at, NOW()),
  last_active = COALESCE(last_active, NOW()),
  reward_claimed = COALESCE(reward_claimed, FALSE),
  token_revoked_at = COALESCE(token_revoked_at, '1970-01-01 00:00:00+00');

ALTER TABLE users
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN last_active SET NOT NULL,
  ALTER COLUMN reward_claimed SET NOT NULL,
  ALTER COLUMN token_revoked_at SET NOT NULL;

UPDATE stamps SET stamped_at = COALESCE(stamped_at, NOW());
ALTER TABLE stamps ALTER COLUMN stamped_at SET NOT NULL;

UPDATE staff_accounts SET
  token_revoked_at = COALESCE(token_revoked_at, '1970-01-01 00:00:00+00'),
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW());

ALTER TABLE staff_accounts
  ALTER COLUMN token_revoked_at SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

UPDATE totp_uses SET created_at = COALESCE(created_at, NOW());
ALTER TABLE totp_uses ALTER COLUMN created_at SET NOT NULL;

UPDATE notices SET
  is_active = COALESCE(is_active, FALSE),
  created_at = COALESCE(created_at, NOW());

UPDATE notices
   SET is_active = FALSE
 WHERE is_active = TRUE
   AND id <> (SELECT MAX(id) FROM notices WHERE is_active = TRUE);

ALTER TABLE notices
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notices_single_active
  ON notices(is_active)
  WHERE is_active = TRUE;

UPDATE operation_logs SET
  metadata = COALESCE(metadata, '{}'::jsonb),
  created_at = COALESCE(created_at, NOW());

ALTER TABLE operation_logs
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE operation_logs
  ADD CONSTRAINT operation_logs_actor_role_check
  CHECK (actor_role IN ('manager', 'admin')) NOT VALID;

ALTER TABLE operation_logs
  VALIDATE CONSTRAINT operation_logs_actor_role_check;

UPDATE rate_limits SET
  count = GREATEST(COALESCE(count, 0), 0),
  updated_at = COALESCE(updated_at, NOW());

ALTER TABLE rate_limits
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE rate_limits
  ADD CONSTRAINT rate_limits_count_nonnegative_check
  CHECK (count >= 0) NOT VALID;

ALTER TABLE rate_limits
  VALIDATE CONSTRAINT rate_limits_count_nonnegative_check;
