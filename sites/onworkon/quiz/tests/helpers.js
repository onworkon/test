'use strict';
const { createServer } = require('node:http');
const { randomBytes, scryptSync } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { createHandler } = require('../server/handler');
const { getConfig } = require('../server/config');
const { createRestCommand } = require('../server/store');

const root = join(__dirname, '..', '..');
const password = 'quiz-test-password-only-2026';

function testEnv(port = 0) {
  const local = {};
  const path = join(root, '.env.quiz-test.local');
  if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^(QUIZ_TEST_[A-Z_]+)=(.*)$/.exec(line);
    if (match) local[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  const url = process.env.QUIZ_TEST_REDIS_REST_URL || local.QUIZ_TEST_REDIS_REST_URL;
  const token = process.env.QUIZ_TEST_REDIS_REST_TOKEN || local.QUIZ_TEST_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Configure a SEPARATE test Redis in .env.quiz-test.local (see quiz/README.md).');
  const salt = randomBytes(16).toString('hex');
  return { QUIZ_EVENT_ID: `test-${randomBytes(12).toString('hex')}`, QUIZ_ORIGIN: `http://127.0.0.1:${port}`,
    QUIZ_REDIS_REST_URL: url, QUIZ_REDIS_REST_TOKEN: token,
    QUIZ_ADMIN_PASSWORD_HASH: `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`,
    QUIZ_SESSION_SECRET: randomBytes(32).toString('hex') };
}

async function cleanup(env) {
  if (!/^test-[a-f0-9]{24}$/.test(env.QUIZ_EVENT_ID)) throw new Error('Refusing non-test cleanup');
  const command = createRestCommand(getConfig(env));
  let cursor = '0';
  do {
    const result = await command(['SCAN', cursor, 'MATCH', `quiz:{${env.QUIZ_EVENT_ID}}:*`, 'COUNT', 100]);
    cursor = String(result[0]);
    if (result[1].length) await command(['DEL', ...result[1]]);
  } while (cursor !== '0');
}

async function harness(t) {
  const env = testEnv();
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  env.QUIZ_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  handler = createHandler({ env });
  const config = getConfig(env);
  const command = createRestCommand(config);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await cleanup(env);
  });
  const request = async (path, { body, participant, cookie, headers = {}, method } = {}) => {
    const response = await fetch(`${env.QUIZ_ORIGIN}${path.startsWith('/') ? path : `/api/quiz/${path}`}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Origin: env.QUIZ_ORIGIN, 'Content-Type': 'application/json',
        ...(participant ? { Authorization: `Bearer ${participant}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  const login = await request('admin/login', { body: { password } });
  if (login.status !== 200) throw new Error(`Test Redis / login failed: ${login.status} ${JSON.stringify(login.data)}`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = (path, body) => request(`admin/${path}`, { body, cookie });
  return { env, config, command, request, admin, cookie, restart: () => { handler = createHandler({ env }); } };
}

module.exports = { harness, testEnv, cleanup, password, root, newParticipant: () => randomBytes(32).toString('hex') };
