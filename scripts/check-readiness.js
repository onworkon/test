const { existsSync } = require('fs');
const { join, relative, resolve, sep } = require('path');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { getReadiness } = require('../server/api/_readiness');

const root = join(__dirname, '..');
loadEnv(root);

function isFileInsidePublic(relativeUrl) {
  if (typeof relativeUrl !== 'string' || !relativeUrl.startsWith('/assets/')) return false;
  const publicRoot = resolve(root, 'public');
  const filePath = resolve(publicRoot, `.${relativeUrl}`);
  const rel = relative(publicRoot, filePath);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && existsSync(filePath);
}

async function addLocalAssetChecks(pool, readiness) {
  const booths = await pool.query('SELECT booth_id, stamp_icon FROM booths ORDER BY sort_order, booth_id');
  const missingStampAssets = booths.rows
    .filter((booth) => !isFileInsidePublic(booth.stamp_icon))
    .map((booth) => booth.booth_id);
  const scheduleExists = existsSync(join(root, 'public', 'assets', 'images', 'schedule.png'));

  readiness.counts.missing_stamp_assets = missingStampAssets.length;
  readiness.checks.push({
    id: 'stamp_image_files',
    label: '부스별 스탬프 이미지 파일',
    status: missingStampAssets.length === 0 ? 'pass' : 'fail',
    detail: missingStampAssets.length === 0
      ? `${booths.rows.length}/${booths.rows.length}개 존재`
      : `${missingStampAssets.length}개 누락: ${missingStampAssets.join(', ')}`
  });
  readiness.checks.push({
    id: 'schedule_image_file',
    label: '축제 일정 이미지 파일',
    status: scheduleExists ? 'pass' : 'warn',
    detail: scheduleExists ? 'configured' : '누락; 일정 준비 중 안내가 표시됨'
  });
  readiness.ok = readiness.checks.every((check) => check.status !== 'fail');
}

async function main() {
  const pool = createPool();

  try {
    const readiness = await getReadiness(pool);
    await addLocalAssetChecks(pool, readiness);
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
