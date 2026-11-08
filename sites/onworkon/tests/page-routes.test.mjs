import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePageCode, resolveInvitationCode } from '../dist/page-routes.js';

test('all navigation codes resolve to local pages regardless of casing or surrounding spaces', () => {
  const destinations = { home: './', card: './card.html', work: './work.html', client: './workspace.html', about: './about.html', portfolio: './portfolio.html', contact: './contact.html' };
  for (const [code, destination] of Object.entries(destinations)) {
    assert.equal(resolvePageCode(code), destination);
    assert.equal(resolvePageCode(' \t' + code.toUpperCase() + '\n'), destination);
  }
});

test('navigation rejects invalid codes and arbitrary URLs', () => {
  for (const code of ['', ' ', '0000', 'cardx', ': card', 'about on', '__proto__', 'constructor', './card.html', '../card', 'https://example.com', '//example.com', 'javascript:alert(1)', null, undefined, 0, {}]) {
    assert.equal(resolvePageCode(code), null);
    assert.equal(resolveInvitationCode(code), null);
  }
});

test('the welcome invitation question retains its three invitation codes', () => {
  for (const code of ['card', 'work', 'client']) {
    assert.equal(resolveInvitationCode(' ' + code.toUpperCase() + ' '), resolvePageCode(code));
  }
  for (const code of ['home', 'about', 'portfolio', 'contact']) assert.equal(resolveInvitationCode(code), null);
});
