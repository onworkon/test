ALTER TABLE staff_accounts
  ADD COLUMN IF NOT EXISTS manager_login_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_accounts_manager_login_key
  ON staff_accounts(manager_login_key)
  WHERE role = 'manager' AND manager_login_key IS NOT NULL;
