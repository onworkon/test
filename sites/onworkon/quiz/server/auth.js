'use strict';
const { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sign = (value, config) => createHmac('sha256', config.sessionSecret)
  .update(`${config.adminHash}:${value}`).digest('base64url');

async function verifyPassword(password, config) {
  if (typeof password !== 'string' || password.length < 4 || Buffer.byteLength(password) > 256) return false;
  const [, salt, hash] = config.adminHash.split('$');
  const derived = await derive(password, salt, 32);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}

function createSession(config, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ event: config.eventId, exp: now + 8 * 60 * 60 * 1000,
    nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${body}.${sign(body, config)}`;
}

function isAdmin(req, config, now = Date.now()) {
  const token = (req.headers.cookie || '').split(';').map((v) => v.trim())
    .find((v) => v.startsWith('quiz_admin='))?.slice('quiz_admin='.length);
  if (!token || token.length > 1024) return false;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = sign(body, config);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.event === config.eventId && Number.isFinite(payload.exp) && payload.exp > now;
  } catch { return false; }
}

function cookie(config, token = '') {
  return `quiz_admin=${token}; Path=/api/quiz; HttpOnly; SameSite=Strict; Max-Age=${token ? 28800 : 0}${config.secure ? '; Secure' : ''}`;
}

function participantId(req) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  return match ? sha256(match[1]) : null;
}

module.exports = { sha256, verifyPassword, createSession, isAdmin, cookie, participantId };
