const { transaction } = require('../_db');
const { requireStaff } = require('../_auth');
const { logStaffAction } = require('../_audit');
const { allowMethods, readJson, sendJson, sendError, handleApiError } = require('../_http');
const { cleanText } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const body = await readJson(req);
    const message = cleanText(body.message, 500);

    if (!message) {
      sendError(res, 400, 'MESSAGE_REQUIRED', 'Notice message is required');
      return;
    }

    const notice = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('jsfes:notices'))");

      if (body.replace_active !== false) {
        await client.query('UPDATE notices SET is_active = FALSE WHERE is_active = TRUE');
      }

      const result = await client.query(
        `INSERT INTO notices (message, is_active)
         VALUES ($1, TRUE)
         RETURNING id, message, is_active, created_at`,
        [message]
      );

      await logStaffAction(
        auth.account,
        'notice.create',
        {
          targetType: 'notice',
          targetId: String(result.rows[0].id),
          metadata: { replace_active: body.replace_active !== false }
        },
        client
      );

      return result.rows[0];
    });

    sendJson(res, 200, {
      success: true,
      notice
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
