const crypto = require('crypto');
const { query } = require('./_db');
const { sendError } = require('./_http');
const { captureException } = require('./_monitoring');

let lastCleanupAt = 0;

function getClientIp(req) {
  const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'];
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

function makeGlobalRateKey(keyPrefix) {
  const scopeDigest = crypto
    .createHash('sha256')
    .update(String(keyPrefix || 'request'))
    .digest('hex')
    .slice(0, 24);
  return `global:${scopeDigest}`;
}

async function consumeDbRateLimits(rules, db = { query }) {
  const result = await db.query(
    `WITH rules(rate_key, window_ms) AS (
       SELECT *
         FROM UNNEST($1::text[], $2::int[])
     )
     INSERT INTO rate_limits AS stored (rate_key, count, reset_at, updated_at)
     SELECT rate_key,
            1,
            NOW() + (window_ms * INTERVAL '1 millisecond'),
            NOW()
       FROM rules
     ON CONFLICT (rate_key) DO UPDATE SET
       count = CASE
         WHEN stored.reset_at <= NOW() THEN 1
         ELSE LEAST(stored.count + 1, 2147483647)
       END,
       reset_at = CASE
         WHEN stored.reset_at <= NOW() THEN EXCLUDED.reset_at
         ELSE stored.reset_at
       END,
       updated_at = NOW()
     RETURNING rate_key, count, reset_at`,
    [rules.map((rule) => rule.rateKey), rules.map((rule) => rule.windowMs)]
  );

  return new Map(result.rows.map((row) => [row.rate_key, row]));
}

async function checkDbRateLimits(res, rules, db = { query }) {
  const buckets = await consumeDbRateLimits(rules, db);
  for (const rule of rules) {
    const bucket = buckets.get(rule.rateKey);
    if (!bucket || !applyRateLimitBucket(res, bucket, rule.limit)) return false;
  }

  if (db.query === query) maybeCleanupExpiredRateLimits();
  return true;
}

async function checkDbRateLimit(req, res, keyPrefix, limit = 10, windowMs = 60000, db = { query }) {
  const rateKey = makeRateKey(req, keyPrefix);
  return checkDbRateLimits(res, [{ rateKey, limit, windowMs }], db);
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
  makeGlobalRateKey,
  checkDbRateLimit,
  checkDbRateLimits,
  consumeDbRateLimits,
  applyRateLimitBucket,
  maybeCleanupExpiredRateLimits,
  cleanupExpiredRateLimits
};
