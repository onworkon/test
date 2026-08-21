const { query } = require('./_db');
const { allowMethods, sendJson, handleApiError } = require('./_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const result = await query(
      `SELECT id, message, created_at
         FROM notices
        WHERE is_active = TRUE
        ORDER BY created_at DESC
        LIMIT 1`
    );

    sendJson(res, 200, {
      notice: result.rows[0] || null
    }, {
      cacheControl: 'public, s-maxage=10, stale-while-revalidate=20'
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
