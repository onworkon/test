const { query } = require('./_db');
const { allowMethods, sendJson, handleApiError, getQueryParam } = require('./_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const includeCounts = getQueryParam(req, 'include_counts') === '1';
    const result = await query(includeCounts
      ? `SELECT b.booth_id,
                b.code_number,
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
      : `SELECT booth_id,
                code_number,
                name,
                description,
                status,
                stamp_icon,
                floor_label,
                room_label,
                sort_order,
                0::int AS stamp_count
           FROM booths
          ORDER BY sort_order, booth_id`);

    sendJson(res, 200, {
      booths: result.rows
    }, includeCounts ? {} : {
      cacheControl: 'public, s-maxage=10, stale-while-revalidate=20'
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
