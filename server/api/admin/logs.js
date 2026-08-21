const { query } = require('../_db');
const { requireStaff } = require('../_auth');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const result = await query(
      `SELECT id,
              actor_role,
              actor_booth_id,
              action,
              target_type,
              target_id,
              metadata,
              created_at
         FROM operation_logs
        ORDER BY created_at DESC, id DESC
        LIMIT 100`
    );

    sendJson(res, 200, {
      logs: result.rows
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
