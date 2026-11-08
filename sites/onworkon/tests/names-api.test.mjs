import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNamesRequest } from '../server/names-api.mjs';

function responseRecorder() {
  return {
    status: null,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
    end(body) { this.body = body ? JSON.parse(body) : undefined; },
  };
}

const headers = { host: 'onworkon.vercel.app', origin: 'https://onworkon.vercel.app', 'content-type': 'application/json' };

test('Vercel parsed bodies await durable storage before confirming success', async () => {
  const response = responseRecorder();
  let finish;
  const pending = handleNamesRequest({ method: 'POST', headers, body: { name: '우리', submissionId: 'test-submission-id' } }, response, {
    saveName(name, id) {
      assert.equal(name, '우리');
      assert.equal(id, 'test-submission-id');
      return new Promise(resolve => { finish = resolve; });
    },
  });
  assert.equal(response.status, null);
  finish({ saved: true, created: true, id: 'test-submission-id' });
  await pending;
  assert.equal(response.status, 201);
  assert.equal(response.body.saved, true);
});

test('Vercel request validation rejects oversized or malformed parsed payloads before storage', async () => {
  for (const [body, status] of [['{bad json', 400], [{ name: 'x'.repeat(5000) }, 413]]) {
    const response = responseRecorder();
    await handleNamesRequest({ method: 'POST', headers, body }, response, {
      saveName() { assert.fail('Invalid payload reached storage'); },
    });
    assert.equal(response.status, status);
  }
});
