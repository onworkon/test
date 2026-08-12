const { query } = require('./_db');
const { allowMethods, sendJson, handleApiError } = require('./_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const result = await query(
      `SELECT b.booth_id,
              b.name,
              b.description,
              b.status,
              b.stamp_icon,
              b.floor_label,
              b.room_label,
              b.sort_order,
              COUNT(s.id)::int AS stamp_count
         FROM booths b
         LEFT JOIN stamps s ON s.booth_id = b.booth_id
        GROUP BY b.booth_id
        ORDER BY b.sort_order, b.booth_id`
    );

    sendJson(res, 200, {
      booths: result.rows
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
