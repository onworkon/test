LOCK TABLE staff_accounts IN ACCESS EXCLUSIVE MODE;
LOCK TABLE operation_logs IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM staff_accounts WHERE id < 0) THEN
    RAISE EXCEPTION 'Negative staff account IDs must be resolved before canonical ID migration';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM staff_accounts AS staff
      LEFT JOIN booths AS booth ON booth.booth_id = staff.booth_id
     WHERE staff.role = 'manager'
       AND (booth.code_number IS NULL OR booth.code_number < 1 OR booth.code_number > 99)
  ) THEN
    RAISE EXCEPTION 'Every manager account must reference a booth with a code number between 1 and 99';
  END IF;
END
$$;

ALTER TABLE operation_logs
  DROP CONSTRAINT IF EXISTS operation_logs_staff_account_id_fkey;

ALTER TABLE staff_accounts
  DROP CONSTRAINT IF EXISTS staff_accounts_booth_id_fkey,
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE SMALLINT;

ALTER TABLE operation_logs
  ALTER COLUMN staff_account_id TYPE SMALLINT;

CREATE TEMP TABLE staff_account_id_map ON COMMIT DROP AS
SELECT id AS old_id,
       -ROW_NUMBER() OVER (ORDER BY id)::smallint AS temporary_id,
       CASE
         WHEN role = 'admin' THEN 0::smallint
         ELSE booth.code_number
       END AS desired_id
  FROM staff_accounts AS staff
  LEFT JOIN booths AS booth ON booth.booth_id = staff.booth_id;

UPDATE staff_accounts AS staff
   SET id = mapping.temporary_id
  FROM staff_account_id_map AS mapping
 WHERE staff.id = mapping.old_id;

UPDATE staff_accounts AS staff
   SET id = mapping.desired_id,
       token_revoked_at = NOW(),
       updated_at = NOW()
  FROM staff_account_id_map AS mapping
 WHERE staff.id = mapping.temporary_id;

UPDATE operation_logs AS log
   SET staff_account_id = mapping.desired_id
  FROM staff_account_id_map AS mapping
 WHERE log.staff_account_id = mapping.old_id;

ALTER TABLE booths
  ADD CONSTRAINT booths_code_number_booth_id_unique
  UNIQUE (code_number, booth_id);

ALTER TABLE staff_accounts
  ADD CONSTRAINT staff_accounts_role_id_check
  CHECK (
    (role = 'admin' AND id = 0)
    OR
    (role = 'manager' AND id BETWEEN 1 AND 99)
  ),
  ADD CONSTRAINT staff_accounts_booth_code_fkey
  FOREIGN KEY (id, booth_id)
  REFERENCES booths(code_number, booth_id)
  ON UPDATE CASCADE;

ALTER TABLE operation_logs
  ADD CONSTRAINT operation_logs_staff_account_id_fkey
  FOREIGN KEY (staff_account_id)
  REFERENCES staff_accounts(id)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

DROP SEQUENCE IF EXISTS staff_accounts_id_seq;
