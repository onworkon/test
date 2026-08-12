const { query } = require('../_db');
const { signToken } = require('../_auth');
const { allowMethods, readJson, sendJson, sendError, handleApiError } = require('../_http');
const {
  applyRateLimitBucket,
  makeRateKey,
  maybeCleanupExpiredRateLimits
} = require('../_rate_limit');
const { parseUid } = require('../_security');
const { loginUserWithProfile } = require('../_user_profile');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const body = await readJson(req);
    const uid = parseUid(body.uid);
    const limit = 10;
    const windowMs = 60000;
    const rateKey = makeRateKey(
      req,
      `auth:user-login:${uid === null ? 'invalid' : uid}`
    );
    const login = await loginUserWithProfile(
      { query },
      uid,
      { rateKey, limit, windowMs }
    );

    maybeCleanupExpiredRateLimits();
    if (!applyRateLimitBucket(res, login.bucket, limit)) return;

    if (uid === null) {
      sendError(res, 400, 'INVALID_UID', 'Invalid bracelet number');
      return;
    }

    const profile = login.profile;
    if (!profile) {
      sendError(res, 404, 'USER_NOT_FOUND', 'Bracelet number was not found');
      return;
    }

    const token = signToken({ sub: `user:${uid}`, role: 'user', uid });

    sendJson(res, 200, {
      token,
      uid,
      user: profile
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
