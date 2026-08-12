(function () {
  const app = document.getElementById('adminApp');
  const stateLabel = document.getElementById('adminState');
  const logoutButton = document.getElementById('adminLogout');

  const state = {
    token: JSFes.getToken(JSFes.storageKeys.staffToken),
    role: JSFes.getToken(JSFes.storageKeys.staffRole),
    stats: null,
    booths: [],
    logs: [],
    readiness: null,
    tags: [],
    supplementalLoaded: false,
    poller: null,
    polling: false
  };

  function setMessage(message, type) {
    const target = document.getElementById('adminMessage');
    if (!target) return;
    target.textContent = message || '';
    target.className = `message ${type || ''}`.trim();
  }

  function updateStateLabel() {
    const loggedIn = Boolean(state.token && state.role === 'admin');
    stateLabel.textContent = loggedIn ? '관리자 로그인됨' : '로그인 전';
    logoutButton.hidden = !loggedIn;
  }

  function renderLogin() {
    stopPolling();
    document.body.classList.add('staff-login-mode');
    updateStateLabel();
    app.innerHTML = `
      <div class="staff-password-screen">
        <section class="staff-login-card admin-login-card" aria-labelledby="adminLoginTitle">
          <img class="staff-login-symbol" src="/assets/icons/adminpw.svg" alt="" aria-hidden="true">
          <div class="staff-login-heading">
            <h1 id="adminLoginTitle">관리자 페이지</h1>
            <p>권한 확인을 위해 비밀번호를 입력해주세요.</p>
          </div>
          <form id="adminLoginForm" class="staff-password-form">
            <label class="sr-only" for="adminPassword">관리자 비밀번호</label>
            <input id="adminPassword" name="password" type="password" placeholder="Enter Password" required autocomplete="current-password">
            <button type="submit">로그인</button>
          </form>
          <p id="adminMessage" class="message staff-login-message"></p>
        </section>
        <footer class="staff-footer">
          <span>2026 ⓒ 잠신고등학교 학생회 | </span>
          <a href="https://www.instagram.com/jamsin_student/" target="_blank" rel="noopener noreferrer">문의하기</a>
        </footer>
      </div>
    `;

    document.getElementById('adminLoginForm').addEventListener('submit', handleLogin);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setMessage('로그인 중입니다.');

    const data = new FormData(event.currentTarget);

    try {
      const result = await JSFes.apiFetch('/api/auth/login', {
        method: 'POST',
        body: {
          role: 'admin',
          password: data.get('password')
        }
      });

      state.token = result.token;
      state.role = result.role;
      JSFes.setToken(JSFes.storageKeys.staffToken, result.token);
      JSFes.setToken(JSFes.storageKeys.staffRole, result.role);
      JSFes.clearToken(JSFes.storageKeys.staffBoothId);
      await renderDashboard();
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function loadAdminCoreData() {
    const [stats, booths] = await Promise.all([
      JSFes.apiFetch('/api/admin/stats', { token: state.token }),
      JSFes.apiFetch('/api/booths')
    ]);

    state.stats = stats;
    state.booths = booths.booths || [];
  }

  async function loadAdminSupplementalData() {
    const [logs, readiness, tags] = await Promise.all([
      JSFes.apiFetch('/api/admin/logs', { token: state.token }),
      JSFes.apiFetch('/api/admin/readiness', { token: state.token }),
      JSFes.apiFetch('/api/admin/tags', { token: state.token })
    ]);

    state.logs = logs.logs || [];
    state.readiness = readiness;
    state.tags = tags.tags || [];
    state.supplementalLoaded = true;
  }

  async function loadAdminData() {
    await Promise.all([loadAdminCoreData(), loadAdminSupplementalData()]);
  }

  async function refreshAdminSupplementalData() {
    const requestedToken = state.token;
    try {
      await loadAdminSupplementalData();
      if (requestedToken !== state.token) return;
      updateStatsDom();
    } catch (error) {
      if (JSFes.isAuthError(error)) {
        clearSession();
        renderLogin();
        setMessage(error.message, 'error');
        return;
      }
      setMessage(error.message, 'error');
    }
  }

  async function renderDashboard() {
    if (!state.token || state.role !== 'admin') {
      renderLogin();
      return;
    }

    try {
      await loadAdminCoreData();
      document.body.classList.remove('staff-login-mode');
      updateStateLabel();

      app.innerHTML = `
        <div class="stack">
          <section class="panel stack">
            <div class="toolbar">
              <button id="refreshAdmin" type="button" class="secondary-button">새로고침</button>
              <button id="closeAllBooths" type="button" class="danger-button">전체 부스 종료</button>
              <button type="button" class="secondary-button" data-export="users">사용자 CSV</button>
              <button type="button" class="secondary-button" data-export="stamps">스탬프 CSV</button>
              <button type="button" class="secondary-button" data-export="booths">부스 CSV</button>
              <button type="button" class="secondary-button" data-export="tags">태그 CSV</button>
              <button type="button" class="secondary-button" data-export="logs">기록 CSV</button>
              <a class="sentry-link" href="https://sentry.io/" target="_blank" rel="noreferrer">Sentry</a>
            </div>
              <div class="metric-grid">
              <div class="metric"><span>전체 팔찌</span><strong id="statTotalUsers">${state.stats.totalUsers}</strong></div>
              <div class="metric"><span>실시간 사용자</span><strong id="statOnlineUsers">${state.stats.onlineUsers}</strong></div>
              <div class="metric"><span>조건 달성</span><strong id="statGoalUsers">${state.stats.stampGoalCount}</strong></div>
              <div class="metric"><span>상품 수령</span><strong id="statRewardUsers">${state.stats.rewardClaimedCount}</strong></div>
            </div>
            <p id="adminMessage" class="message"></p>
          </section>

          <div class="admin-grid">
            <section class="panel stack">
              <h1 class="page-title">부스별 적립</h1>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>부스</th>
                      <th>상태</th>
                      <th>적립 수</th>
                    </tr>
                  </thead>
                  <tbody id="boothRows">
                    ${boothRowsHtml()}
                  </tbody>
                </table>
              </div>
            </section>

            <aside class="stack">
            <section class="panel stack">
                <h2 class="page-title">운영 점검</h2>
                <div id="readinessChecks" class="check-list">
                  ${readinessHtml()}
                </div>
              </section>

              <section class="panel stack">
                <h2 class="page-title">비밀번호 변경</h2>
                <form id="adminPasswordForm" class="form-grid">
                  <label>
                    현재 비밀번호
                    <input name="current_password" type="password" required autocomplete="current-password">
                  </label>
                  <label>
                    새 비밀번호
                    <input name="new_password" type="password" minlength="8" required autocomplete="new-password">
                  </label>
                  <button type="submit" class="secondary-button">변경</button>
                </form>
              </section>

              <section class="panel stack">
                <h2 class="page-title">긴급 공지</h2>
                <form id="noticeForm" class="form-grid">
                  <label>
                    공지 내용
                    <textarea name="message" maxlength="500" required></textarea>
                  </label>
                  <button type="submit">등록</button>
                </form>
              </section>

              <section class="panel stack">
                <h2 class="page-title">사용자 보정</h2>
                <form id="userLookupForm" class="inline-form">
                  <label>
                    팔찌 번호
                    <input name="uid" inputmode="numeric" required>
                  </label>
                  <button type="submit" class="secondary-button">조회</button>
                </form>
                <div id="userLookupResult" class="message"></div>
                <form id="stampAdjustForm" class="form-grid">
                  <label>
                    팔찌 번호
                    <input name="uid" inputmode="numeric" required>
                  </label>
                  <label>
                    스탬프 부스 ID 목록
                    <textarea name="stamps" placeholder="booth-101, booth-102"></textarea>
                  </label>
                  <button type="submit">스탬프 목록 저장</button>
                </form>
                <form id="rewardResetForm" class="inline-form">
                  <label>
                    팔찌 번호
                    <input name="uid" inputmode="numeric" required>
                  </label>
                  <button type="submit" class="secondary-button">수령 상태 복구</button>
                </form>
              </section>

              <section class="panel stack">
                <h2 class="page-title">태그 관리</h2>
                <form id="tagForm" class="form-grid">
                  <label>
                    태그 UID
                    <input id="tagUidInput" name="tag_uid" required autocomplete="off">
                  </label>
                  <label>
                    부스
                    <select name="booth_id" required>
                      ${state.booths.map((booth) => `
                        <option value="${JSFes.escapeHtml(booth.booth_id)}">${JSFes.escapeHtml(booth.name)} (${JSFes.escapeHtml(booth.booth_id)})</option>
                      `).join('')}
                    </select>
                  </label>
                  <div class="toolbar">
                    <button type="submit">매핑 저장</button>
                    <button id="tagScanButton" type="button" class="secondary-button" ${JSFes.getNfcSupport() ? '' : 'disabled'}>태그 스캔</button>
                  </div>
                </form>
                <div class="table-wrap">
                  <table class="compact-table">
                    <thead>
                      <tr>
                        <th>태그</th>
                        <th>부스</th>
                        <th>삭제</th>
                      </tr>
                    </thead>
                    <tbody id="tagRows">
                      ${tagRowsHtml()}
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="panel stack">
                <h2 class="page-title">운영 기록</h2>
                <div id="operationLogs" class="log-list">
                  ${logsHtml()}
                </div>
              </section>
            </aside>
          </div>
        </div>
      `;

      document.getElementById('refreshAdmin').addEventListener('click', renderDashboard);
      document.getElementById('closeAllBooths').addEventListener('click', closeAllBooths);
      document.querySelectorAll('[data-export]').forEach((button) => {
        button.addEventListener('click', () => downloadExport(button.dataset.export));
      });
      document.getElementById('noticeForm').addEventListener('submit', submitNotice);
      document.getElementById('userLookupForm').addEventListener('submit', lookupUser);
      document.getElementById('stampAdjustForm').addEventListener('submit', saveUserStamps);
      document.getElementById('rewardResetForm').addEventListener('submit', resetReward);
      document.getElementById('adminPasswordForm').addEventListener('submit', changePassword);
      document.getElementById('tagForm').addEventListener('submit', saveTagMapping);
      document.getElementById('tagScanButton').addEventListener('click', scanTagForMapping);
      bindTagDeleteButtons();
      startPolling();
      void refreshAdminSupplementalData();
    } catch (error) {
      if (JSFes.isAuthError(error)) {
        clearSession();
        renderLogin();
        setMessage(error.message, 'error');
        return;
      }

      updateStateLabel();
      app.innerHTML = `
        <section class="panel stack">
          <h1 class="page-title">연결 오류</h1>
          <p id="adminMessage" class="message error">${JSFes.escapeHtml(error.message)}</p>
          <button id="adminRetry" type="button">다시 시도</button>
        </section>
      `;
      document.getElementById('adminRetry').addEventListener('click', renderDashboard);
    }
  }

  function boothRowsHtml() {
    return state.booths.map((booth) => {
      const meta = JSFes.statusMeta(booth.status);
      return `
        <tr>
          <td>${JSFes.escapeHtml(booth.name)}<br><span class="subtle">${JSFes.escapeHtml(booth.booth_id)}</span></td>
          <td><span class="status-chip ${meta.className}">${meta.label}</span></td>
          <td>${Number(booth.stamp_count) || 0}</td>
        </tr>
      `;
    }).join('');
  }

  function updateStatsDom() {
    const totalUsers = document.getElementById('statTotalUsers');
    const onlineUsers = document.getElementById('statOnlineUsers');
    const goalUsers = document.getElementById('statGoalUsers');
    const rewardUsers = document.getElementById('statRewardUsers');
    const boothRows = document.getElementById('boothRows');

    if (totalUsers) totalUsers.textContent = state.stats.totalUsers;
    if (onlineUsers) onlineUsers.textContent = state.stats.onlineUsers;
    if (goalUsers) goalUsers.textContent = state.stats.stampGoalCount;
    if (rewardUsers) rewardUsers.textContent = state.stats.rewardClaimedCount;
    if (boothRows) boothRows.innerHTML = boothRowsHtml();
    const operationLogs = document.getElementById('operationLogs');
    if (operationLogs) operationLogs.innerHTML = logsHtml();
    const readinessChecks = document.getElementById('readinessChecks');
    if (readinessChecks) readinessChecks.innerHTML = readinessHtml();
    const tagRows = document.getElementById('tagRows');
    if (tagRows) {
      tagRows.innerHTML = tagRowsHtml();
      bindTagDeleteButtons();
    }
  }

  function tagRowsHtml() {
    if (!state.supplementalLoaded) {
      return `
        <tr>
          <td colspan="3" class="subtle">불러오는 중입니다.</td>
        </tr>
      `;
    }

    if (!state.tags || state.tags.length === 0) {
      return `
        <tr>
          <td colspan="3" class="subtle">등록된 태그가 없습니다.</td>
        </tr>
      `;
    }

    return state.tags.map((tag) => `
      <tr>
        <td><code>${JSFes.escapeHtml(tag.tag_uid)}</code></td>
        <td>${JSFes.escapeHtml(tag.booth_name || tag.booth_id)}<br><span class="subtle">${JSFes.escapeHtml(tag.booth_id)}</span></td>
        <td><button type="button" class="secondary-button small-button" data-delete-tag="${JSFes.escapeHtml(tag.tag_uid)}">삭제</button></td>
      </tr>
    `).join('');
  }

  function readinessHtml() {
    if (!state.supplementalLoaded) {
      return '<p class="subtle">불러오는 중입니다.</p>';
    }

    if (!state.readiness || !state.readiness.checks) {
      return '<p class="subtle">점검 결과를 불러오지 못했습니다.</p>';
    }

    return state.readiness.checks.map((check) => `
      <div class="check-item ${JSFes.escapeHtml(check.status)}">
        <strong>${JSFes.escapeHtml(check.label)}</strong>
        <span>${JSFes.escapeHtml(check.detail)}</span>
      </div>
    `).join('');
  }

  function logsHtml() {
    if (!state.supplementalLoaded) {
      return '<p class="subtle">불러오는 중입니다.</p>';
    }

    if (!state.logs || state.logs.length === 0) {
      return '<p class="subtle">아직 운영 기록이 없습니다.</p>';
    }

    return state.logs.slice(0, 12).map((log) => `
      <div class="log-item">
        <strong>${JSFes.escapeHtml(log.action)}</strong>
        <span>${JSFes.escapeHtml(log.actor_role)}${log.actor_booth_id ? ` · ${JSFes.escapeHtml(log.actor_booth_id)}` : ''}</span>
        <span>${JSFes.escapeHtml(log.target_type || '')}${log.target_id ? ` ${JSFes.escapeHtml(log.target_id)}` : ''}</span>
      </div>
    `).join('');
  }

  function startPolling() {
    stopPolling();
    state.poller = window.setInterval(async () => {
      if (state.polling) return;
      state.polling = true;
      try {
        await loadAdminData();
        updateStatsDom();
      } catch (error) {
        if (JSFes.isAuthError(error)) {
          clearSession();
          renderLogin();
          setMessage(error.message, 'error');
          return;
        }
        setMessage(error.message, 'error');
      } finally {
        state.polling = false;
      }
    }, 30000);
  }

  function stopPolling() {
    if (state.poller) {
      window.clearInterval(state.poller);
      state.poller = null;
    }
  }

  async function closeAllBooths() {
    if (!window.confirm('전체 부스를 종료 처리할까요?')) return;
    setMessage('처리 중입니다.');

    try {
      const result = await JSFes.apiFetch('/api/admin/booths/close-all', {
        method: 'PATCH',
        token: state.token
      });
      await renderDashboard();
      setMessage(`${result.closedCount}개 부스를 종료했습니다.`, 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function downloadExport(type) {
    setMessage('CSV 생성 중입니다.');

    try {
      const response = await fetch(`/api/admin/export?type=${encodeURIComponent(type)}`, {
        headers: {
          Authorization: `Bearer ${state.token}`
        }
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload && payload.error ? payload.error.message : 'CSV를 생성하지 못했습니다.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      link.href = url;
      link.download = match ? match[1] : `jsfes-${type}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('CSV를 저장했습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function submitNotice(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage('공지 등록 중입니다.');

    try {
      await JSFes.apiFetch('/api/admin/notice', {
        method: 'POST',
        token: state.token,
        body: { message: data.get('message') }
      });
      event.currentTarget.reset();
      setMessage('공지 등록이 완료되었습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function lookupUser(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const uid = String(data.get('uid') || '').trim();
    const target = document.getElementById('userLookupResult');
    if (target) target.textContent = '조회 중입니다.';

    try {
      const result = await JSFes.apiFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
        token: state.token
      });
      renderUserLookup(result.user);
    } catch (error) {
      if (target) {
        target.textContent = error.message;
        target.className = 'message error';
      }
    }
  }

  function renderUserLookup(user) {
    const target = document.getElementById('userLookupResult');
    if (!target || !user) return;

    const stampNames = user.stamps.length > 0
      ? user.stamps.map((stamp) => stamp.name).join(', ')
      : '없음';
    const rewardMethod = user.reward_claim_method === 'offline_leaflet'
      ? '오프라인 리플렛'
      : user.reward_claim_method === 'digital_stamps'
        ? '전자 스탬프'
        : '';
    const rewardStatus = user.reward_claimed
      ? `수령 완료${rewardMethod ? ` (${rewardMethod})` : ''}`
      : '미수령';

    target.className = 'message';
    target.innerHTML = `
      팔찌 ${JSFes.escapeHtml(user.uid)} · 스탬프 ${user.stampCount}개 · 상품 ${JSFes.escapeHtml(rewardStatus)}<br>
      <span class="subtle">${JSFes.escapeHtml(stampNames)}</span>
    `;
  }

  async function saveUserStamps(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const uid = String(data.get('uid') || '').trim();
    const stamps = String(data.get('stamps') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    setMessage('스탬프 보정 중입니다.');

    try {
      await JSFes.apiFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
        method: 'PATCH',
        token: state.token,
        body: { stamps }
      });
      await renderDashboard();
      setMessage('스탬프 목록을 저장했습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function resetReward(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const uid = String(data.get('uid') || '').trim();
    setMessage('수령 상태 복구 중입니다.');

    try {
      await JSFes.apiFetch(`/api/admin/users/${encodeURIComponent(uid)}/reward`, {
        method: 'PATCH',
        token: state.token,
        body: { reward_claimed: false }
      });
      await renderDashboard();
      setMessage('수령 상태를 복구했습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function saveTagMapping(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage('태그 매핑 저장 중입니다.');

    try {
      await JSFes.apiFetch('/api/admin/tags', {
        method: 'POST',
        token: state.token,
        body: {
          tag_uid: data.get('tag_uid'),
          booth_id: data.get('booth_id')
        }
      });
      event.currentTarget.reset();
      await renderDashboard();
      setMessage('태그 매핑을 저장했습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function scanTagForMapping() {
    const input = document.getElementById('tagUidInput');
    setMessage('태그 스캔 대기 중입니다.');

    try {
      await JSFes.scanNfc((tagUid) => {
        if (input) input.value = tagUid;
        setMessage('태그를 읽었습니다. 부스를 선택한 뒤 저장하세요.', 'success');
      }, (status) => {
        if (status === 'read-error') setMessage('태그를 읽지 못했습니다. 다시 시도하세요.', 'error');
      });
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  function bindTagDeleteButtons() {
    document.querySelectorAll('[data-delete-tag]').forEach((button) => {
      button.addEventListener('click', () => deleteTagMapping(button.dataset.deleteTag));
    });
  }

  async function deleteTagMapping(tagUid) {
    if (!window.confirm('이 태그 매핑을 삭제할까요?')) return;
    setMessage('태그 매핑 삭제 중입니다.');

    try {
      await JSFes.apiFetch(`/api/admin/tags/${encodeURIComponent(tagUid)}`, {
        method: 'DELETE',
        token: state.token
      });
      await renderDashboard();
      setMessage('태그 매핑을 삭제했습니다.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage('비밀번호 변경 중입니다.');

    try {
      await JSFes.apiFetch('/api/staff/password', {
        method: 'PATCH',
        token: state.token,
        body: {
          current_password: data.get('current_password'),
          new_password: data.get('new_password')
        }
      });
      clearSession();
      renderLogin();
      setMessage('비밀번호가 변경되었습니다. 다시 로그인하세요.', 'success');
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  function clearSession() {
    stopPolling();
    state.token = null;
    state.role = null;
    state.stats = null;
    state.booths = [];
    state.logs = [];
    state.readiness = null;
    state.tags = [];
    state.supplementalLoaded = false;
    JSFes.clearToken(JSFes.storageKeys.staffToken);
    JSFes.clearToken(JSFes.storageKeys.staffRole);
    JSFes.clearToken(JSFes.storageKeys.staffBoothId);
  }

  logoutButton.addEventListener('click', () => {
    clearSession();
    renderLogin();
  });

  renderDashboard();
})();
