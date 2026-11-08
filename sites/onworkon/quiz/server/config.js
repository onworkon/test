'use strict';
const { createHash } = require('node:crypto');
const data = require('./questions');

function getConfig(env = process.env) {
  const required = (name) => {
    if (!env[name]) throw new Error(`Missing ${name}`);
    return env[name];
  };
  const eventId = required('QUIZ_EVENT_ID');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(eventId)) throw new Error('Invalid QUIZ_EVENT_ID');
  const originUrl = new URL(required('QUIZ_ORIGIN'));
  if ((originUrl.protocol !== 'https:' && !(originUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(originUrl.hostname))) || originUrl.username || originUrl.password ||
    originUrl.pathname !== '/' || originUrl.search || originUrl.hash) throw new Error('Invalid QUIZ_ORIGIN');
  const redisUrl = new URL(required('QUIZ_REDIS_REST_URL'));
  if (redisUrl.protocol !== 'https:' || redisUrl.username || redisUrl.password || redisUrl.search ||
    redisUrl.hash || redisUrl.pathname !== '/') throw new Error('Invalid QUIZ_REDIS_REST_URL');
  const adminHash = required('QUIZ_ADMIN_PASSWORD_HASH');
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(adminHash)) throw new Error('Invalid QUIZ_ADMIN_PASSWORD_HASH');
  const sessionSecret = required('QUIZ_SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('QUIZ_SESSION_SECRET must have at least 32 characters');
  if (data.questions.length !== 8 || typeof data.isTest !== 'boolean' || data.questions.some((q, i) =>
    q.id !== i + 1 || !q.prompt || q.options.length !== 4 || q.options.some((o) => typeof o !== 'string' || !o) ||
    !Number.isInteger(q.correct) || q.correct < 1 || q.correct > 4)) throw new Error('Invalid quiz questions');
  return { eventId, origin: originUrl.origin, secure: originUrl.protocol === 'https:',
    redisUrl: redisUrl.origin, redisToken: required('QUIZ_REDIS_REST_TOKEN'), adminHash, sessionSecret,
    fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex'), total: data.questions.length };
}

module.exports = { getConfig };
