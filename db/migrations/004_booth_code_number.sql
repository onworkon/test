ALTER TABLE booths
  ADD COLUMN IF NOT EXISTS code_number SMALLINT;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM booths) > 99 THEN
    RAISE EXCEPTION 'Composite TOTP codes support at most 99 booths';
  END IF;
END
$$;

WITH ranked_booths AS (
  SELECT booth_id,
         ROW_NUMBER() OVER (ORDER BY sort_order, booth_id)::smallint AS code_number
    FROM booths
)
UPDATE booths AS booth
   SET code_number = ranked.code_number
  FROM ranked_booths AS ranked
 WHERE booth.booth_id = ranked.booth_id
   AND booth.code_number IS NULL;

ALTER TABLE booths
  ALTER COLUMN code_number SET NOT NULL;

ALTER TABLE booths
  ADD CONSTRAINT booths_code_number_range_check
  CHECK (code_number BETWEEN 1 AND 99);

ALTER TABLE booths
  ADD CONSTRAINT booths_code_number_unique
  UNIQUE (code_number);
