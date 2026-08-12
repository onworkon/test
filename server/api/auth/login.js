const bcrypt = require('bcryptjs');
const { query } = require('../_db');
const { signToken } = require('../_auth');
const { allowMethods, readJson, sendJson, sendError, handleApiError } = require('../_http');
const { checkDbRateLimit } = require('../_rate_limit');
const { cleanText } = require('../_security');
const { parseManagerLoginCode } = require('../_staff_credentials');
const { getCompositeTotpInfo } = require('../_totp');

const DUMMY_PASSWORD_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5a5H2Qx6pYvBTbV8C6V8OD1a6s9rD3K';

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const body = await readJson(req);
    const role = cleanText(body.role, 20);
    const password = String(body.password || '');
    const boothId = cleanText(body.booth_id, 120);
    const managerLogin = role === 'manager' ? parseManagerLoginCode(body.code) : null;

    if (!['manager', 'admin'].includes(role)) {
      sendError(res, 400, 'INVALID_REQUEST', 'A valid role is required');
      return;
    }

    if (role === 'admin' && (!password || Buffer.byteLength(password, 'utf8') > 72)) {
      sendError(res, 400, 'INVALID_REQUEST', 'A password of at most 72 bytes is required');
      return;
    }

    if (role === 'manager' && !managerLogin) {
      sendError(res, 400, 'INVALID_REQUEST', 'A six-digit manager login code is required');
      return;
    }

    if (boothId) {
      sendError(res, 400, 'INVALID_REQUEST', 'Staff login must not include a separate booth ID');
      return;
    }

    let result;

    if (role === 'admin') {
      if (!(await checkDbRateLimit(req, res, 'auth:staff-login:admin'))) return;
      result = await query(
        `SELECT id, role, booth_id, password_hash, token_revoked_at
           FROM staff_accounts
          WHERE role = 'admin' AND booth_id IS NULL
          LIMIT 1`
      );
    } else {
      if (!(await checkDbRateLimit(req, res, 'auth:staff-login:manager', 30))) return;
      if (!(await checkDbRateLimit(req, res, `auth:staff-login:manager-booth:${managerLogin.codeNumber}`, 5))) return;
      result = await query(
        `SELECT staff.id,
                staff.role,
                staff.booth_id,
                staff.password_hash,
                staff.token_revoked_at,
                booth.code_number,
                booth.code_generation,
                booth.name AS booth_name,
                booth.description AS booth_description,
                booth.status AS booth_status,
                booth.stamp_icon AS booth_stamp_icon,
                booth.floor_label AS booth_floor_label,
                booth.room_label AS booth_room_label,
                booth.sort_order AS booth_sort_order
           FROM staff_accounts AS staff
           JOIN booths AS booth ON booth.booth_id = staff.booth_id
          WHERE staff.role = 'manager' AND booth.code_number = $1
          LIMIT 1`,
        [managerLogin.codeNumber]
      );
    }

    const account = result.rows[0];
    const passwordToVerify = role === 'manager' ? managerLogin.password : password;

    const passwordMatches = await bcrypt.compare(
      passwordToVerify,
      account ? account.password_hash : DUMMY_PASSWORD_HASH
    );

    if (!account || !passwordMatches) {
      sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid role or password');
      return;
    }

    const token = signToken({
      sub: `staff:${account.id}`,
      role: account.role,
      booth_id: account.booth_id,
      staff_account_id: account.id
    });

    const response = {
      token,
      role: account.role,
      booth_id: account.booth_id || undefined
    };

    if (account.role === 'manager') {
      response.booth = {
        booth_id: account.booth_id,
        name: account.booth_name,
        description: account.booth_description,
        status: account.booth_status,
        stamp_icon: account.booth_stamp_icon,
        floor_label: account.booth_floor_label,
        room_label: account.booth_room_label,
        sort_order: account.booth_sort_order
      };
      response.totp = getCompositeTotpInfo(
        account.booth_id,
        account.code_number,
        Date.now(),
        account.code_generation
      );
    }

    sendJson(res, 200, response);
  } catch (error) {
    handleApiError(res, error);
  }
};
