const jwt = require('jsonwebtoken');
const { query } = require('./_db');
const { requiredSecret } = require('./_config');
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
  const revokedAtMs = new Date(revokedAt).getTime();
  return issuedAtMs < revokedAtMs;
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
    'SELECT uid, reward_claimed, token_revoked_at FROM users WHERE uid = $1',
    [claims.uid]
  );

  const user = result.rows[0];
  if (!user) {
    sendError(res, 401, 'AUTH_INVALID', 'User no longer exists');
    return null;
  }

  if (isTokenRevoked(claims, user.token_revoked_at)) {
    sendError(res, 401, 'AUTH_REVOKED', 'Token has been revoked');
    return null;
  }

  await touchLastActive(user.uid);
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

  return { claims };
}

async function touchLastActive(uid) {
  await query(
    `UPDATE users
        SET last_active = NOW()
      WHERE uid = $1`,
    [uid]
  );
}

module.exports = {
  signToken,
  verifyToken,
  requireUser,
  requireStaff,
  requirePrize,
  touchLastActive
};
