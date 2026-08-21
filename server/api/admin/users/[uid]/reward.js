const { transaction } = require('../../../_db');
const { requireStaff } = require('../../../_auth');
const { logStaffAction } = require('../../../_audit');
const { allowMethods, readJson, sendJson, sendError, getQueryParam, handleApiError } = require('../../../_http');
const { parseUid } = require('../../../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['PATCH'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const uid = parseUid(getQueryParam(req, 'uid'));
    const body = await readJson(req);

    if (uid === null || body.reward_claimed !== false) {
      sendError(res, 400, 'INVALID_REQUEST', 'Valid uid and reward_claimed=false are required');
      return;
    }

    const user = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE users
            SET reward_claimed = $1,
                reward_claimed_at = NULL,
                reward_claim_method = NULL
          WHERE uid = $2
          RETURNING uid, reward_claimed, reward_claimed_at, reward_claim_method`,
        [body.reward_claimed, uid]
      );

      if (!result.rows[0]) {
        return null;
      }

      await logStaffAction(
        auth.account,
        'user.reward_update',
        {
          targetType: 'user',
          targetId: String(uid),
          metadata: { reward_claimed: body.reward_claimed }
        },
        client
      );

      return result.rows[0];
    });

    if (!user) {
      sendError(res, 404, 'USER_NOT_FOUND', 'User was not found');
      return;
    }

    sendJson(res, 200, {
      success: true,
      user
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
