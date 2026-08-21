const crypto = require('crypto');
const { signToken, getPrizeCredentialVersion } = require('../_auth');
const { getPrizePassword } = require('../_config');
const { allowMethods, readJson, sendJson, sendError, handleApiError } = require('../_http');
const {
  checkDbRateLimits,
  makeGlobalRateKey,
  makeRateKey
} = require('../_rate_limit');

function safePasswordMatch(submitted, expected) {
  const submittedBuffer = Buffer.from(String(submitted), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');
  if (submittedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(submittedBuffer, expectedBuffer);
}

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    if (!(await checkDbRateLimits(res, [
      {
        rateKey: makeRateKey(req, 'auth:prize-login'),
        limit: 5,
        windowMs: 60000
      },
      {
        rateKey: makeGlobalRateKey('auth:prize-login'),
        limit: 50,
        windowMs: 5 * 60 * 1000
      }
    ]))) return;

    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!password || Buffer.byteLength(password, 'utf8') > 64) {
      sendError(res, 400, 'INVALID_REQUEST', 'Password is required');
      return;
    }

    if (!safePasswordMatch(password, getPrizePassword())) {
      sendError(res, 401, 'INVALID_CREDENTIALS', '비밀번호가 올바르지 않습니다.');
      return;
    }

    const token = signToken(
      {
        sub: 'prize:operator',
        role: 'prize',
        credential_version: getPrizeCredentialVersion()
      },
      { expiresIn: '8h' }
    );

    sendJson(res, 200, {
      token,
      role: 'prize'
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
