DROP INDEX IF EXISTS idx_staff_accounts_manager_login_key;

ALTER TABLE staff_accounts
  DROP COLUMN IF EXISTS manager_login_key;
