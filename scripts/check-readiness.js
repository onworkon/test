const { join } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { getReadiness } = require('../server/api/_readiness');

const root = join(__dirname, '..');
loadEnv(root);

async function main() {
  const pool = createPool();

  try {
    const readiness = await getReadiness(pool);
    console.log(JSON.stringify(readiness, null, 2));
    if (!readiness.ok) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
