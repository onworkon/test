ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reward_claim_method TEXT;

UPDATE users
   SET reward_claim_method = 'digital_stamps'
 WHERE reward_claimed = TRUE
   AND reward_claim_method IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_reward_claim_method_check
  CHECK (
    (reward_claimed = FALSE AND reward_claim_method IS NULL)
    OR
    (
      reward_claimed = TRUE
      AND reward_claim_method IN ('digital_stamps', 'offline_leaflet')
    )
  ) NOT VALID;

ALTER TABLE users
  VALIDATE CONSTRAINT users_reward_claim_method_check;
