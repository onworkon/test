ALTER TABLE stamps
  DROP CONSTRAINT IF EXISTS stamps_booth_id_fkey,
  ADD CONSTRAINT stamps_booth_id_fkey
    FOREIGN KEY (booth_id) REFERENCES booths(booth_id) ON UPDATE CASCADE;

ALTER TABLE staff_accounts
  DROP CONSTRAINT IF EXISTS staff_accounts_booth_id_fkey,
  ADD CONSTRAINT staff_accounts_booth_id_fkey
    FOREIGN KEY (booth_id) REFERENCES booths(booth_id) ON UPDATE CASCADE;

ALTER TABLE tag_maps
  DROP CONSTRAINT IF EXISTS tag_maps_booth_id_fkey,
  ADD CONSTRAINT tag_maps_booth_id_fkey
    FOREIGN KEY (booth_id) REFERENCES booths(booth_id) ON UPDATE CASCADE;

ALTER TABLE totp_uses
  DROP CONSTRAINT IF EXISTS totp_uses_booth_id_fkey,
  ADD CONSTRAINT totp_uses_booth_id_fkey
    FOREIGN KEY (booth_id) REFERENCES booths(booth_id) ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM booths AS source
      JOIN booths AS target
        ON target.booth_id = 'booth-' || LPAD(source.code_number::text, 2, '0')
       AND target.code_number <> source.code_number
  ) THEN
    RAISE EXCEPTION 'Canonical booth ID is already assigned to another booth';
  END IF;
END
$$;

CREATE TEMP TABLE booth_id_renames ON COMMIT DROP AS
SELECT booth_id AS old_booth_id,
       'booth-' || LPAD(code_number::text, 2, '0') AS new_booth_id
  FROM booths
 WHERE booth_id <> 'booth-' || LPAD(code_number::text, 2, '0');

UPDATE booths AS booth
   SET booth_id = rename.new_booth_id,
       updated_at = NOW()
  FROM booth_id_renames AS rename
 WHERE booth.booth_id = rename.old_booth_id;

UPDATE operation_logs AS log
   SET actor_booth_id = rename.new_booth_id
  FROM booth_id_renames AS rename
 WHERE log.actor_booth_id = rename.old_booth_id;

UPDATE staff_accounts
   SET token_revoked_at = NOW(),
       updated_at = NOW()
 WHERE role = 'manager'
   AND booth_id IN (SELECT new_booth_id FROM booth_id_renames);
