const { query, transaction } = require('../_db');
const { requireStaff } = require('../_auth');
const { logStaffAction } = require('../_audit');
const { allowMethods, readJson, sendJson, sendError, getQueryParam, handleApiError } = require('../_http');
const { cleanText } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'PATCH'])) return;

  try {
    const boothId = cleanText(getQueryParam(req, 'booth_id'), 120);

    if (!boothId) {
      sendError(res, 400, 'BOOTH_REQUIRED', 'Booth ID is required');
      return;
    }

    if (req.method === 'GET') {
      const result = await query(
        `SELECT booth_id, name, description, status, stamp_icon, floor_label, room_label, sort_order
           FROM booths
          WHERE booth_id = $1`,
        [boothId]
      );

      if (!result.rows[0]) {
        sendError(res, 404, 'BOOTH_NOT_FOUND', 'Booth was not found');
        return;
      }

      sendJson(res, 200, {
        booth: result.rows[0]
      });
      return;
    }

    const auth = await requireStaff(req, res, ['manager', 'admin']);
    if (!auth) return;

    if (auth.account.role === 'manager' && auth.account.booth_id !== boothId) {
      sendError(res, 403, 'FORBIDDEN', 'Managers can update only their own booth');
      return;
    }

    const body = await readJson(req);
    const updates = [];
    const values = [];

    if (body.status !== undefined) {
      const status = cleanText(body.status, 20);
      if (!['open', 'closed', 'soldout'].includes(status)) {
        sendError(res, 400, 'INVALID_STATUS', 'Invalid booth status');
        return;
      }
      values.push(status);
      updates.push(`status = $${values.length}`);
    }

    if (body.name !== undefined) {
      const name = cleanText(body.name, 120);
      if (!name) {
        sendError(res, 400, 'INVALID_NAME', 'Booth name is required');
        return;
      }
      values.push(name);
      updates.push(`name = $${values.length}`);
    }

    if (body.description !== undefined) {
      values.push(cleanText(body.description, 1000));
      updates.push(`description = $${values.length}`);
    }

    if (updates.length === 0) {
      sendError(res, 400, 'NO_UPDATES', 'No valid update fields were provided');
      return;
    }

    const booth = await transaction(async (client) => {
      const updateValues = [...values, boothId];
      const result = await client.query(
        `UPDATE booths
            SET ${updates.join(', ')},
                updated_at = NOW()
          WHERE booth_id = $${updateValues.length}
          RETURNING booth_id, name, description, status, stamp_icon, floor_label, room_label, sort_order`,
        updateValues
      );

      if (!result.rows[0]) {
        return null;
      }

      await logStaffAction(
        auth.account,
        'booth.update',
        {
          targetType: 'booth',
          targetId: boothId,
          metadata: {
            fields: Object.keys(body).filter((key) => ['status', 'name', 'description'].includes(key))
          }
        },
        client
      );

      return result.rows[0];
    });

    if (!booth) {
      sendError(res, 404, 'BOOTH_NOT_FOUND', 'Booth was not found');
      return;
    }

    sendJson(res, 200, {
      success: true,
      booth
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
