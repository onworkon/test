const bcrypt = require('bcryptjs');
const { query, transaction } = require('../_db');
const { requireStaff } = require('../_auth');
const { logStaffAction } = require('../_audit');
const { allowMethods, readJson, sendJson, sendError, handleApiError, httpError } = require('../_http');
const { checkDbRateLimit } = require('../_rate_limit');
const { isValidPassword } = require('../_security');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['PATCH'])) return;

  try {
    const auth = await requireStaff(req, res, ['manager', 'admin']);
    if (!auth) return;

    if (!(await checkDbRateLimit(req, res, `staff:password:${auth.account.id}`, 5))) return;

    const body = await readJson(req);
    const currentPassword = String(body.current_password || '');
    const newPassword = String(body.new_password || '');
    const isManager = auth.account.role === 'manager';
    const currentPasswordIsValid = isManager
      ? /^\d{4}$/.test(currentPassword)
      : Boolean(currentPassword) && Buffer.byteLength(currentPassword, 'utf8') <= 72;
    const newPasswordIsValid = isManager
      ? /^\d{4}$/.test(newPassword)
      : isValidPassword(newPassword);

    if (!currentPasswordIsValid || !newPasswordIsValid) {
      sendError(
        res,
        400,
        'INVALID_PASSWORD',
        isManager
          ? 'Current and new manager passwords must each contain exactly four digits'
          : 'Current password and a new password of at least 8 characters and at most 72 bytes are required'
      );
      return;
    }

    const result = await query(
      `SELECT id, password_hash
         FROM staff_accounts
        WHERE id = $1`,
      [auth.account.id]
    );

    const account = result.rows[0];

    if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await transaction(async (client) => {
      const update = await client.query(
        `UPDATE staff_accounts
            SET password_hash = $1,
                token_revoked_at = NOW(),
                updated_at = NOW()
          WHERE id = $2
            AND password_hash = $3
          RETURNING id`,
        [passwordHash, account.id, account.password_hash]
      );

      if (!update.rows[0]) {
        throw httpError(409, 'PASSWORD_CHANGED', 'Password changed during this request. Please sign in again.');
      }

      await logStaffAction(
        auth.account,
        'staff.password_change',
        {
          targetType: 'staff_account',
          targetId: String(account.id)
        },
        client
      );
    });

    sendJson(res, 200, {
      success: true
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
