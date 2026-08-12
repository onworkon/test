const crypto = require('crypto');
const { query } = require('./_db');
const { sendError } = require('./_http');
const { captureException } = require('./_monitoring');

let lastCleanupAt = 0;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket && req.socket.remoteAddress
    ? req.socket.remoteAddress
    : 'unknown';
}

function makeRateKey(req, keyPrefix) {
  const ipDigest = crypto
    .createHash('sha256')
    .update(getClientIp(req))
    .digest('hex')
    .slice(0, 24);
  const scope = String(keyPrefix || 'request')
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '_')
    .slice(0, 240);
  return `${scope}:${ipDigest}`;
}

async function checkDbRateLimit(req, res, keyPrefix, limit = 10, windowMs = 60000, db = { query }) {
  const rateKey = makeRateKey(req, keyPrefix);
  const result = await db.query(
    `INSERT INTO rate_limits (rate_key, count, reset_at, updated_at)
     VALUES ($1, 1, NOW() + ($2::int * INTERVAL '1 millisecond'), NOW())
     ON CONFLICT (rate_key) DO UPDATE SET
       count = CASE
         WHEN rate_limits.reset_at <= NOW() THEN 1
         ELSE LEAST(rate_limits.count + 1, 2147483647)
       END,
       reset_at = CASE
         WHEN rate_limits.reset_at <= NOW() THEN NOW() + ($2::int * INTERVAL '1 millisecond')
         ELSE rate_limits.reset_at
       END,
       updated_at = NOW()
     RETURNING count, reset_at`,
    [rateKey, windowMs]
  );

  const bucket = result.rows[0];
  const allowed = applyRateLimitBucket(res, bucket, limit);

  if (db.query === query) maybeCleanupExpiredRateLimits();
  return allowed;
}

function applyRateLimitBucket(res, bucket, limit) {
  const count = Number(bucket.count);
  const remaining = Math.max(0, limit - count);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  if (count > limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((new Date(bucket.reset_at).getTime() - Date.now()) / 1000)
    );
    res.setHeader('Retry-After', String(retryAfter));
    sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please retry later.');
    return false;
  }

  return true;
}

async function cleanupExpiredRateLimits() {
  await query('DELETE FROM rate_limits WHERE reset_at < NOW() - INTERVAL \'10 minutes\'');
}

function maybeCleanupExpiredRateLimits() {
  const now = Date.now();
  if (now - lastCleanupAt < 10 * 60 * 1000) return;

  lastCleanupAt = now;
  cleanupExpiredRateLimits().catch((error) => {
    captureException(error, { operation: 'rate_limit_cleanup' });
    console.error(error);
  });
}

module.exports = {
  getClientIp,
  makeRateKey,
  checkDbRateLimit,
  applyRateLimitBucket,
  maybeCleanupExpiredRateLimits,
  cleanupExpiredRateLimits
};
