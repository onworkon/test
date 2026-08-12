ALTER TABLE booths
  ADD COLUMN IF NOT EXISTS code_generation BIGINT NOT NULL DEFAULT 0;

ALTER TABLE booths
  DROP CONSTRAINT IF EXISTS booths_code_generation_nonnegative;

ALTER TABLE booths
  ADD CONSTRAINT booths_code_generation_nonnegative
  CHECK (code_generation >= 0);
