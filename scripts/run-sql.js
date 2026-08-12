const { existsSync, readFileSync } = require('fs');
const { isAbsolute, join, relative, resolve, sep } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');

const root = join(__dirname, '..');
loadEnv(root);

const input = process.argv[2];

if (!input) {
  console.error('Usage: npm run db:schema OR node scripts/run-sql.js <sql-file>');
  process.exit(1);
}

const sqlPath = resolve(root, input);
const sqlRelativePath = relative(root, sqlPath);

if (
  sqlRelativePath === '..' ||
  sqlRelativePath.startsWith(`..${sep}`) ||
  isAbsolute(sqlRelativePath) ||
  !existsSync(sqlPath)
) {
  console.error(`SQL file was not found inside the project: ${input}`);
  process.exit(1);
}

async function main() {
  const sql = readFileSync(sqlPath, 'utf8');
  const pool = createPool();

  try {
    await pool.query(sql);
    console.log(`Applied ${input}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
