const { existsSync, mkdirSync, writeFileSync } = require('fs');
const { dirname, join, resolve } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { toCsv } = require('../server/api/_csv');
const { exportSpecs } = require('../server/api/_export_specs');

const root = join(__dirname, '..');
loadEnv(root);

const type = process.argv[2] || 'users';
const spec = exportSpecs[type];

if (!spec) {
  console.error(`Usage: npm run export:csv -- <${Object.keys(exportSpecs).join('|')}> [output-file]`);
  process.exit(1);
}

async function main() {
  const pool = createPool();

  try {
    const result = await pool.query(spec.sql);
    const csv = toCsv(spec.headers, result.rows);
    const outputArg = process.argv[3];

    if (!outputArg) {
      process.stdout.write(csv);
      return;
    }

    const outputPath = resolve(root, outputArg);
    const outputDir = dirname(outputPath);

    if (outputDir && !existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, csv, 'utf8');
    console.log(`Exported ${type} to ${outputPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
