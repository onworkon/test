'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const { randomBytes, scryptSync } = require('node:crypto');
const { createSession, isAdmin, cookie: makeCookie, sha256, verifyPassword } = require('../server/auth');
const { getConfig } = require('../server/config');
const { createHandler } = require('../server/handler');
const { harness, testEnv, newParticipant, root } = require('./helpers');
const answers = [3, 4, 2, 3, 3, 1, 4, 1];

test('70 concurrent participants, 560 answers, duplicate delivery, recovery across handler instances', { timeout: 180000 }, async (t) => {
  const f = await harness(t);
  const ids = Array.from({ length: 70 }, newParticipant);
  const enroll = await Promise.all(ids.map((participant) => f.request('session', { body: {}, participant })));
  enroll.forEach((r) => { assert.equal(r.status, 200); assert.equal(r.data.question, null); });
  assert.equal((await f.admin('stats')).data.participants, 70);
  assert.equal((await f.admin('control', { action: 'start' })).status, 200);
  const latencies = [];
  for (let q = 1; q <= 8; q++) {
    if (q === 4) f.restart();
    const results = await Promise.all(ids.flatMap((participant) => [0, 1].map(async () => {
      const begin = performance.now();
      const result = await f.request('answer', { participant, body: { questionId: q, choice: answers[q - 1] } });
      latencies.push(performance.now() - begin);
      return result;
    })));
    results.forEach((r) => { assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.submitted, q); });
  }
  const stats = (await f.admin('stats')).data;
  assert.equal(stats.participants, 70); assert.equal(stats.completed, 70); assert.equal(stats.online, 70);
  assert.deepEqual(stats.overall, { submitted: 560, correct: 560, rate: '100.0' });
  stats.questions.forEach((q) => { assert.equal(q.submitted, 70); assert.equal(q.correct, 70); });
  latencies.sort((a, b) => a - b);
  t.diagnostic(`1120 HTTP answer requests / 560 unique answers; p95=${Math.round(latencies[Math.floor(latencies.length * .95)])}ms (local Node + remote test Redis; not Vercel capacity certification)`);
});

test('no fixed 70-person capacity; waiting deduplication; start/admission race', { timeout: 120000 }, async (t) => {
  const f = await harness(t);
  const ids = Array.from({ length: 75 }, newParticipant);
  const results = await Promise.all(ids.map((participant) => f.request('session', { participant, body: {} })));
  results.forEach((r) => assert.equal(r.status, 200));
  await Promise.all(Array.from({ length: 8 }, () => f.request('session', { participant: ids[0], body: {} })));
  assert.equal((await f.admin('stats')).data.participants, 75);
  const racingId = newParticipant();
  const [entry] = await Promise.all([f.request('session', { participant: racingId, body: {} }), f.admin('control', { action: 'start' })]);
  assert.ok([200, 403].includes(entry.status));
  assert.equal((await f.admin('stats')).data.participants, entry.status === 200 ? 76 : 75);
  assert.equal((await f.request('session', { participant: newParticipant(), body: {} })).status, 403);
  assert.equal((await f.request('session', { participant: ids[0], body: {} })).status, 200);
});

test('weighted rates exclude unanswered and include incomplete participants; zero shown as null', async (t) => {
  const f = await harness(t);
  const ids = Array.from({ length: 4 }, newParticipant);
  await Promise.all(ids.map((participant) => f.request('session', { participant, body: {} })));
  let stats = (await f.admin('stats')).data;
  assert.equal(stats.overall.rate, null);
  stats.questions.forEach((q) => { assert.equal(q.rate, null); assert.equal(q.submitted, 0); });
  await f.admin('control', { action: 'start' });
  await Promise.all(ids.map((participant, i) => f.request('answer', { participant, body: { questionId: 1, choice: i < 3 ? 3 : 1 } })));
  await f.request('answer', { participant: ids[0], body: { questionId: 2, choice: 1 } });
  stats = (await f.admin('stats')).data;
  assert.deepEqual(stats.overall, { correct: 3, submitted: 5, rate: '60.0' });
  assert.equal(stats.questions[0].rate, '75.0'); assert.equal(stats.questions[1].rate, '0.0');
  assert.equal(stats.completed, 0);
  await f.request('answer', { participant: ids[1], body: { questionId: 2, choice: 4 } });
  assert.equal((await f.admin('stats')).data.overall.rate, '66.7');
});

test('ordering, waiting/ended submissions, answer immutability, malformed bodies, privacy projections', async (t) => {
  const f = await harness(t); const participant = newParticipant();
  await f.request('session', { participant, body: {} });
  assert.equal((await f.request('answer', { participant, body: { questionId: 1, choice: 3 } })).data.error.code, 'NOT_STARTED');
  await f.admin('control', { action: 'start' });
  assert.equal((await f.request('answer', { participant, body: { questionId: 2, choice: 4 } })).data.error.code, 'OUT_OF_ORDER');
  for (const body of [{ questionId: 1.5, choice: 3 }, { questionId: 1, choice: 0 }, { questionId: 9, choice: 1 }, { questionId: '1', choice: 1 }, 'null', '[1]', '{bad']) {
    assert.equal((await f.request('answer', { participant, body })).status, 400);
  }
  assert.equal((await f.request('answer', { participant, body: 'x'.repeat(5000) })).status, 413);
  const saved = await f.request('answer', { participant, body: { questionId: 1, choice: 3, correct: false } });
  assert.equal(saved.status, 200); assert.equal(saved.data.question.id, 2);
  assert.deepEqual(Object.keys(saved.data.question).sort(), ['id', 'options', 'prompt']);
  assert.doesNotMatch(JSON.stringify(saved.data), /"(?:correct|answers|rate|score|stats)"/);
  assert.equal(saved.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal((await f.request('answer', { participant, body: { questionId: 1, choice: 4 } })).data.error.code, 'ANSWER_LOCKED');
  f.restart();
  const resumed = await f.request('session', { participant, body: {} });
  assert.equal(resumed.data.submitted, 1); assert.equal(resumed.data.question.id, 2);
  await f.admin('control', { action: 'end' });
  for (const q of [1, 2]) assert.equal((await f.request('answer', { participant, body: { questionId: q, choice: 3 } })).data.error.code, 'ENDED');
  assert.equal((await f.request('session', { participant, body: {} })).data.status, 'ended');
  assert.equal((await f.admin('control', { action: 'start' })).data.error.code, 'ENDED');
  assert.equal((await f.admin('stats')).data.overall.submitted, 1);
});

test('different concurrent answers commit only once; end races serialize before any later submission', async (t) => {
  const f = await harness(t); const participant = newParticipant();
  await f.request('session', { participant, body: {} }); await f.admin('control', { action: 'start' });
  const race = await Promise.all([1, 3].map((choice) => f.request('answer', { participant, body: { questionId: 1, choice } })));
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.admin('stats')).data.overall.submitted, 1);
  const [answer] = await Promise.all([
    f.request('answer', { participant, body: { questionId: 2, choice: 4 } }), f.admin('control', { action: 'end' })
  ]);
  assert.ok([200, 409].includes(answer.status));
  const total = (await f.admin('stats')).data.overall.submitted;
  assert.equal(total, answer.status === 200 ? 2 : 1);
  assert.equal((await f.request('answer', { participant, body: { questionId: 2, choice: 4 } })).data.error.code, 'ENDED');
  assert.equal((await f.admin('stats')).data.overall.submitted, total);
});

test('four-character configured administrator passwords and password rotation', async () => {
  const hash = (password) => {
    const salt = randomBytes(16).toString('hex');
    return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
  };
  const oldConfig = { eventId: 'auth-test', adminHash: hash('previous-password'), sessionSecret: randomBytes(32).toString('hex') };
  const config = { ...oldConfig, adminHash: hash('4826') };
  assert.equal(await verifyPassword('4826', config), true);
  for (const password of ['4827', 'previous-password', '', '482', null, 4826, 'x'.repeat(257)]) {
    assert.equal(await verifyPassword(password, config), false);
  }
  const oldSession = { headers: { cookie: `quiz_admin=${createSession(oldConfig)}` } };
  assert.equal(isAdmin(oldSession, config), false);
  const newSession = { headers: { cookie: `quiz_admin=${createSession(config)}` } };
  assert.equal(isAdmin(newSession, config), true);
});

test('administrator auth, cookies, CSRF, signed session expiry/rotation, rate limits and QR', async (t) => {
  const f = await harness(t);
  for (const path of ['stats', 'qr']) assert.equal((await f.request(`admin/${path}`)).status, 401);
  assert.equal((await f.request('admin/control', { body: { action: 'start' } })).status, 401);
  assert.equal((await f.request('admin/stats', { cookie: 'quiz_admin=forged', participant: newParticipant() })).status, 401);
  assert.equal((await f.request('admin/control', { cookie: f.cookie, body: { action: 'start' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('admin/control', { cookie: f.cookie, body: { action: 'start' }, headers: { Origin: '' } })).status, 403);
  assert.equal((await f.request('admin/stats', { cookie: f.cookie, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await f.request('session', { body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('answer')).status, 405);
  assert.equal((await f.request('/api/quiz?quizPath=admin/stats')).status, 401);
  assert.equal((await f.request('/api/quiz?quizPath=admin/stats', { cookie: f.cookie })).status, 200);
  const qr = await f.admin('qr'); assert.equal(qr.status, 200); assert.match(qr.data, /<svg/);
  const logout = await f.admin('logout', {}); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  const valid = createSession(f.config, 1000);
  assert.ok(isAdmin({ headers: { cookie: `quiz_admin=${valid}` } }, f.config, 2000));
  assert.equal(isAdmin({ headers: { cookie: `quiz_admin=${valid}` } }, f.config, 28801000), false);
  assert.equal(isAdmin({ headers: { cookie: `quiz_admin=${valid}` } }, { ...f.config, sessionSecret: 'changed' }, 2000), false);
  assert.equal(isAdmin({ headers: { cookie: `quiz_admin=${valid.split('.')[0]}.${'é'.repeat(43)}` } }, f.config, 2000), false);
  assert.match(makeCookie({ ...f.config, secure: true }, valid), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  for (let i = 0; i < 9; i++) assert.equal((await f.request('admin/login', { body: { password: 'wrong-password-only' } })).status, 401);
  const limited = await f.request('admin/login', { body: { password: 'wrong-password-only' } });
  assert.equal(limited.status, 429);
});

test('presence deduplicates tabs and expires independently of submitted/participant counts', async (t) => {
  const f = await harness(t); const participant = newParticipant();
  await f.request('session', { participant, body: {} }); await f.request('session', { participant, body: {} });
  assert.equal((await f.admin('stats')).data.online, 1);
  await f.command(['ZADD', `quiz:{${f.env.QUIZ_EVENT_ID}}:presence`, Date.now() - 60000, sha256(participant)]);
  let stats = (await f.admin('stats')).data; assert.equal(stats.online, 0); assert.equal(stats.participants, 1);
  await f.request('session', { participant, body: {} });
  stats = (await f.admin('stats')).data; assert.equal(stats.online, 1); assert.equal(stats.participants, 1);
});

test('content fingerprint prevents mixed deployments from silently changing the event', async (t) => {
  const f = await harness(t); await f.request('public');
  await f.command(['HSET', `quiz:{${f.env.QUIZ_EVENT_ID}}:event`, 'fingerprint', 'different-version']);
  assert.equal((await f.request('public')).data.error.code, 'CONTENT_CHANGED');
  assert.equal((await f.admin('control', { action: 'start' })).status, 409);
});

test('configuration fails closed; server/client separation and existing route isolation', async () => {
  const env = testEnv();
  assert.throws(() => getConfig({ ...env, QUIZ_REDIS_REST_URL: 'http://insecure.example' }));
  assert.throws(() => getConfig({ ...env, QUIZ_SESSION_SECRET: 'short' }));
  assert.throws(() => getConfig({ ...env, QUIZ_EVENT_ID: 'bad{id}' }));
  const result = { statusCode: 0, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  await createHandler({ env: {} })({ url: '/api/quiz/public', headers: {}, method: 'GET' }, result);
  assert.equal(result.statusCode, 503); assert.equal(result.body.error.code, 'UNAVAILABLE');
  for (const name of readdirSync(join(root, 'quiz', 'public'))) {
    const source = readFileSync(join(root, 'quiz', 'public', name), 'utf8');
    assert.doesNotMatch(source, /QUIZ_REDIS|QUIZ_ADMIN_PASSWORD|scrypt\$|3,\s*4,\s*2,\s*3,\s*3,\s*1,\s*4,\s*1/);
    assert.doesNotMatch(source, /\/js\/common|\/css\/common|analytics\.js/);
  }
  for (const name of readdirSync(join(root, 'quiz', 'server'))) {
    assert.doesNotMatch(readFileSync(join(root, 'quiz', 'server', name), 'utf8'), /require\(['"](?:pg|.*server\/api)|process\.env\.(?:DATABASE_URL|JWT_SECRET|MASTER_SECRET)/);
  }
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'dist');
  assert.equal(vercel.buildCommand, 'npm run quiz:build');
  assert.equal(vercel.rewrites[0].source, '/api/quiz/:path*');
  assert.ok(vercel.functions['api/names.js']);
  assert.doesNotMatch(readFileSync(join(root, 'quiz/scripts/build.cjs'), 'utf8'), /migrate-postgres|DATABASE_URL/);
});
