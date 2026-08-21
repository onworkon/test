const { query } = require('./_db');
const { allowMethods, sendJson, handleApiError } = require('./_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const result = await query(
      `SELECT
        (SELECT COUNT(*)::int FROM booths WHERE status = 'open') AS "activeBooths",
        (SELECT COUNT(*)::int FROM users WHERE last_active >= NOW() - INTERVAL '5 minutes') AS "onlineUsers"`
    );

    sendJson(res, 200, result.rows[0], {
      cacheControl: 'public, s-maxage=15, stale-while-revalidate=15'
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
