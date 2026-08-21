(function () {
  const app = document.getElementById('prizeApp');
  const stateLabel = document.getElementById('prizeState');
  const logoutButton = document.getElementById('prizeLogout');

  const state = {
    token: JSFes.getToken(JSFes.storageKeys.prizeToken),
    authenticated: false,
    user: null,
    offlineConfirmed: false,
    claiming: false,
    lookupRequest: 0
  };

  function updateStateLabel() {
    const loggedIn = Boolean(state.token && state.authenticated);
    stateLabel.textContent = loggedIn ? '지급 담당자 로그인됨' : '로그인 전';
    logoutButton.hidden = !loggedIn;
  }

  function setMessage(message, type) {
    const target = document.getElementById('prizeMessage');
    if (!target) return;
    target.textContent = message || '';
    target.className = `prize-message ${type || ''}`.trim();
  }

  function clearSession() {
    state.token = null;
    state.authenticated = false;
    state.user = null;
    state.offlineConfirmed = false;
    state.claiming = false;
    state.lookupRequest += 1;
    JSFes.clearToken(JSFes.storageKeys.prizeToken);
    updateStateLabel();
  }

  function renderLogin() {
    app.removeAttribute('aria-busy');
    updateStateLabel();
    document.body.classList.add('staff-login-mode');
    app.innerHTML = `
      <div class="staff-password-screen">
        <section class="staff-login-card admin-login-card" aria-labelledby="prizeLoginTitle">
          <img class="staff-login-symbol" src="/assets/icons/adminpw.svg" alt="" aria-hidden="true">
          <div class="staff-login-heading">
            <h1 id="prizeLoginTitle">상품 지급 페이지</h1>
            <p>권한 확인을 위해 비밀번호를 입력해주세요.</p>
          </div>
          <form id="prizeLoginForm" class="staff-password-form">
            <label class="sr-only" for="prizePassword">상품 지급 페이지 비밀번호</label>
            <input id="prizePassword" name="password" type="password" inputmode="numeric" maxlength="64" placeholder="Enter Password" required autocomplete="current-password">
            <button type="submit">로그인</button>
          </form>
          <p id="prizeMessage" class="message staff-login-message" aria-live="polite"></p>
        </section>
        <footer class="staff-footer">
          <span>2026 ⓒ 잠신고등학교 학생회</span>
        </footer>
      </div>
    `;

    document.getElementById('prizeLoginForm').addEventListener('submit', handleLogin);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    setMessage('로그인 중입니다.');

    try {
      const result = await JSFes.apiFetch('/api/auth/prize-login', {
        method: 'POST',
        body: { password: data.get('password') }
      });
      state.token = result.token;
      state.authenticated = true;
      JSFes.setToken(JSFes.storageKeys.prizeToken, result.token);
      renderDashboard();
    } catch (error) {
      setMessage(error.message, 'error');
      button.disabled = false;
    }
  }

  function renderDashboard() {
    if (!state.token || !state.authenticated) {
      renderLogin();
      return;
    }

    app.removeAttribute('aria-busy');
    document.body.classList.remove('staff-login-mode');
    updateStateLabel();
    app.innerHTML = `
      <div class="prize-dashboard">
        <h1 class="staff-festival-brand prize-festival-brand">2026 잠신제</h1>

        <form id="prizeLookupForm" class="prize-lookup-form" novalidate>
          <label class="sr-only" for="prizeUid">팔찌 또는 화면 번호</label>
          <input id="prizeUid" name="uid" type="text" inputmode="numeric" pattern="[0-9]*" minlength="1" maxlength="3" required autocomplete="off" placeholder="팔찌·화면의 번호를 입력하세요.">
          <button type="submit">조회</button>
        </form>

        <section id="prizeUserResult" class="prize-result-card" aria-label="조회된 스탬프 정보" aria-live="polite"></section>

        <label class="prize-offline-confirm" for="prizeOfflineConfirmed">
          <input id="prizeOfflineConfirmed" type="checkbox" disabled>
          <span class="prize-checkbox" aria-hidden="true"></span>
          <span>오프라인 적립(리플렛) 확인</span>
        </label>

        <button id="prizeClaimButton" class="prize-action-button" type="button" disabled>상품 지급</button>
        <p id="prizeMessage" class="prize-message" aria-live="polite"></p>

        <dialog id="prizeConfirmDialog" class="prize-confirm-dialog" aria-labelledby="prizeConfirmTitle" aria-describedby="prizeConfirmDescription">
          <section class="prize-confirm-card">
            <h2 id="prizeConfirmTitle">상품을 지급하시겠습니까?</h2>
            <p id="prizeConfirmDescription">화면-팔찌 번호 대조 및 적립 방식을<br>확인하신 후 지급해 주세요.</p>
            <button id="prizeConfirmButton" class="prize-confirm-button" type="button">확인</button>
            <button class="prize-confirm-close" type="button" aria-label="상품 지급 확인 팝업 닫기"></button>
          </section>
        </dialog>

      </div>
    `;

    renderUserResult();
    document.getElementById('prizeLookupForm').addEventListener('submit', lookupUser);
    document.getElementById('prizeOfflineConfirmed').addEventListener('change', (event) => {
      state.offlineConfirmed = event.currentTarget.checked;
      renderUserResult();
    });
    document.getElementById('prizeClaimButton').addEventListener('click', openConfirmDialog);
    document.getElementById('prizeConfirmButton').addEventListener('click', claimReward);
    document.querySelector('.prize-confirm-close').addEventListener('click', closeConfirmDialog);
    document.getElementById('prizeConfirmDialog').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeConfirmDialog();
    });
    document.getElementById('prizeUid').focus();
  }

  function hasUnclaimedUser() {
    return Boolean(state.user && !state.user.reward_claimed);
  }

  function canClaimReward() {
    return Boolean(hasUnclaimedUser() && (state.user.eligible || state.offlineConfirmed));
  }

  function renderUserResult() {
    const target = document.getElementById('prizeUserResult');
    if (!target) return;

    const user = state.user;
    const userNumber = user ? String(user.uid).padStart(3, '0') : '---';
    const stampStatus = user ? `${user.stampCount}/${user.stampRequirement}` : '-/9';
    const availability = !user
      ? '-'
      : user.reward_claimed
        ? '지급 완료'
        : canClaimReward()
          ? 'O'
          : 'X';

    target.innerHTML = `
      <h2>${JSFes.escapeHtml(userNumber)}</h2>
      <span class="prize-result-divider" aria-hidden="true"></span>
      <dl>
        <div>
          <dt>스탬프 현황 :</dt>
          <dd>${JSFes.escapeHtml(stampStatus)}</dd>
        </div>
        <div>
          <dt>상품 지급 가능 여부 :</dt>
          <dd class="${canClaimReward() ? 'available' : ''}">${JSFes.escapeHtml(availability)}</dd>
        </div>
      </dl>
    `;

    syncActionState();
  }

  function syncActionState() {
    const checkbox = document.getElementById('prizeOfflineConfirmed');
    const button = document.getElementById('prizeClaimButton');
    const canUseOfflineLeaflet = hasUnclaimedUser();

    if (checkbox) {
      checkbox.disabled = !canUseOfflineLeaflet || state.claiming;
      checkbox.checked = canUseOfflineLeaflet && state.offlineConfirmed;
    }
    if (button) {
      button.disabled = !canClaimReward() || state.claiming;
    }
  }

  async function lookupUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const uid = String(new FormData(form).get('uid') || '').trim();
    const button = form.querySelector('[type="submit"]');
    const requestedToken = state.token;
    const request = ++state.lookupRequest;
    state.offlineConfirmed = false;
    button.disabled = true;
    setMessage('조회 중입니다.');

    try {
      const result = await JSFes.apiFetch(`/api/prize/user?uid=${encodeURIComponent(uid)}`, {
        token: requestedToken
      });
      if (request !== state.lookupRequest || requestedToken !== state.token) return;
      state.user = result.user;
      renderUserResult();
      setMessage(
        state.user.reward_claimed
          ? '이미 상품 지급이 완료된 팔찌입니다.'
          : state.user.eligible
            ? '전자 스탬프로 상품 지급이 가능합니다.'
            : '',
        state.user.eligible ? 'success' : ''
      );
    } catch (error) {
      if (request !== state.lookupRequest || requestedToken !== state.token) return;
      if (JSFes.isAuthError(error)) {
        clearSession();
        renderLogin();
        setMessage(error.message, 'error');
        return;
      }
      state.user = null;
      renderUserResult();
      setMessage(error.message, 'error');
    } finally {
      if (request === state.lookupRequest && button.isConnected) button.disabled = false;
    }
  }

  function openConfirmDialog() {
    if (!canClaimReward() || state.claiming) return;
    document.getElementById('prizeConfirmDescription').innerHTML = state.offlineConfirmed
      ? '종이 리플렛 적립 및 팔찌 번호를<br>확인한 후 지급해 주세요'
      : '화면-팔찌 번호 대조 및 적립 방식을<br>확인하신 후 지급해 주세요.';
    document.getElementById('prizeConfirmDialog').showModal();
  }

  function closeConfirmDialog() {
    const confirmDialog = document.getElementById('prizeConfirmDialog');
    if (confirmDialog && confirmDialog.open && !state.claiming) confirmDialog.close();
  }

  async function claimReward() {
    if (!canClaimReward() || state.claiming) return;

    const confirmButton = document.getElementById('prizeConfirmButton');
    const requestedToken = state.token;
    const requestedUid = state.user.uid;
    const offlineConfirmed = state.offlineConfirmed;
    state.claiming = true;
    if (confirmButton) confirmButton.disabled = true;
    syncActionState();
    setMessage('상품 지급 상태를 저장 중입니다.');

    try {
      const result = await JSFes.apiFetch('/api/reward/claim', {
        method: 'POST',
        token: requestedToken,
        body: {
          uid: requestedUid,
          offline_confirmed: offlineConfirmed
        }
      });
      if (state.token !== requestedToken || state.user?.uid !== requestedUid) return;
      state.user = {
        ...state.user,
        ...result.user,
        reward_claimed: true
      };
      state.offlineConfirmed = false;
      document.getElementById('prizeConfirmDialog').close();
      renderUserResult();
      setMessage(`팔찌 ${String(state.user.uid).padStart(3, '0')}번 상품 지급을 완료했습니다.`, 'success');
      document.getElementById('prizeUid')?.select();
    } catch (error) {
      if (JSFes.isAuthError(error)) {
        clearSession();
        renderLogin();
        setMessage(error.message, 'error');
        return;
      }
      setMessage(error.message, 'error');
    } finally {
      state.claiming = false;
      if (confirmButton && document.body.contains(confirmButton)) confirmButton.disabled = false;
      syncActionState();
    }
  }

  logoutButton.addEventListener('click', () => {
    clearSession();
    renderLogin();
  });

  async function initialize() {
    if (!state.token) {
      renderLogin();
      return;
    }

    app.setAttribute('aria-busy', 'true');
    app.replaceChildren();
    document.body.classList.add('staff-login-mode');
    updateStateLabel();

    try {
      await JSFes.apiFetch('/api/auth/prize-session', {
        token: state.token,
        timeoutMs: 5000
      });
      state.authenticated = true;
      renderDashboard();
    } catch (error) {
      clearSession();
      renderLogin();
      setMessage(
        JSFes.isAuthError(error)
          ? '인증이 만료되었습니다. 다시 로그인해주세요.'
          : '인증 상태를 확인하지 못했습니다. 다시 로그인해주세요.',
        'error'
      );
    }
  }

  initialize();
})();
