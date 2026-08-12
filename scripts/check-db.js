const { join } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');

const root = join(__dirname, '..');
loadEnv(root);

async function main() {
  const pool = createPool();

  try {
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM booths) AS booths,
        (SELECT COUNT(*)::int FROM tag_maps) AS tags,
        (SELECT COUNT(DISTINCT booth_id)::int FROM tag_maps) AS "mappedTagBooths",
        (SELECT COUNT(*)::int FROM staff_accounts) AS staff`
    );

    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
