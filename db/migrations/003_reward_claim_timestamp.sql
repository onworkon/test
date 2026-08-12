ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reward_claimed_at TIMESTAMPTZ;

UPDATE users
   SET reward_claimed_at = COALESCE(reward_claimed_at, NOW())
 WHERE reward_claimed = TRUE;

ALTER TABLE users
  ADD CONSTRAINT users_reward_claim_state_check
  CHECK (
    (reward_claimed = FALSE AND reward_claimed_at IS NULL)
    OR
    (reward_claimed = TRUE AND reward_claimed_at IS NOT NULL)
  ) NOT VALID;

ALTER TABLE users
  VALIDATE CONSTRAINT users_reward_claim_state_check;
