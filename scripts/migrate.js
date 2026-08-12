const { existsSync, readdirSync, readFileSync } = require('fs');
const { createHash } = require('crypto');
const { join } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');

const root = join(__dirname, '..');
const migrationsDir = join(root, 'db', 'migrations');

loadEnv(root);

async function ensureMigrationTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
}

async function getAppliedVersions(client) {
  const result = await client.query('SELECT version, checksum FROM schema_migrations');
  return new Map(result.rows.map((row) => [row.version, row.checksum]));
}

function getMigrationFiles() {
  if (!existsSync(migrationsDir)) return [];

  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      version: name.replace(/\.sql$/, ''),
      sql: readFileSync(join(migrationsDir, name), 'utf8')
    }));
}

function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

async function applyMigration(client, migration) {
  const checksum = migrationChecksum(migration.sql);

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
      [migration.version, migration.name, checksum]
    );
    await client.query('COMMIT');
    console.log(`Applied ${migration.name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedVersions(client);
    const migrations = getMigrationFiles();

    if (migrations.length === 0) {
      console.log('No migrations found.');
      return;
    }

    let appliedCount = 0;

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        const checksum = migrationChecksum(migration.sql);
        const recordedChecksum = applied.get(migration.version);
        if (recordedChecksum && recordedChecksum !== checksum) {
          throw new Error(`Applied migration was modified: ${migration.name}`);
        }
        if (!recordedChecksum) {
          await client.query(
            'UPDATE schema_migrations SET checksum = $1 WHERE version = $2',
            [checksum, migration.version]
          );
        }
        continue;
      }
      await applyMigration(client, migration);
      appliedCount += 1;
    }

    console.log(appliedCount === 0 ? 'Database is already up to date.' : `Applied ${appliedCount} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
