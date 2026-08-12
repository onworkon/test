const { join } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { normalizeTagUid } = require('../server/api/_security');

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
const tagUid = normalizeTagUid(args['tag-uid']);
const boothId = String(args['booth-id'] || '').trim();

if (!tagUid || !boothId) {
  console.error('Usage: npm run tag:upsert -- --tag-uid <tag_uid> --booth-id <booth_id>');
  process.exit(1);
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jsfes:tag-maps'))");

    const booth = await client.query('SELECT booth_id FROM booths WHERE booth_id = $1', [boothId]);
    if (!booth.rows[0]) {
      throw new Error(`Booth was not found: ${boothId}`);
    }

    await client.query(
      'DELETE FROM tag_maps WHERE booth_id = $1 AND tag_uid <> $2',
      [boothId, tagUid]
    );

    await client.query(
      `INSERT INTO tag_maps (tag_uid, booth_id)
       VALUES ($1, $2)
       ON CONFLICT (tag_uid) DO UPDATE SET booth_id = EXCLUDED.booth_id`,
      [tagUid, boothId]
    );

    await client.query('COMMIT');
    console.log(`Tag ${tagUid} mapped to ${boothId}.`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
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
