const { transaction } = require('../../_db');
const { requireStaff } = require('../../_auth');
const { logStaffAction } = require('../../_audit');
const { allowMethods, sendJson, sendError, getQueryParam, handleApiError } = require('../../_http');
const { normalizeTagUid } = require('../../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['DELETE'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const tagUid = normalizeTagUid(getQueryParam(req, 'tag_uid'));

    if (!tagUid) {
      sendError(res, 400, 'TAG_REQUIRED', 'Tag UID is required');
      return;
    }

    const removed = await transaction(async (client) => {
      const result = await client.query(
        'DELETE FROM tag_maps WHERE tag_uid = $1 RETURNING tag_uid, booth_id',
        [tagUid]
      );

      if (!result.rows[0]) {
        return null;
      }

      await logStaffAction(
        auth.account,
        'tag.delete',
        {
          targetType: 'tag',
          targetId: tagUid,
          metadata: { booth_id: result.rows[0].booth_id }
        },
        client
      );

      return result.rows[0];
    });

    if (!removed) {
      sendError(res, 404, 'TAG_NOT_FOUND', 'Tag mapping was not found');
      return;
    }

    sendJson(res, 200, {
      success: true,
      tag: removed
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
