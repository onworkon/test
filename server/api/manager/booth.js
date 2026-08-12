const { query } = require('../_db');
const { requireStaff } = require('../_auth');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireStaff(req, res, ['manager']);
    if (!auth) return;

    const result = await query(
      `SELECT booth_id, name, description, status, stamp_icon, floor_label, room_label, sort_order
         FROM booths
        WHERE booth_id = $1`,
      [auth.account.booth_id]
    );

    sendJson(res, 200, {
      booth: result.rows[0] || null
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
