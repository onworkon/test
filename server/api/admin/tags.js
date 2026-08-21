const { query, transaction } = require('../_db');
const { requireStaff } = require('../_auth');
const { logStaffAction } = require('../_audit');
const { allowMethods, readJson, sendJson, sendError, handleApiError, httpError } = require('../_http');
const { cleanText, normalizeTagUid } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    if (req.method === 'GET') {
      const result = await query(
        `SELECT t.tag_uid,
                t.booth_id,
                b.name AS booth_name,
                b.floor_label,
                b.room_label
           FROM tag_maps t
           JOIN booths b ON b.booth_id = t.booth_id
          ORDER BY b.sort_order, t.tag_uid`
      );

      sendJson(res, 200, {
        tags: result.rows
      });
      return;
    }

    const body = await readJson(req);
    const tagUid = normalizeTagUid(body.tag_uid);
    const boothId = cleanText(body.booth_id, 120);

    if (!tagUid || !boothId) {
      sendError(res, 400, 'INVALID_TAG_MAPPING', 'Tag UID and booth ID are required');
      return;
    }

    const mapping = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jsfes:tag-maps'))");

      const booth = await client.query(
        'SELECT booth_id, name FROM booths WHERE booth_id = $1',
        [boothId]
      );

      if (!booth.rows[0]) {
        throw httpError(404, 'BOOTH_NOT_FOUND', 'Booth was not found');
      }

      const replaced = await client.query(
        `DELETE FROM tag_maps
          WHERE booth_id = $1
            AND tag_uid <> $2
        RETURNING tag_uid`,
        [boothId, tagUid]
      );

      const result = await client.query(
        `INSERT INTO tag_maps (tag_uid, booth_id)
         VALUES ($1, $2)
         ON CONFLICT (tag_uid) DO UPDATE SET booth_id = EXCLUDED.booth_id
         RETURNING tag_uid, booth_id`,
        [tagUid, boothId]
      );

      await logStaffAction(
        auth.account,
        'tag.upsert',
        {
          targetType: 'tag',
          targetId: tagUid,
          metadata: {
            booth_id: boothId,
            replaced_existing_booth_tag: replaced.rowCount > 0
          }
        },
        client
      );

      return {
        ...result.rows[0],
        booth_name: booth.rows[0].name,
        replaced_existing_booth_tag: replaced.rowCount > 0
      };
    });

    sendJson(res, 200, {
      success: true,
      tag: mapping
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
