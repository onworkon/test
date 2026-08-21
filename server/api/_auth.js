const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('./_db');
const { requiredSecret, getPrizePassword } = require('./_config');
const { sendError, httpError } = require('./_http');

const TOKEN_CLAIMS = {
  audience: 'jsfes-web',
  issuer: 'jsfes-nfc'
};

function signToken(payload, options = {}) {
  return jwt.sign(payload, requiredSecret('JWT_SECRET'), {
    ...TOKEN_CLAIMS,
    algorithm: 'HS256',
    expiresIn: options.expiresIn || '72h'
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;

  if (!header || typeof header !== 'string') {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function verifyToken(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw httpError(401, 'AUTH_REQUIRED', 'Authorization token is required');
  }

  return jwt.verify(token, requiredSecret('JWT_SECRET'), {
    ...TOKEN_CLAIMS,
    algorithms: ['HS256']
  });
}

function handleTokenError(res, error) {
  if (error && error.code === 'CONFIG_ERROR') {
    throw error;
  }

  if (error && error.code === 'AUTH_REQUIRED') {
    sendError(res, 401, error.code, error.message);
    return null;
  }

  sendError(res, 401, 'AUTH_INVALID', 'Invalid or expired token');
  return null;
}

function isTokenRevoked(claims, revokedAt) {
  if (!claims.iat || !revokedAt) return false;
  const issuedAtMs = claims.iat * 1000;
  const revokedAtMs = Math.floor(new Date(revokedAt).getTime() / 1000) * 1000;
  return issuedAtMs < revokedAtMs;
}

function getPrizeCredentialVersion() {
  return crypto
    .createHmac('sha256', requiredSecret('JWT_SECRET'))
    .update(`prize:${getPrizePassword()}`)
    .digest('base64url');
}

async function requireUser(req, res) {
  let claims;

  try {
    claims = verifyToken(req);
  } catch (error) {
    return handleTokenError(res, error);
  }

  if (
    claims.role !== 'user' ||
    !Number.isInteger(claims.uid) ||
    claims.sub !== `user:${claims.uid}`
  ) {
    sendError(res, 403, 'FORBIDDEN', 'User token is required');
    return null;
  }

  const result = await query(
    `UPDATE users
        SET last_active = CASE
          WHEN token_revoked_at IS NULL
            OR $2::bigint >= FLOOR(EXTRACT(EPOCH FROM token_revoked_at))::bigint
          THEN NOW()
          ELSE last_active
        END
      WHERE uid = $1
      RETURNING uid,
                reward_claimed,
                token_revoked_at,
                token_revoked_at IS NULL
                  OR $2::bigint >= FLOOR(EXTRACT(EPOCH FROM token_revoked_at))::bigint
                  AS token_valid`,
    [claims.uid, claims.iat]
  );

  const user = result.rows[0];
  if (!user) {
    sendError(res, 401, 'AUTH_INVALID', 'User no longer exists');
    return null;
  }

  if (!user.token_valid) {
    sendError(res, 401, 'AUTH_REVOKED', 'Token has been revoked');
    return null;
  }

  return { claims, user };
}

async function requireStaff(req, res, allowedRoles = ['manager', 'admin']) {
  let claims;

  try {
    claims = verifyToken(req);
  } catch (error) {
    return handleTokenError(res, error);
  }

  if (
    !allowedRoles.includes(claims.role) ||
    !Number.isInteger(claims.staff_account_id) ||
    claims.sub !== `staff:${claims.staff_account_id}`
  ) {
    sendError(res, 403, 'FORBIDDEN', 'Staff token is required');
    return null;
  }

  const result = await query(
    `SELECT id, role, booth_id, token_revoked_at
       FROM staff_accounts
      WHERE id = $1`,
    [claims.staff_account_id]
  );

  const account = result.rows[0];
  if (!account || account.role !== claims.role) {
    sendError(res, 401, 'AUTH_INVALID', 'Staff account no longer exists');
    return null;
  }

  if (account.booth_id !== (claims.booth_id || null)) {
    sendError(res, 401, 'AUTH_INVALID', 'Staff token does not match account scope');
    return null;
  }

  if (isTokenRevoked(claims, account.token_revoked_at)) {
    sendError(res, 401, 'AUTH_REVOKED', 'Token has been revoked');
    return null;
  }

  return { claims, account };
}

function requirePrize(req, res) {
  let claims;

  try {
    claims = verifyToken(req);
  } catch (error) {
    return handleTokenError(res, error);
  }

  if (claims.role !== 'prize' || claims.sub !== 'prize:operator') {
    sendError(res, 403, 'FORBIDDEN', 'Reward operator token is required');
    return null;
  }

  if (claims.credential_version !== getPrizeCredentialVersion()) {
    sendError(res, 401, 'AUTH_REVOKED', 'Prize operator token has been revoked');
    return null;
  }

  return { claims };
}

module.exports = {
  signToken,
  getPrizeCredentialVersion,
  isTokenRevoked,
  verifyToken,
  requireUser,
  requireStaff,
  requirePrize
};
