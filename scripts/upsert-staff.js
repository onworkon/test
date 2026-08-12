const bcrypt = require('bcryptjs');
const { join } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { isValidPassword } = require('../server/api/_security');

const root = join(__dirname, '..');
loadEnv(root);

function readArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];

    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = next;
    index += 1;
  }

  return args;
}

const args = readArgs(process.argv);

if (!['admin', 'manager'].includes(args.role) || !args.password) {
  console.error('Usage: npm run staff:upsert -- --role admin --password <password>');
  console.error('Usage: npm run staff:upsert -- --role manager --booth-id <booth_id> --password <password>');
  process.exit(1);
}

if (args.role === 'manager' && !args['booth-id']) {
  console.error('--booth-id is required for manager accounts');
  process.exit(1);
}

if (args.role === 'admin' && args['booth-id']) {
  console.error('Admin accounts must not have --booth-id');
  process.exit(1);
}

if (args.role === 'manager' && !/^\d{4}$/.test(args.password)) {
  console.error('Manager passwords must contain exactly four digits');
  process.exit(1);
}

if (args.role === 'admin' && !isValidPassword(args.password)) {
  console.error('Admin passwords must contain at least 8 characters and at most 72 bytes');
  process.exit(1);
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  const passwordHash = await bcrypt.hash(args.password, 10);
  const role = args.role;
  const boothId = args['booth-id'] || null;

  try {
    await client.query('BEGIN');

    if (role === 'manager') {
      const booth = await client.query('SELECT booth_id FROM booths WHERE booth_id = $1', [boothId]);
      if (!booth.rows[0]) {
        throw new Error(`Booth was not found: ${boothId}`);
      }
    }

    const existing = role === 'admin'
      ? await client.query(
          `SELECT id FROM staff_accounts
            WHERE role = 'admin' AND booth_id IS NULL
            FOR UPDATE`
        )
      : await client.query(
          `SELECT id FROM staff_accounts
            WHERE role = 'manager' AND booth_id = $1
            FOR UPDATE`,
          [boothId]
        );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE staff_accounts
            SET password_hash = $1,
                token_revoked_at = NOW(),
                updated_at = NOW()
          WHERE id = $2`,
        [passwordHash, existing.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO staff_accounts (role, booth_id, password_hash)
         VALUES ($1, $2, $3)`,
        [role, boothId, passwordHash]
      );
    }

    await client.query('COMMIT');
    console.log(`${role} account saved${boothId ? ` for ${boothId}` : ''}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
