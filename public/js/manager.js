(function () {
  const app = document.getElementById('managerApp');
  const stateLabel = document.getElementById('managerState');
  const logoutButton = document.getElementById('managerLogout');
  let loginMessageClearTimer = null;
  let loginMessageSequence = 0;

  const state = {
    token: JSFes.getToken(JSFes.storageKeys.staffToken),
    role: JSFes.getToken(JSFes.storageKeys.staffRole),
    boothId: JSFes.getToken(JSFes.storageKeys.staffBoothId),
    booth: null,
    totp: null,
    ticker: null,
    totpRefreshing: false,
    pendingStatus: null
  };

  const managerStatusOrder = ['open', 'soldout', 'closed'];

  function managerStatusLabel(status) {
    return {
      open: '운영중',
      soldout: '임시 중단',
      closed: '운영 종료'
    }[status] || '운영 종료';
  }

  function totpEntryCode() {
    const source = state.totp?.entryCode || state.totp?.displayCode || state.totp?.code || '';
    return String(source).replace(/\D/g, '');
  }

  function setMessage(message, type) {
    const target = document.getElementById('managerMessage');
    if (!target) return;

    if (!target.classList.contains('staff-login-toast')) {
      const dashboardClass = target.classList.contains('manager-dashboard-message')
        ? ' manager-dashboard-message'
        : '';
      const srOnlyClass = target.classList.contains('sr-only') ? ' sr-only' : '';
      target.textContent = message || '';
      target.className = `message${dashboardClass}${srOnlyClass} ${type || ''}`.trim();
      return;
    }

    const text = message || '';
    const sequence = ++loginMessageSequence;
    window.clearTimeout(loginMessageClearTimer);
    target.className = `message page-toast staff-login-toast ${type || ''}`.trim();
    target.textContent = text;
    if (!text) return;

    void target.offsetWidth;
    target.classList.add('is-visible');
    loginMessageClearTimer = window.setTimeout(() => {
      if (sequence !== loginMessageSequence || !target.isConnected) return;
      target.textContent = '';
      target.classList.remove('is-visible', 'error', 'success');
    }, 2400);
  }

  function managerLoginErrorMessage(error) {
    if (error?.code === 'INVALID_CREDENTIALS') {
      return '부스 번호 또는 비밀번호가 올바르지 않습니다.';
    }
    if (error?.code === 'INVALID_REQUEST') {
      return '부스 번호 2자리와 비밀번호 4자리를 확인해주세요.';
    }
    if (error?.code === 'RATE_LIMITED') {
      return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    }
    return error?.message || '로그인에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }

  function updateStateLabel() {
    const loggedIn = Boolean(state.token && state.role === 'manager');
    stateLabel.textContent = loggedIn ? `담당 부스 ${state.boothId || ''}` : '로그인 전';
    logoutButton.hidden = !loggedIn;
  }

  function renderLogin() {
    stopTicker();
    document.body.classList.add('staff-login-mode');
    document.body.classList.remove('manager-dashboard-mode');
    updateStateLabel();

    app.innerHTML = `
      <div class="staff-password-screen">
        <section class="staff-login-card manager-login-card" aria-labelledby="managerLoginTitle">
          <img class="staff-login-symbol" src="/assets/icons/managerpw.svg" alt="" aria-hidden="true">
          <div class="staff-login-heading">
            <h1 id="managerLoginTitle">부·차장 페이지</h1>
            <p>발급받은 비밀번호를 입력해주세요.</p>
          </div>
          <form id="managerLoginForm" class="staff-password-form">
            <label class="sr-only" for="managerLoginCode">부스 번호를 포함한 6자리 로그인 코드</label>
            <input id="managerLoginCode" name="code" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required autocomplete="current-password">
            <button type="submit">로그인</button>
          </form>
        </section>
        ${staffFooterHtml()}
        <p id="managerMessage" class="message page-toast staff-login-toast" role="status" aria-live="polite" aria-atomic="true"></p>
      </div>
    `;

    document.getElementById('managerLoginForm').addEventListener('submit', handleLogin);
  }

  function staffFooterHtml() {
    return `
      <footer class="staff-footer">
        <span>2026 ⓒ 잠신고등학교 학생회 | </span>
        <a href="https://www.instagram.com/jamsin_student/" target="_blank" rel="noopener noreferrer">문의하기</a>
      </footer>
    `;
  }

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('로그인 중입니다.');

    const data = new FormData(event.currentTarget);

    try {
      const result = await JSFes.apiFetch('/api/auth/login', {
        method: 'POST',
        body: {
          role: 'manager',
          code: data.get('code')
        }
      });

      state.token = result.token;
      state.role = result.role;
      state.boothId = result.booth_id;
      state.booth = result.booth || null;
      state.totp = result.totp || null;
      JSFes.setToken(JSFes.storageKeys.staffToken, result.token);
      JSFes.setToken(JSFes.storageKeys.staffRole, result.role);
      JSFes.setToken(JSFes.storageKeys.staffBoothId, result.booth_id);

      await renderDashboard();
    } catch (error) {
      setMessage(managerLoginErrorMessage(error), 'error');
    }
  }

  async function loadManagerData() {
    const [booth, totp] = await Promise.all([
      JSFes.apiFetch('/api/manager/booth', { token: state.token }),
      JSFes.apiFetch('/api/manager/totp', { token: state.token })
    ]);

    state.booth = booth.booth;
    state.totp = totp.totp;
  }

  async function renderDashboard() {
    if (!state.token || state.role !== 'manager') {
      renderLogin();
      return;
    }

    try {
      if (!state.booth || !state.totp) await loadManagerData();
      document.body.classList.remove('staff-login-mode');
      document.body.classList.add('manager-dashboard-mode');
      updateStateLabel();
      state.pendingStatus = state.booth.status;
      app.innerHTML = `
        <div class="manager-dashboard">
          <header class="manager-dashboard-brand">
            <h1>2026 잠신제</h1>
          </header>
          <nav class="manager-dashboard-tools" aria-label="부장 계정 메뉴">
            <button id="managerDashboardLogout" type="button">로그아웃</button>
          </nav>
          <p class="manager-login-status">
            <span>'${JSFes.escapeHtml(state.booth.name)}'관리자로</span>
            <span>로그인 상태입니다.</span>
          </p>

          <section class="manager-code-card" aria-labelledby="managerCodeHeading">
            <h2 id="managerCodeHeading">현재 적립 코드</h2>
            <output id="totpCode" aria-live="polite">${JSFes.escapeHtml(totpEntryCode())}</output>
            <p id="totpCountdown"></p>
            <button id="refreshTotp" type="button" class="manager-code-refresh" aria-label="현재 적립 코드 갱신">
              <img src="/assets/icons/re.svg" alt="" aria-hidden="true">
            </button>
          </section>

          <div class="manager-dashboard-divider" aria-hidden="true"></div>
          <h2 class="manager-edit-heading">부스 정보·현황 수정</h2>

          <form id="boothForm" class="manager-booth-form">
            <h3 class="manager-booth-name" title="${JSFes.escapeHtml(state.booth.name)}">${JSFes.escapeHtml(state.booth.name)}</h3>
            <p class="manager-booth-location">(${JSFes.escapeHtml(state.booth.room_label || state.booth.booth_id)})</p>

            <input id="managerStatusValue" name="status" type="hidden" value="${JSFes.escapeHtml(state.pendingStatus)}">
            <button
              id="managerStatusToggle"
              type="button"
              class="manager-status-toggle"
              data-status="${JSFes.escapeHtml(state.pendingStatus)}"
              aria-label="운영 상태 변경. 현재 ${managerStatusLabel(state.pendingStatus)}"
            >${managerStatusLabel(state.pendingStatus)}</button>

            <div class="manager-description-field">
              <label class="sr-only" for="managerBoothDescription">부스 안내 문구</label>
              <textarea id="managerBoothDescription" name="description" maxlength="100" readonly aria-readonly="true">${JSFes.escapeHtml(state.booth.description || '')}</textarea>
            </div>
            <button id="managerDescriptionEdit" type="button" class="manager-description-edit" aria-label="부스 안내 문구 수정">
              <img src="/assets/icons/edit.svg" alt="" aria-hidden="true">
            </button>
            <button id="managerSaveButton" type="submit" class="manager-save-button" disabled>
              <span class="manager-save-button-bg" aria-hidden="true"></span>
              <span class="manager-save-button-label">수정사항 반영</span>
            </button>
          </form>

          <p id="managerMessage" class="message manager-dashboard-message sr-only" role="status" aria-live="polite"></p>
        </div>
      `;

      document.getElementById('boothForm').addEventListener('submit', handleBoothSave);
      document.getElementById('managerStatusToggle').addEventListener('click', toggleManagerStatus);
      document.getElementById('managerDescriptionEdit').addEventListener('click', enableDescriptionEditing);
      document.getElementById('managerBoothDescription').addEventListener('input', updateSaveButtonState);
      document.getElementById('refreshTotp').addEventListener('click', reissueTotp);
      document.getElementById('managerDashboardLogout').addEventListener('click', logoutManager);
      startTicker();
    } catch (error) {
      if (JSFes.isAuthError(error)) {
        clearSession();
        await renderLogin();
        setMessage(error.message, 'error');
        return;
      }

      updateStateLabel();
      document.body.classList.remove('manager-dashboard-mode');
      app.innerHTML = `
        <section class="panel stack">
          <h1 class="page-title">연결 오류</h1>
          <p id="managerMessage" class="message error">${JSFes.escapeHtml(error.message)}</p>
          <button id="managerRetry" type="button">다시 시도</button>
        </section>
      `;
      document.getElementById('managerRetry').addEventListener('click', renderDashboard);
    }
  }

  async function handleBoothSave(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    await updateBooth({
      description: data.get('description'),
      status: data.get('status')
    });
  }

  function toggleManagerStatus() {
    const currentIndex = managerStatusOrder.indexOf(state.pendingStatus);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % managerStatusOrder.length : 0;
    state.pendingStatus = managerStatusOrder[nextIndex];

    const toggle = document.getElementById('managerStatusToggle');
    const input = document.getElementById('managerStatusValue');
    const label = managerStatusLabel(state.pendingStatus);
    toggle.dataset.status = state.pendingStatus;
    toggle.textContent = label;
    toggle.setAttribute('aria-label', `운영 상태 변경. 현재 ${label}`);
    input.value = state.pendingStatus;
    updateSaveButtonState();
  }

  function updateSaveButtonState() {
    const saveButton = document.getElementById('managerSaveButton');
    const statusInput = document.getElementById('managerStatusValue');
    const textarea = document.getElementById('managerBoothDescription');
    if (!saveButton || !statusInput || !textarea || !state.booth) return;

    const statusChanged = statusInput.value !== state.booth.status;
    const descriptionChanged = textarea.value !== String(state.booth.description || '');
    saveButton.disabled = !(statusChanged || descriptionChanged);
  }

  function enableDescriptionEditing() {
    const textarea = document.getElementById('managerBoothDescription');
    textarea.readOnly = false;
    textarea.setAttribute('aria-readonly', 'false');
    textarea.classList.add('is-editing');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  async function updateBooth(payload) {
    try {
      const result = await JSFes.apiFetch(`/api/booths/${encodeURIComponent(state.booth.booth_id)}`, {
        method: 'PATCH',
        token: state.token,
        body: payload
      });

      state.booth = result.booth;
      await renderDashboard();
      setMessage('수정사항이 반영되었습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function refreshTotp() {
    if (state.totpRefreshing) return;
    state.totpRefreshing = true;
    setTotpButtonBusy(true);
    stopTicker();
    try {
      const result = await JSFes.apiFetch('/api/manager/totp', { token: state.token });
      applyTotpResult(result);
      setMessage('적립 코드가 갱신되었습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
      if (state.token) {
        window.setTimeout(() => {
          if (state.token) void refreshTotp();
        }, 5000);
      }
    } finally {
      state.totpRefreshing = false;
      setTotpButtonBusy(false);
    }
  }

  async function reissueTotp() {
    if (state.totpRefreshing) return;
    state.totpRefreshing = true;
    setTotpButtonBusy(true);
    stopTicker();

    try {
      const result = await JSFes.apiFetch('/api/manager/totp', {
        method: 'POST',
        token: state.token
      });
      applyTotpResult(result);
      setMessage('적립 코드가 재발급되었습니다.', 'success');
    } catch (error) {
      try {
        const current = await JSFes.apiFetch('/api/manager/totp', { token: state.token });
        applyTotpResult(current);
      } catch {
        startTicker();
      }
      setMessage(error.message, 'error');
    } finally {
      state.totpRefreshing = false;
      setTotpButtonBusy(false);
    }
  }

  function applyTotpResult(result) {
    state.totp = result.totp;
    const output = document.getElementById('totpCode');
    if (output) output.textContent = totpEntryCode();
    startTicker();
  }

  function setTotpButtonBusy(isBusy) {
    const button = document.getElementById('refreshTotp');
    if (!button) return;
    button.disabled = isBusy;
    button.setAttribute('aria-busy', String(isBusy));
  }

  function startTicker() {
    stopTicker();
    const countdown = document.getElementById('totpCountdown');
    if (!countdown || !state.totp) return;

    function tick() {
      const seconds = Math.ceil((new Date(state.totp.expiresAt).getTime() - Date.now()) / 1000);
      countdown.textContent = `갱신까지 ${JSFes.formatCountdown(seconds)}`;
      if (seconds <= 0) {
        void refreshTotp();
      }
    }

    tick();
    state.ticker = window.setInterval(tick, 1000);
  }

  function stopTicker() {
    if (state.ticker) {
      window.clearInterval(state.ticker);
      state.ticker = null;
    }
  }

  function clearSession() {
    state.token = null;
    state.role = null;
    state.boothId = null;
    state.booth = null;
    state.totp = null;
    state.pendingStatus = null;
    JSFes.clearToken(JSFes.storageKeys.staffToken);
    JSFes.clearToken(JSFes.storageKeys.staffRole);
    JSFes.clearToken(JSFes.storageKeys.staffBoothId);
  }

  function logoutManager() {
    clearSession();
    renderLogin();
  }

  logoutButton.addEventListener('click', logoutManager);

  renderDashboard();
})();
