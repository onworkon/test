const { query } = require('../_db');
const { requirePrize } = require('../_auth');
const { getStampRequirement } = require('../_config');
const { allowMethods, sendJson, sendError, getQueryParam, handleApiError } = require('../_http');
const { parseUid } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = requirePrize(req, res);
    if (!auth) return;

    const uid = parseUid(getQueryParam(req, 'uid'));
    if (uid === null) {
      sendError(res, 400, 'INVALID_UID', '올바른 팔찌 번호를 입력해주세요.');
      return;
    }

    const result = await query(
      `SELECT u.uid,
              u.reward_claimed,
              u.reward_claimed_at,
              u.reward_claim_method,
              COUNT(s.id)::int AS stamp_count
         FROM users u
         LEFT JOIN stamps s ON s.uid = u.uid
        WHERE u.uid = $1
        GROUP BY u.uid`,
      [uid]
    );

    const user = result.rows[0];
    if (!user) {
      sendError(res, 404, 'USER_NOT_FOUND', '등록되지 않은 팔찌 번호입니다.');
      return;
    }

    const stampRequirement = getStampRequirement();
    sendJson(res, 200, {
      user: {
        ...user,
        stampCount: Number(user.stamp_count),
        stampRequirement,
        eligible: Number(user.stamp_count) >= stampRequirement
      }
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
