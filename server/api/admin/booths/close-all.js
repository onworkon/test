const { transaction } = require('../../_db');
const { requireStaff } = require('../../_auth');
const { logStaffAction } = require('../../_audit');
const { allowMethods, sendJson, handleApiError } = require('../../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['PATCH'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const closedCount = await transaction(async (client) => {
      const result = await client.query(
        `UPDATE booths
            SET status = 'closed',
                updated_at = NOW()
          WHERE status <> 'closed'
          RETURNING booth_id`
      );

      await logStaffAction(
        auth.account,
        'booth.close_all',
        {
          targetType: 'booth',
          targetId: 'all',
          metadata: { closedCount: result.rowCount }
        },
        client
      );

      return result.rowCount;
    });

    sendJson(res, 200, {
      success: true,
      closedCount
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
