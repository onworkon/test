ALTER TABLE users
  ALTER COLUMN last_active DROP NOT NULL,
  ALTER COLUMN last_active DROP DEFAULT;

UPDATE users
   SET last_active = NULL
 WHERE last_active = created_at;
