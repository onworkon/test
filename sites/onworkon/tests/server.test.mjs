import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openNamesStore } from '../server/names-store.mjs';
import { createApp } from '../server/app.mjs';

async function tempDatabase(t) {
  const root = resolve(tmpdir());
  const folder = await mkdtemp(join(root, 'onworkon-test-'));
  // Only this test's newly allocated directory may be removed.
  assert.ok(resolve(folder).startsWith(root + sep));
  t.after(async () => { await rm(folder, { recursive: true, force: true }); });
  return join(folder, 'names.sqlite');
}

test('SQLite persists names and timestamps across reopen; retries are idempotent', async t => {
  const path = await tempDatabase(t);
  const id = randomUUID();
  let store = openNamesStore(path);
  const saved = store.saveName('  우리  ', id);
  assert.equal(saved.created, true);
  assert.match(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(store.saveName('우리', id).created, false);
  store.close();
  store = openNamesStore(path);
  try {
    assert.equal(store.saveName('우리', id).created, false);
    assert.throws(() => store.saveName('Different name', id), { status: 409 });
    assert.equal(store.saveName('우리', randomUUID()).created, true);
    const sqlName = "Robert'); DROP TABLE x;--";
    store.saveName(sqlName, randomUUID());
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db.prepare('SELECT name FROM visitor_names ORDER BY rowid').all();
      assert.deepEqual(rows.map(row => row.name), ['우리', '우리', sqlName]);
    } finally { db.close(); }
  } finally { store.close(); }
});

test('API accepts valid names and does not expose name records or database files', async t => {
  const path = await tempDatabase(t);
  const store = openNamesStore(path);
  const server = createApp({ directory: fileURLToPath(new URL('../dist/', import.meta.url)), namesStore: store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const id = randomUUID();
    const post = (body, headers = {}) => fetch(base + '/api/names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...headers },
      body: JSON.stringify(body),
    });
    const result = await post({ name: 'Alex', submissionId: id });
    assert.equal(result.status, 201);
    assert.equal((await result.json()).saved, true);
    assert.equal((await post({ name: 'Alex', submissionId: id })).status, 200);
    assert.equal((await post({ name: 'Other', submissionId: id })).status, 409);
    for (const name of ['', '  ', 'a'.repeat(33), 123, null, '\u0000']) {
      assert.equal((await post({ name, submissionId: randomUUID() })).status, 400);
    }
    assert.equal((await post({ name: 'Alex', submissionId: randomUUID() }, { Origin: 'https://example.org' })).status, 403);
    assert.equal((await post({ name: 'Alex', submissionId: randomUUID() }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post({ name: 'a'.repeat(5000), submissionId: randomUUID() })).status, 413);
    assert.equal((await fetch(base + '/api/names')).status, 405);
    assert.equal((await fetch(base + '/data/visitor-names.sqlite')).status, 404);
    assert.equal((await fetch(base + '/')).status, 200);
    const script = await fetch(base + '/welcome.js');
    assert.match(script.headers.get('Content-Type'), /javascript/);
    const reader = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM visitor_names').get().count, 1); }
    finally { reader.close(); }
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
