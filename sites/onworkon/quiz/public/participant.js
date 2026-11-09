'use strict';
(() => {
  const stage = document.querySelector('#stage');
  const errorBox = document.querySelector('#error');
  const retry = document.querySelector('#retry');
  const connection = document.querySelector('#connection');
  let token, storageKey, state, viewKey, timer, busy = false, pendingAnswer = null;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function showError(message, reconnect = false) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    retry.hidden = !reconnect;
    connection.textContent = '연결 상태를 확인해 주세요.';
  }
  function clearError() { errorBox.hidden = true; retry.hidden = true; }
  async function api(path, body) {
    const response = await fetch(`/api/quiz/${path}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000)
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || '요청에 실패했습니다.'), { code: result.error?.code });
    return result;
  }
  function createToken(eventId) {
    storageKey = `quiz:participant:v1:${eventId}`;
    let saved = localStorage.getItem(storageKey);
    if (!/^[a-f0-9]{64}$/.test(saved || '')) {
      saved = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(storageKey, saved);
    }
    if (localStorage.getItem(storageKey) !== saved) throw new Error('참가 ID를 저장할 수 없습니다. 브라우저 저장 공간을 허용해 주세요.');
    return saved;
  }
  function render(next) {
    state = next;
    document.querySelector('#test-notice').hidden = !next.isTest;
    const key = `${next.eventId}:${next.status}:${next.submitted}`;
    if (key === viewKey) return;
    viewKey = key;
    pendingAnswer = null;
    stage.replaceChildren();
    stage.setAttribute('aria-busy', 'false');
    if (next.submitted === next.total) {
      stage.append(node('h1', '참여 완료'));
    } else if (next.status === 'ended') {
      stage.append(node('h1', '퀴즈 종료'));
    } else if (next.status === 'waiting') {
      stage.append(node('h1', '시작을 기다려 주세요'),
        node('p', '진행자가 시작하면 문제가 열립니다.', 'quiz-muted'));
    } else if (next.question) {
      const q = next.question;
      const progress = node('div', undefined, 'quiz-progress');
      progress.append(node('strong', `${q.id} / ${next.total}`));
      const meter = node('progress', undefined, 'quiz-meter');
      meter.max = next.total; meter.value = next.submitted; meter.setAttribute('aria-label', '저장한 문항 수');
      const heading = node('h1', q.prompt); heading.id = 'question-title';
      const form = node('form');
      const options = node('fieldset', undefined, 'quiz-options');
      options.append(node('legend', '답 하나를 선택해 주세요', 'quiz-sr-only'));
      options.setAttribute('aria-describedby', 'question-title');
      const submit = node('button', q.id === next.total ? '참여 완료' : '다음', 'quiz-button');
      submit.type = 'submit'; submit.disabled = true;
      q.options.forEach((text, index) => {
        const label = node('label', undefined, 'quiz-option');
        const input = node('input'); input.type = 'radio'; input.name = 'choice'; input.value = String(index + 1); input.required = true;
        input.addEventListener('change', () => { submit.disabled = false; });
        label.append(input, node('span', `${['①', '②', '③', '④'][index]} ${text}`));
        options.append(label);
      });
      form.append(options, submit);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const selected = form.querySelector('input:checked');
        if (!selected && !pendingAnswer) return;
        pendingAnswer ||= { questionId: q.id, choice: Number(selected.value) };
        busy = true; submit.disabled = true; options.disabled = true; submit.textContent = '저장 중…'; clearError();
        try {
          const saved = await api('answer', pendingAnswer);
          clearError(); render(saved); connection.textContent = '답안이 저장되었어요.';
        } catch (error) {
          if (['ENDED', 'ANSWER_LOCKED', 'OUT_OF_ORDER'].includes(error.code)) {
            try { render(await api('session', {})); } catch { /* Preserve the pending answer for retry. */ }
          }
          showError(error.code ? error.message : '저장 여부를 확인하지 못했습니다. 연결을 확인하고 같은 답을 다시 제출해 주세요.');
          submit.disabled = false; submit.textContent = '다시 제출';
          // Keep the same answer while its acknowledgement is uncertain.
        } finally { busy = false; schedule(); }
      });
      stage.append(progress, meter, heading, form);
    }
    const heading = stage.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(sync, state?.status === 'waiting' ? 3000 : 15000);
  }
  async function sync() {
    if (busy || document.hidden) { schedule(); return; }
    busy = true;
    try {
      if (!token) {
        const info = await api('public');
        token = navigator.locks ? await navigator.locks.request(`quiz:enroll:${info.eventId}`, () => createToken(info.eventId)) : createToken(info.eventId);
      }
      render(await api('session', {}));
      if (!pendingAnswer) clearError();
      connection.textContent = '';
    } catch (error) {
      const closed = error.code === 'ADMISSION_CLOSED';
      showError(error.code ? error.message : '연결과 브라우저 저장 공간을 확인한 뒤 다시 시도해 주세요.', !closed);
      if (closed) {
        stage.replaceChildren(node('h1', '입장 마감'));
        stage.setAttribute('aria-busy', 'false');
      }
    } finally { busy = false; schedule(); }
  }
  retry.addEventListener('click', sync);
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && /^[a-f0-9]{64}$/.test(event.newValue || '')) { token = event.newValue; sync(); }
  });
  sync();
})();
