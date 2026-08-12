const { query } = require('../_db');
const { requireStaff } = require('../_auth');
const { getStampRequirement } = require('../_config');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const summary = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM users) AS "totalUsers",
        (SELECT COUNT(*)::int FROM users WHERE last_active >= NOW() - INTERVAL '5 minutes') AS "onlineUsers",
        (SELECT COUNT(*)::int FROM users WHERE reward_claimed = TRUE) AS "rewardClaimedCount",
        (SELECT COUNT(*)::int
           FROM (
             SELECT uid
               FROM stamps
              GROUP BY uid
             HAVING COUNT(*) >= $1
           ) eligible_users) AS "stampGoalCount"`,
      [getStampRequirement()]
    );

    sendJson(res, 200, {
      ...summary.rows[0],
      stampRequirement: getStampRequirement()
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
