ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_uid_check;

ALTER TABLE users
  ADD CONSTRAINT users_uid_check CHECK (uid BETWEEN 0 AND 799);

INSERT INTO users (uid)
SELECT generate_series(0, 799)
ON CONFLICT (uid) DO NOTHING;
