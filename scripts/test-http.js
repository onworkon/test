const assert = require('assert');
const { Readable } = require('stream');

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';

const { allowMethods, readJson, sendError, handleApiError } = require('../server/api/_http');
const { signToken } = require('../server/api/_auth');
const prizeSessionHandler = require('../server/api/auth/prize-session');

function makeReq(method, body) {
  const req = Readable.from(body === undefined ? [] : [body]);
  req.method = method;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || '';
      this.ended = true;
    }
  };
}

async function testAllowMethods() {
  const optionsRes = makeRes();
  assert.strictEqual(allowMethods(makeReq('OPTIONS'), optionsRes, ['POST']), false);
  assert.strictEqual(optionsRes.statusCode, 204);

  const badMethodRes = makeRes();
  assert.strictEqual(allowMethods(makeReq('GET'), badMethodRes, ['POST']), false);
  assert.strictEqual(badMethodRes.statusCode, 405);
  assert.match(badMethodRes.body, /METHOD_NOT_ALLOWED/);

  const okRes = makeRes();
  assert.strictEqual(allowMethods(makeReq('POST'), okRes, ['POST']), true);
  assert.match(okRes.headers['access-control-allow-methods'], /DELETE/);
}

async function testReadJson() {
  const parsed = await readJson(makeReq('POST', '{"ok":true}'));
  assert.deepStrictEqual(parsed, { ok: true });

  const empty = await readJson(makeReq('POST'));
  assert.deepStrictEqual(empty, {});

  await assert.rejects(
    () => readJson(makeReq('POST', '{bad json')),
    (error) => error.statusCode === 400 && error.code === 'INVALID_JSON'
  );

  const bufferReq = makeReq('POST');
  bufferReq.body = Buffer.from('{"from":"buffer"}');
  assert.deepStrictEqual(await readJson(bufferReq), { from: 'buffer' });

  const nullReq = makeReq('POST');
  nullReq.body = 'null';
  await assert.rejects(
    () => readJson(nullReq),
    (error) => error.statusCode === 400 && error.code === 'INVALID_BODY'
  );

  const arrayReq = makeReq('POST');
  arrayReq.body = [];
  await assert.rejects(
    () => readJson(arrayReq),
    (error) => error.statusCode === 400 && error.code === 'INVALID_BODY'
  );

  const largeReq = makeReq('POST');
  largeReq.body = Buffer.alloc(1024 * 1024 + 1);
  await assert.rejects(
    () => readJson(largeReq),
    (error) => error.statusCode === 413 && error.code === 'BODY_TOO_LARGE'
  );

  const largeObjectReq = makeReq('POST');
  largeObjectReq.body = { value: 'x'.repeat(1024 * 1024) };
  await assert.rejects(
    () => readJson(largeObjectReq),
    (error) => error.statusCode === 413 && error.code === 'BODY_TOO_LARGE'
  );
}

function testHandleApiError() {
  const res = makeRes();
  const error = new Error('Nope');
  error.statusCode = 418;
  error.code = 'TEAPOT';

  handleApiError(res, error);
  assert.strictEqual(res.statusCode, 418);
  assert.match(res.body, /TEAPOT/);
}

function testErrorShape() {
  const res = makeRes();
  sendError(res, 400, 'EXPECTED', 'Expected message', {
    code: 'OVERRIDDEN',
    message: 'Overridden message',
    detail: 'safe'
  });
  const payload = JSON.parse(res.body);
  assert.strictEqual(payload.error.code, 'EXPECTED');
  assert.strictEqual(payload.error.message, 'Expected message');
  assert.strictEqual(payload.error.detail, 'safe');
}

async function testPrizeSession() {
  const missingRes = makeRes();
  await prizeSessionHandler(makeReq('GET'), missingRes);
  assert.strictEqual(missingRes.statusCode, 401);
  assert.match(missingRes.body, /AUTH_REQUIRED/);

  const validToken = signToken(
    { sub: 'prize:operator', role: 'prize' },
    { expiresIn: '8h' }
  );
  const validReq = makeReq('GET');
  validReq.headers.authorization = `Bearer ${validToken}`;
  const validRes = makeRes();
  await prizeSessionHandler(validReq, validRes);
  assert.strictEqual(validRes.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(validRes.body), {
    authenticated: true,
    role: 'prize'
  });

  const wrongRoleToken = signToken({ sub: 'user:12', role: 'user', uid: 12 });
  const wrongRoleReq = makeReq('GET');
  wrongRoleReq.headers.authorization = `Bearer ${wrongRoleToken}`;
  const wrongRoleRes = makeRes();
  await prizeSessionHandler(wrongRoleReq, wrongRoleRes);
  assert.strictEqual(wrongRoleRes.statusCode, 403);
  assert.match(wrongRoleRes.body, /FORBIDDEN/);

  const expiredToken = signToken(
    { sub: 'prize:operator', role: 'prize' },
    { expiresIn: -1 }
  );
  const expiredReq = makeReq('GET');
  expiredReq.headers.authorization = `Bearer ${expiredToken}`;
  const expiredRes = makeRes();
  await prizeSessionHandler(expiredReq, expiredRes);
  assert.strictEqual(expiredRes.statusCode, 401);
  assert.match(expiredRes.body, /AUTH_INVALID/);
}

async function main() {
  await testAllowMethods();
  await testReadJson();
  testHandleApiError();
  testErrorShape();
  await testPrizeSession();
  console.log('HTTP helper tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
