const { query } = require('./_db');
const { getAllowedOrigin, getStampRequirement } = require('./_config');

function hasStrongSecret(value) {
  return typeof value === 'string' && value.length >= 32 && !value.includes('replace-');
}

function addCheck(checks, id, label, ok, detail, warn = false) {
  checks.push({
    id,
    label,
    status: ok ? 'pass' : warn ? 'warn' : 'fail',
    detail
  });
}

async function getReadiness(db = { query }) {
  const checks = [];
  const stampRequirement = getStampRequirement();
  const allowedOrigin = getAllowedOrigin();
  const prizePassword = String(process.env.PRIZE_PASSWORD || '0000').trim() || '0000';

  addCheck(
    checks,
    'database_url',
    'DATABASE_URL',
    Boolean(process.env.DATABASE_URL),
    process.env.DATABASE_URL ? 'configured' : 'missing'
  );
  addCheck(
    checks,
    'jwt_secret',
    'JWT_SECRET',
    hasStrongSecret(process.env.JWT_SECRET),
    hasStrongSecret(process.env.JWT_SECRET) ? 'configured' : 'use at least 32 characters'
  );
  addCheck(
    checks,
    'master_secret',
    'MASTER_SECRET',
    hasStrongSecret(process.env.MASTER_SECRET),
    hasStrongSecret(process.env.MASTER_SECRET) ? 'configured' : 'use at least 32 characters'
  );
  addCheck(
    checks,
    'prize_password',
    '상품 지급 페이지 비밀번호',
    prizePassword !== '0000',
    prizePassword === '0000' ? '기본 비밀번호 0000 사용 중' : 'configured',
    true
  );
  addCheck(
    checks,
    'stamp_requirement',
    '상품 수령 스탬프 조건',
    stampRequirement > 0,
    String(stampRequirement)
  );
  addCheck(
    checks,
    'allowed_origin',
    'ALLOWED_ORIGIN',
    allowedOrigin !== '*',
    allowedOrigin !== '*'
      ? allowedOrigin
      : 'wildcard; set the production site origin when possible',
    true
  );
  addCheck(
    checks,
    'database_tls_verification',
    'Database TLS verification',
    process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false',
    process.env.PGSSL_REJECT_UNAUTHORIZED === 'false' ? 'disabled' : 'enabled',
    true
  );
  addCheck(
    checks,
    'sentry_dsn',
    'SENTRY_DSN',
    Boolean(process.env.SENTRY_DSN),
    process.env.SENTRY_DSN ? 'configured' : 'missing; runtime errors will not be reported remotely',
    true
  );

  const counts = await db.query(
    `SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM booths) AS booths,
      (SELECT COUNT(*)::int FROM tag_maps) AS tags,
      (SELECT COUNT(DISTINCT booth_id)::int FROM tag_maps) AS mapped_tag_booths,
      (SELECT COUNT(*)::int FROM staff_accounts WHERE role = 'admin') AS admins,
      (SELECT COUNT(*)::int FROM staff_accounts WHERE role = 'manager') AS managers,
      (SELECT COUNT(*)::int FROM stamps) AS stamps,
      (SELECT COUNT(board_slot)::int FROM stamps) AS slotted_stamps,
      (SELECT COUNT(*)::int FROM (
        SELECT uid
          FROM stamps
         GROUP BY uid
        HAVING COUNT(*) > 9
      ) AS overfilled) AS overfilled_users,
      (SELECT COUNT(*)::int
         FROM users AS checked_user
        WHERE checked_user.reward_claimed = TRUE
          AND (
            checked_user.reward_claim_method IS NULL
            OR checked_user.reward_claim_method NOT IN ('digital_stamps', 'offline_leaflet')
            OR (
              checked_user.reward_claim_method = 'digital_stamps'
              AND (SELECT COUNT(*) FROM stamps WHERE uid = checked_user.uid) < 9
            )
          )
      ) AS invalid_reward_claims,
      (SELECT COUNT(*)::int
         FROM users
        WHERE reward_claimed = TRUE
          AND reward_claim_method = 'offline_leaflet'
      ) AS offline_reward_claims,
      (SELECT COUNT(code_number)::int FROM booths) AS coded_booths,
      (SELECT COUNT(DISTINCT code_number)::int FROM booths) AS distinct_booth_codes,
      (SELECT COUNT(code_generation)::int FROM booths) AS generated_code_booths,
      (SELECT COUNT(*)::int FROM booths WHERE code_generation < 0) AS invalid_code_generations,
      (SELECT COUNT(*)::int
         FROM booths
        WHERE stamp_icon = '/assets/stamps/' || LPAD(code_number::text, 2, '0') || '.webp'
      ) AS configured_stamp_images,
      (SELECT COUNT(*)::int FROM tag_maps WHERE tag_uid LIKE 'replace-%') AS placeholder_tags`
  );
  const row = counts.rows[0];

  addCheck(checks, 'users_seeded', '팔찌 사용자', row.users >= 501, `${row.users}/501`);
  addCheck(checks, 'booths_seeded', '부스 데이터', row.booths > 0, `${row.booths}개`);
  addCheck(
    checks,
    'booth_code_numbers',
    '부스 2자리 코드 번호',
    row.coded_booths === row.booths && row.distinct_booth_codes === row.booths,
    `${row.distinct_booth_codes}/${row.booths}개 고유 배정`
  );
  addCheck(
    checks,
    'booth_code_generations',
    '부스 코드 재발급 상태',
    row.generated_code_booths === row.booths && row.invalid_code_generations === 0,
    `${row.generated_code_booths}/${row.booths}개 유효`
  );
  addCheck(
    checks,
    'stamp_image_paths',
    '부스별 스탬프 이미지 경로',
    row.configured_stamp_images === row.booths,
    `${row.configured_stamp_images}/${row.booths}개 연결`
  );
  addCheck(
    checks,
    'tags_registered',
    'NFC 태그',
    row.tags === row.booths &&
      row.mapped_tag_booths === row.booths &&
      row.placeholder_tags === 0,
    `태그 ${row.tags}/${row.booths}개 · 매핑 부스 ${row.mapped_tag_booths}/${row.booths}개`,
    true
  );
  addCheck(checks, 'admin_account', '관리자 계정', row.admins >= 1, `${row.admins}개`);
  addCheck(
    checks,
    'manager_accounts',
    '부장 계정',
    row.managers === row.booths,
    `${row.managers}/${row.booths}개`,
    true
  );
  addCheck(
    checks,
    'stamp_board_slots',
    '9칸 스탬프판 위치',
    row.slotted_stamps === row.stamps && row.overfilled_users === 0,
    `${row.slotted_stamps}/${row.stamps}개 배정 · 9칸 초과 사용자 ${row.overfilled_users}명`
  );
  addCheck(
    checks,
    'reward_claim_integrity',
    '상품 지급 조건 무결성',
    row.invalid_reward_claims === 0,
    `지급 근거 오류 ${row.invalid_reward_claims}명 · 오프라인 리플렛 지급 ${row.offline_reward_claims}명`
  );

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    stampRequirement,
    counts: row,
    checks
  };
}

module.exports = {
  getReadiness
};
