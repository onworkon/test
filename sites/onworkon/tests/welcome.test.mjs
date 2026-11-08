import test from 'node:test';
import assert from 'node:assert/strict';
import { WelcomeFlow } from '../dist/welcome-flow.js';

test('the latest edited name is saved before advancing from the name step', async () => {
  const flow = new WelcomeFlow();
  assert.equal(flow.state.text, 'Hello!');
  await flow.next();
  assert.equal(flow.state.step, 'name');
  assert.equal(await flow.next(), false);
  for (const value of ['', '  ', 'a'.repeat(33), '\u0000']) {
    assert.equal(flow.completeName(value), false);
  }
  assert.equal(flow.completeName('수정 전'), true);
  assert.equal(flow.completeName('  우리  '), true);
  assert.equal(flow.state.step, 'name');
  assert.equal(flow.state.name, '우리');
  assert.equal(flow.state.nameReady, true);

  let saved;
  assert.equal(await flow.next(async name => { saved = name; }), true);
  assert.equal(saved, '우리');
  assert.equal(flow.state.text, 'Welcome to my space 우리');
  await flow.next();
  assert.equal(flow.state.text, 'Were you invited?');
  await flow.next();
  assert.equal(flow.state.text, 'Please provide the code. :');
  assert.equal(await flow.next(), false);
});

test('rapid taps cannot advance while name storage is pending', async () => {
  const flow = new WelcomeFlow();
  await flow.next();
  flow.completeName('Alex');
  let resolveSave;
  let calls = 0;
  const saving = flow.next(() => {
    calls += 1;
    return new Promise(resolve => { resolveSave = resolve; });
  });
  assert.equal(flow.state.saving, true);
  assert.equal(flow.completeName('Someone else'), false);
  assert.equal(flow.state.name, 'Alex');
  assert.equal(await flow.next(() => { calls += 1; }), false);
  assert.equal(flow.state.step, 'name');
  resolveSave();
  await saving;
  assert.equal(calls, 1);
  assert.equal(flow.state.step, 'welcome');
});

test('storage failure preserves the name and allows editing before retrying', async () => {
  const flow = new WelcomeFlow();
  await flow.next();
  flow.completeName('Alice Kim');
  await assert.rejects(flow.next(async () => { throw new Error('offline'); }), /offline/);
  assert.equal(flow.state.step, 'name');
  assert.equal(flow.state.nameReady, true);
  assert.equal(flow.state.name, 'Alice Kim');
  assert.equal(flow.state.saving, false);
  assert.equal(flow.completeName('Alice Park'), true);
  let saved;
  assert.equal(await flow.next(async name => { saved = name; }), true);
  assert.equal(saved, 'Alice Park');
  assert.equal(flow.state.step, 'welcome');
});

test('clearing an edited name cannot submit an earlier valid value', async () => {
  const flow = new WelcomeFlow();
  await flow.next();
  flow.completeName('Alex');
  assert.equal(flow.completeName('   '), false);
  assert.equal(flow.state.nameReady, false);
  assert.equal(flow.state.name, '');
  let saves = 0;
  assert.equal(await flow.next(async () => { saves += 1; }), false);
  assert.equal(saves, 0);
  assert.equal(flow.state.step, 'name');
});

for (const [code, destination] of [['card', './card.html'], ['work', './work.html'], ['client', './workspace.html']]) {
  test('invitation code ' + code + ' opens only its own destination after the code question', async () => {
    const flow = new WelcomeFlow();
    assert.equal(flow.submitCode(code), false);
    assert.equal(flow.state.destination, null);
    await flow.next();
    flow.completeName('Alice');
    let saves = 0;
    await flow.next(async () => { saves += 1; });
    assert.equal(flow.submitCode(code), false);
    await flow.next();
    await flow.next();

    for (const invalid of ['', ' ', '0000', '1234', 'car', 'clientx', 'card/work/client', '__proto__', 'constructor', './card.html', 'https://example.com', 0, null]) {
      assert.equal(flow.submitCode(invalid), false);
      assert.equal(flow.state.step, 'code');
      assert.equal(flow.state.destination, null);
      assert.equal(flow.state.name, 'Alice');
    }
    assert.equal(await flow.next(), false);
    assert.equal(flow.submitCode(code), true);
    assert.equal(flow.state.step, 'workspace');
    assert.equal(flow.state.destination, destination);
    assert.equal(flow.submitCode('card'), false);
    assert.equal(flow.submitCode('work'), false);
    assert.equal(flow.state.destination, destination);
    assert.equal(await flow.next(), false);
    assert.equal(saves, 1);
  });
}

test('invitation codes ignore casing and surrounding whitespace', async () => {
  for (const [value, destination] of [[' CARD ', './card.html'], ['Work', './work.html'], ['\tCLIENT\n', './workspace.html']]) {
    const flow = new WelcomeFlow();
    await flow.next();
    flow.completeName('Alice');
    await flow.next(async () => {});
    await flow.next();
    await flow.next();
    assert.equal(flow.submitCode(value), true);
    assert.equal(flow.state.destination, destination);
  }
});
