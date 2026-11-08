'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium, expect } = require('@playwright/test');
const { testEnv, cleanup, password, root } = require('./helpers');

async function main() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = testEnv(port);
  const artifacts = join(root, 'quiz', 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const child = spawn(process.execPath, ['quiz/scripts/dev.cjs'], {
    cwd: root, env: { ...process.env, ...env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  const errors = [];
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local server timeout')), 10000);
      child.stdout.on('data', (chunk) => { if (chunk.toString().includes('local server')) { clearTimeout(timeout); resolve(); } });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Local server exited ${code}`)); });
      child.stderr.on('data', (chunk) => errors.push(chunk.toString()));
    });
    browser = await chromium.launch({ headless: true });
    const track = (page) => {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
    };
    const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const host = await hostContext.newPage(); track(host);
    await host.goto(`${env.QUIZ_ORIGIN}/quiz/admin`);
    await expect(host.locator('#login-panel')).toBeVisible();
    await expect(host.locator('#dashboard')).toBeHidden();
    await host.locator('#password').fill(password);
    await host.locator('#login-form button').click();
    await expect(host.locator('#dashboard')).toBeVisible({ timeout: 15000 });
    await expect(host.locator('#overall-rate')).toHaveText('—');
    await expect(host.locator('#overall-count')).toHaveText('0 / 0');
    await expect(host.locator('#question-stats tr')).toHaveCount(8);
    await expect.poll(() => host.locator('#qr').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

    let context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let participant = await context.newPage(); track(participant);
    await participant.goto(`${env.QUIZ_ORIGIN}/quiz`);
    await expect(participant.locator('h1')).toHaveText('잠시만 기다려 주세요', { timeout: 15000 });
    await participant.screenshot({ path: join(artifacts, 'participant-waiting.png'), fullPage: true });
    const stored = await participant.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('quiz:participant:')));
    assert.equal(stored.length, 1);
    await participant.reload();
    await expect(participant.locator('h1')).toHaveText('잠시만 기다려 주세요');
    await expect(host.locator('#participants')).toHaveText('1');
    await host.screenshot({ path: join(artifacts, 'host-waiting.png'), fullPage: true });
    host.once('dialog', (dialog) => dialog.accept());
    await host.locator('#start').click();
    await expect(participant.locator('.quiz-progress strong')).toHaveText('1 / 8', { timeout: 15000 });
    await expect(participant.locator('input[type=radio]')).toHaveCount(4);
    await expect(participant.locator('form button')).toBeDisabled();
    await participant.locator('input[value="3"]').check();
    await participant.screenshot({ path: join(artifacts, 'participant-question.png'), fullPage: true });

    // Fail before the server stores anything. The participant must remain on Q1.
    let failBeforeStore = true;
    await participant.route('**/api/quiz/answer', async (route) => {
      if (failBeforeStore) { failBeforeStore = false; await route.abort('failed'); }
      else await route.continue();
    });
    await participant.locator('form button').click();
    await expect(participant.locator('form button')).toHaveText('다시 제출');
    await expect(participant.locator('.quiz-progress strong')).toHaveText('1 / 8');
    await expect(participant.locator('input[value="3"]')).toBeChecked();
    await participant.locator('form button').click();
    await expect(participant.locator('.quiz-progress strong')).toHaveText('2 / 8');
    await participant.unroute('**/api/quiz/answer');
    await participant.reload();
    await expect(participant.locator('.quiz-progress strong')).toHaveText('2 / 8');

    // The server commits Q2, but its response is lost. Retry must count only once.
    let loseAcknowledgement = true;
    await participant.route('**/api/quiz/answer', async (route) => {
      if (loseAcknowledgement) { loseAcknowledgement = false; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await participant.locator('input[value="4"]').check(); await participant.locator('form button').click();
    await expect(participant.locator('form button')).toHaveText('다시 제출');
    await participant.locator('form button').click();
    await expect(participant.locator('.quiz-progress strong')).toHaveText('3 / 8');
    const storageState = await context.storageState();
    await context.close();
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState });
    participant = await context.newPage(); track(participant);
    await participant.goto(`${env.QUIZ_ORIGIN}/quiz`);
    await expect(participant.locator('.quiz-progress strong')).toHaveText('3 / 8');

    // New browser identities cannot join after start.
    const lateContext = await browser.newContext();
    const late = await lateContext.newPage();
    await late.goto(`${env.QUIZ_ORIGIN}/quiz`);
    await expect(late.locator('h1')).toHaveText('지금은 입장할 수 없어요', { timeout: 15000 });
    await lateContext.close();
    for (const [id, choice] of [[3, 2], [4, 3], [5, 3], [6, 1], [7, 4], [8, 1]]) {
      await expect(participant.locator('.quiz-progress strong')).toHaveText(`${id} / 8`);
      await participant.locator(`input[value="${choice}"]`).check();
      await participant.locator('form button').click();
    }
    await expect(participant.locator('h1')).toHaveText('참여가 완료되었어요');
    assert.doesNotMatch(await participant.locator('#stage').innerText(), /정답|점수|통계|100/);
    await participant.reload(); await expect(participant.locator('h1')).toHaveText('참여가 완료되었어요');
    await participant.screenshot({ path: join(artifacts, 'participant-complete.png'), fullPage: true });
    await expect(host.locator('#completed')).toHaveText('1', { timeout: 10000 });
    await expect(host.locator('#overall-rate')).toHaveText('100.0%');
    await expect(host.locator('#overall-count')).toHaveText('8 / 8');
    await host.screenshot({ path: join(artifacts, 'host-results.png'), fullPage: true });

    // A desktop uses the same centered, single-column shell.
    await participant.setViewportSize({ width: 1440, height: 1000 });
    const box = await participant.locator('.quiz-shell').boundingBox();
    assert.equal(box.width, 520); assert.equal(box.x, 460);
    await participant.screenshot({ path: join(artifacts, 'desktop-centered.png'), fullPage: true });
    await participant.setViewportSize({ width: 320, height: 740 });
    assert.equal(await participant.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    host.once('dialog', (dialog) => dialog.accept()); await host.locator('#end').click();
    await expect(host.locator('#event-status')).toHaveText('퀴즈 종료');
    await expect(host.locator('#start')).toBeDisabled(); await expect(host.locator('#end')).toBeDisabled();
    await host.reload(); await expect(host.locator('#dashboard')).toBeVisible();
    await host.locator('#logout').click(); await expect(host.locator('#login-panel')).toBeVisible();
    assert.deepEqual(errors, []);
    console.log('PASS: mobile wait/start/8 questions/complete; refresh/reconnect; failed save + lost acknowledgement retry; late admission; private completion; QR; host live rates/auth/end; 320px + centered desktop; no JS/CSP errors.');
    console.log('Screenshots: quiz/artifacts/');
  } finally {
    if (browser) await browser.close();
    child.kill();
    await cleanup(env);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
