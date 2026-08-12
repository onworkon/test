const { transaction } = require('../_db');
const { requirePrize } = require('../_auth');
const { getStampRequirement } = require('../_config');
const { allowMethods, readJson, sendJson, sendError, handleApiError, httpError } = require('../_http');
const { checkDbRateLimit } = require('../_rate_limit');
const { resolveRewardClaimMethod } = require('../_reward');
const { parseUid } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const auth = requirePrize(req, res);
    if (!auth) return;

    if (!(await checkDbRateLimit(req, res, 'reward:claim:prize', 60))) return;

    const body = await readJson(req);
    const uid = parseUid(body.uid);
    if (uid === null) {
      sendError(res, 400, 'INVALID_UID', '올바른 팔찌 번호를 입력해주세요.');
      return;
    }

    const offlineConfirmed = body.offline_confirmed === true;
    const stampRequirement = getStampRequirement();

    const user = await transaction(async (client) => {
      const userResult = await client.query(
        `SELECT uid, reward_claimed, reward_claimed_at
           FROM users
          WHERE uid = $1
          FOR UPDATE`,
        [uid]
      );
      const currentUser = userResult.rows[0];

      if (!currentUser) {
        throw httpError(404, 'USER_NOT_FOUND', '등록되지 않은 팔찌 번호입니다.');
      }

      if (currentUser.reward_claimed) {
        throw httpError(409, 'REWARD_ALREADY_CLAIMED', '이미 상품 지급이 완료된 팔찌입니다.');
      }

      const countResult = await client.query(
        'SELECT COUNT(*)::int AS count FROM stamps WHERE uid = $1',
        [uid]
      );
      const stampCount = Number(countResult.rows[0].count);
      const claimMethod = resolveRewardClaimMethod(
        stampCount,
        stampRequirement,
        offlineConfirmed
      );

      if (!claimMethod) {
        throw httpError(
          409,
          'STAMP_REQUIREMENT_NOT_MET',
          '전자 스탬프 조건을 충족하지 못했습니다. 종이 리플렛을 확인한 경우 오프라인 적립 확인을 선택해주세요.'
        );
      }

      const updateResult = await client.query(
        `UPDATE users
            SET reward_claimed = TRUE,
                reward_claimed_at = NOW(),
                reward_claim_method = $2
          WHERE uid = $1
          RETURNING uid, reward_claimed, reward_claimed_at, reward_claim_method`,
        [uid, claimMethod]
      );

      return {
        ...updateResult.rows[0],
        stampCount,
        stampRequirement
      };
    });

    sendJson(res, 200, {
      success: true,
      user
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
