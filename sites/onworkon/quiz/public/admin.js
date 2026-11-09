'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  let timer, refreshing = false, acting = false;
  async function api(path, body) {
    const response = await fetch(`/api/quiz/admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000)
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || '요청에 실패했습니다.'), { code: result.error?.code });
    return result;
  }
  function error(message) { $('#error').textContent = message; $('#error').hidden = false; }
  function loggedOut() {
    $('#dashboard').hidden = true; $('#login-panel').hidden = false; $('#test-notice').hidden = true;
    $('#qr').removeAttribute('src'); $('#connection').textContent = ''; clearTimeout(timer);
  }
  const rate = (row) => row.rate === null ? '—' : `${row.rate}%`;
  function render(stats) {
    $('#login-panel').hidden = true; $('#dashboard').hidden = false; $('#test-notice').hidden = !stats.isTest;
    $('#event-status').textContent = { waiting: '대기', running: '진행 중', ended: '종료' }[stats.status];
    if (!$('#qr').getAttribute('src')) $('#qr').src = '/api/quiz/admin/qr';
    $('#join-link').href = stats.joinUrl; $('#join-link').textContent = stats.joinUrl;
    for (const key of ['participants', 'online', 'completed']) $(`#${key}`).textContent = stats[key];
    $('#start').disabled = stats.status !== 'waiting' || acting;
    $('#end').disabled = stats.status === 'ended' || acting;
    $('#overall-rate').textContent = rate(stats.overall);
    $('#overall-count').textContent = `${stats.overall.correct} / ${stats.overall.submitted}`;
    const fragment = document.createDocumentFragment();
    stats.questions.forEach((q) => {
      const row = document.createElement('tr');
      [`${q.id}번`, rate(q), `${q.correct} / ${q.submitted}`].forEach((text) => {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      });
      fragment.append(row);
    });
    $('#question-stats').replaceChildren(fragment);
    $('#connection').textContent = '';
  }
  async function refresh() {
    clearTimeout(timer);
    if (refreshing || acting || document.hidden) { timer = setTimeout(refresh, 2000); return; }
    refreshing = true;
    try { render(await api('stats')); $('#error').hidden = true; }
    catch (e) {
      if (e.code === 'AUTH_REQUIRED') { loggedOut(); return; }
      error(e.message || '연결에 실패했습니다. 자동으로 다시 연결합니다.');
      $('#connection').textContent = '갱신 지연 · 표시된 수치는 마지막 수신 기준입니다.';
    } finally {
      refreshing = false;
      if (!$('#dashboard').hidden) timer = setTimeout(refresh, 2000);
    }
  }
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true; $('#error').hidden = true;
    try { await api('login', { password: $('#password').value }); $('#password').value = ''; await refresh(); }
    catch (e) { error(e.message); }
    finally { button.disabled = false; }
  });
  for (const action of ['start', 'end']) $(`#${action}`).addEventListener('click', async () => {
    if (acting) return;
    const prompt = action === 'start' ? '퀴즈를 시작할까요? 시작 후에는 새로운 참가자가 입장할 수 없습니다.' : '퀴즈를 종료할까요? 종료하면 다시 시작하거나 답안을 제출할 수 없습니다.';
    if (!window.confirm(prompt)) return;
    acting = true; $('#start').disabled = true; $('#end').disabled = true; $('#error').hidden = true;
    let actionError;
    try { await api('control', { action }); }
    catch (e) { actionError = e.message; }
    finally { acting = false; await refresh(); if (actionError) error(actionError + ' 현재 상태를 확인한 뒤 다시 시도해 주세요.'); }
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('logout', {}); loggedOut(); } catch (e) { error(e.message); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#dashboard').hidden) refresh(); });
  window.addEventListener('online', refresh);
  refresh();
})();
