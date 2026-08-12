(function () {
  const app = document.getElementById('app');
  const authState = document.getElementById('authState');
  const logoutButton = document.getElementById('logoutButton');
  const dialog = document.getElementById('boothDialog');
  const routes = new Set(['/start', '/map', '/stamp', '/reward', '/schedule']);
  let messageClearTimer = null;
  let messageSequence = 0;
  let renderSequence = 0;

  const state = {
    token: JSFes.getToken(JSFes.storageKeys.userToken),
    me: null,
    booths: [],
    boothsLoaded: false,
    dashboard: null,
    notice: null,
    noticeLoaded: false,
    mapPrefetchInFlight: false,
    mapRefreshRequest: 0,
    scanMode: JSFes.isIos() ? 'totp' : 'nfc',
    queueProcessing: false,
    activityInFlight: false,
    activityQueued: false,
    pendingRoute: null,
    pendingStampAction: null
  };

  function currentRoute() {
    const path = window.location.pathname;
    if (routes.has(path)) return path;
    return '/start';
  }

  function setMessage(message, type) {
    const target = document.getElementById('pageMessage');
    if (!target) return;

    const text = message || '';
    const sequence = ++messageSequence;
    window.clearTimeout(messageClearTimer);

    target.classList.remove('error', 'success', 'is-visible');
    target.classList.add('message', 'page-toast');
    if (type) target.classList.add(type);
    target.textContent = text;
    if (!text) return;

    void target.offsetWidth;
    target.classList.add('is-visible');

    messageClearTimer = window.setTimeout(() => {
      if (sequence !== messageSequence || !target.isConnected) return;
      target.textContent = '';
      target.classList.remove('error', 'success', 'is-visible');
      target.classList.add('message', 'page-toast');
    }, 2400);
  }

  function updateAuthState() {
    const loggedIn = Boolean(state.token && state.me);
    authState.textContent = loggedIn ? `팔찌 ${state.me.uid}` : '로그인 전';
    logoutButton.hidden = !state.token;
  }

  function recordActivity() {
    if (!state.token || !state.me) return;

    if (state.activityInFlight) {
      state.activityQueued = true;
      return;
    }

    state.activityInFlight = true;
    JSFes.apiFetch('/api/users/activity', {
      method: 'POST',
      token: state.token,
      timeoutMs: 5000
    }).catch((error) => {
      if (!JSFes.isAuthError(error)) return;
      state.token = null;
      state.me = null;
      JSFes.clearToken(JSFes.storageKeys.userToken);
      updateAuthState();
    }).finally(() => {
      state.activityInFlight = false;
      if (!state.activityQueued) return;
      state.activityQueued = false;
      recordActivity();
    });
  }

  async function fetchMapData() {
    const [booths, notices] = await Promise.all([
      JSFes.apiFetch('/api/booths').catch(() => null),
      JSFes.apiFetch('/api/notices').catch(() => null)
    ]);

    return {
      booths: booths ? booths.booths || [] : null,
      notice: notices ? notices.notice || null : null,
      boothsLoaded: Boolean(booths),
      noticeLoaded: Boolean(notices)
    };
  }

  function applyMapData(mapData) {
    if (mapData.boothsLoaded) {
      state.booths = mapData.booths;
      state.boothsLoaded = true;
    }
    if (mapData.noticeLoaded) {
      state.notice = mapData.notice;
      state.noticeLoaded = true;
    }
  }

  async function loadMapData() {
    applyMapData(await fetchMapData());
  }

  async function loadNotice() {
    const notices = await JSFes.apiFetch('/api/notices').catch(() => null);
    if (!notices) return;
    state.notice = notices.notice || null;
    state.noticeLoaded = true;
  }

  async function loadBooths() {
    const booths = await JSFes.apiFetch('/api/booths').catch(() => null);
    if (!booths) return;
    state.booths = booths.booths || [];
    state.boothsLoaded = true;
  }

  async function prefetchMapData() {
    if (state.mapPrefetchInFlight || (state.boothsLoaded && state.noticeLoaded)) return;
    state.mapPrefetchInFlight = true;
    try {
      await Promise.all([
        state.boothsLoaded ? null : loadBooths(),
        state.noticeLoaded ? null : loadNotice()
      ]);
    } finally {
      state.mapPrefetchInFlight = false;
    }
  }

  async function refreshMapData(sequence) {
    const request = ++state.mapRefreshRequest;
    const previousBooths = JSON.stringify(state.booths);
    const previousNotice = JSON.stringify(state.notice);
    const mapData = await fetchMapData();

    if (request !== state.mapRefreshRequest) return;

    applyMapData(mapData);
    const changed = previousBooths !== JSON.stringify(state.booths)
      || previousNotice !== JSON.stringify(state.notice);

    if (!changed || sequence !== renderSequence || currentRoute() !== '/map' || dialog.open) {
      return;
    }

    const scrollTop = window.scrollY;
    await renderMap(sequence);
    window.scrollTo(0, scrollTop);
  }

  function updateDashboardDom() {
    const activeBooths = document.querySelector('[data-dashboard-active-booths]');
    const onlineUsers = document.querySelector('[data-dashboard-online-users]');
    if (activeBooths) activeBooths.textContent = state.dashboard?.activeBooths ?? '-';
    if (onlineUsers) onlineUsers.textContent = state.dashboard?.onlineUsers ?? '-';
  }

  async function refreshDashboard() {
    const dashboard = await JSFes.apiFetch('/api/dashboard').catch(() => null);
    if (!dashboard) return;
    state.dashboard = dashboard;
    updateDashboardDom();
  }

  async function loadMe() {
    if (!state.token) {
      state.me = null;
      updateAuthState();
      return null;
    }

    try {
      state.me = await JSFes.apiFetch('/api/users/me', { token: state.token });
      updateAuthState();
      void processStampQueue();
      return state.me;
    } catch (error) {
      if (JSFes.isAuthError(error)) {
        state.token = null;
        state.me = null;
        JSFes.clearToken(JSFes.storageKeys.userToken);
        updateAuthState();
      }
      throw error;
    }
  }

  async function ensureUser(route) {
    if (!state.token) {
      state.pendingRoute = route;
      JSFes.go('/stamp');
      return false;
    }

    if (!state.me) {
      await loadMe().catch(() => null);
    }

    if (!state.me) {
      state.pendingRoute = route;
      JSFes.go('/stamp');
      return false;
    }

    return true;
  }

  function noticeHtml() {
    if (!state.notice) return '';
    return `<div class="notice">${JSFes.escapeHtml(state.notice.message)}</div>`;
  }

  function homeStatusHtml() {
    const dashboard = state.dashboard || {};
    return `
      <section class="home-status-card" aria-labelledby="homeStatusTitle">
        <div class="home-status-head">
          <span class="home-status-dot" aria-hidden="true"></span>
          <h2 id="homeStatusTitle">실시간 현황</h2>
        </div>
        <dl class="home-status-grid">
          <div>
            <dt>운영 중인 부스</dt>
            <dd><strong data-dashboard-active-booths>${dashboard.activeBooths ?? '-'}</strong><span>개</span></dd>
          </div>
          <div>
            <dt>방문자</dt>
            <dd><strong data-dashboard-online-users>${dashboard.onlineUsers ?? '-'}</strong><span>명</span></dd>
          </div>
        </dl>
      </section>
    `;
  }

  function formatUserNumber(uid) {
    return String(uid).padStart(3, '0');
  }

  function userNumberControlHtml() {
    const registered = Boolean(state.token && state.me);
    const label = registered ? formatUserNumber(state.me.uid) : '번호 등록';
    const ariaLabel = registered ? `팔찌 번호 ${label} 변경` : '팔찌 번호 등록';

    return `
      <button
        type="button"
        class="user-number-ribbon ${registered ? 'is-registered' : 'is-unregistered'}"
        data-user-number-control
        aria-label="${ariaLabel}">
        <span>${label}</span>
      </button>
    `;
  }

  function renderStart(options) {
    const message = options && options.message ? options.message : '';
    const menuItems = [
      { label: '부스 위치', route: '/map', iconPath: '/assets/icons/map.svg' },
      { label: '스탬프 적립', route: '/stamp', iconPath: '/assets/icons/stamp.svg' },
      { label: '일정 확인', route: '/schedule', iconPath: '/assets/icons/schedule.svg' }
    ];
    app.innerHTML = `
      <div class="home-screen">
        ${noticeHtml()}
        ${userNumberControlHtml()}
        <img class="home-logo" src="/assets/images/jsfes-logo.svg" alt="잠신제 로고">
        <nav class="home-menu" aria-label="주요 메뉴">
          ${menuItems.map((item) => `
            <button type="button" data-route="${item.route}" aria-label="${item.label}">
              <span class="home-menu-icon" aria-hidden="true">
                <img src="${item.iconPath}" alt="">
              </span>
              <span class="home-menu-label">${item.label}</span>
              <img class="home-menu-arrow" src="/assets/icons/arrow.svg" alt="" aria-hidden="true">
            </button>
          `).join('')}
        </nav>
        ${homeStatusHtml()}
        <p id="pageMessage" class="message">${JSFes.escapeHtml(message)}</p>
        <footer class="home-footer">
          <span>2026 ⓒ 잠신고등학교 학생회 | </span>
          <a href="https://www.instagram.com/jamsin_student/" target="_blank" rel="noopener noreferrer">문의하기</a>
        </footer>
      </div>
    `;

  }

  function getProgressPercent() {
    if (!state.me) return 0;
    return Math.min(100, Math.round((state.me.stampCount / state.me.stampRequirement) * 100));
  }

  function groupBoothsByFloor() {
    return state.booths.reduce((groups, booth) => {
      const floor = booth.floor_label || '기타';
      if (!groups[floor]) groups[floor] = [];
      groups[floor].push(booth);
      return groups;
    }, {});
  }

  function boothTileHtml(booth) {
    const meta = JSFes.statusMeta(booth.status);
    return `
      <button type="button" class="booth-tile ${JSFes.escapeHtml(booth.status)}" data-booth-id="${JSFes.escapeHtml(booth.booth_id)}">
        <span>
          <strong>${JSFes.escapeHtml(booth.name)}</strong>
          <span class="booth-location">${JSFes.escapeHtml(booth.room_label || booth.booth_id)}</span>
        </span>
        <span class="status-chip ${meta.className}">${meta.label}</span>
      </button>
    `;
  }

  function primaryNavHtml(activeRoute) {
    const items = [
      { label: '부스', route: '/map' },
      { label: '스탬프', route: '/stamp' },
      { label: '일정', route: '/schedule' }
    ];

    return `
      ${userNumberControlHtml()}
      <button type="button" class="festival-brand" data-route="/start" aria-label="시작 화면으로 이동">2026 잠신제</button>
      <nav class="map-route-nav" aria-label="주요 메뉴">
        ${items.map((item) => `
          <button
            type="button"
            data-route="${item.route}"
            ${item.route === activeRoute ? 'aria-current="page"' : ''}>
            ${item.label}
          </button>
        `).join('')}
      </nav>
    `;
  }

  function closeUserNumberDialog() {
    const overlay = document.querySelector('.user-number-overlay');
    if (!overlay) return;
    overlay.remove();
    document.querySelector('[data-user-number-control]')?.focus();
  }

  function showUserNumberDialog() {
    if (document.querySelector('.user-number-overlay')) return;

    const changing = Boolean(state.token && state.me);
    const actionLabel = changing ? '변경' : '등록';
    const title = `팔찌 번호를 ${actionLabel}하시겠습니까?`;
    const placeholder = `${actionLabel}할 번호를 입력해주세요`;

    app.insertAdjacentHTML('beforeend', `
      <div class="user-number-overlay">
        <section
          class="user-number-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="userNumberDialogTitle">
          <h2 id="userNumberDialogTitle">${title}</h2>
          <form id="userNumberForm">
            <label class="sr-only" for="userNumberInput">팔찌 번호</label>
            <input
              id="userNumberInput"
              name="uid"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              min="0"
              max="500"
              required
              autocomplete="off"
              placeholder="${placeholder}">
            <p id="userNumberMessage" class="user-number-message" aria-live="polite"></p>
            <div class="user-number-actions">
              <button type="button" class="user-number-cancel">취소</button>
              <button type="submit" class="user-number-confirm">확인</button>
            </div>
          </form>
        </section>
      </div>
    `);

    const overlay = document.querySelector('.user-number-overlay');
    const form = document.getElementById('userNumberForm');
    const input = document.getElementById('userNumberInput');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeUserNumberDialog();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeUserNumberDialog();
    });
    overlay.querySelector('.user-number-cancel').addEventListener('click', closeUserNumberDialog);
    form.addEventListener('submit', handleUserNumberSubmit);
    window.setTimeout(() => input.focus(), 0);
  }

  async function handleUserNumberSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('userNumberMessage');
    const submitButton = form.querySelector('[type="submit"]');
    const uid = new FormData(form).get('uid');
    const previousUid = state.me?.uid;

    message.textContent = '확인 중입니다.';
    message.className = 'user-number-message';
    submitButton.disabled = true;

    try {
      const result = await JSFes.apiFetch('/api/auth/user-login', {
        method: 'POST',
        body: { uid }
      });

      if (previousUid !== undefined && previousUid !== result.uid) {
        JSFes.clearToken(JSFes.storageKeys.stampQueue);
      }

      state.token = result.token;
      state.me = result.user || null;
      state.pendingRoute = null;
      state.pendingStampAction = null;
      JSFes.setToken(JSFes.storageKeys.userToken, result.token);
      updateAuthState();
      void processStampQueue();
      if (!state.me) await loadMe();
      await render();
    } catch (error) {
      message.textContent = error.message;
      message.className = 'user-number-message error';
      submitButton.disabled = false;
    }
  }

  async function renderMap(sequence) {
    if (sequence !== undefined && sequence !== renderSequence) return;
    const booths = state.booths || [];
    const popupTestBooth = booths.find((booth) => booth.booth_id === 'booth-20');

    app.innerHTML = `
      <div class="map-screen">
        ${noticeHtml()}
        <div class="map-shell-strip" aria-hidden="true"></div>
        ${primaryNavHtml('/map')}
        <section class="map-title-block" aria-labelledby="mapTitle">
          <h1 id="mapTitle">부스 배치도</h1>
          <p>각 부스를 클릭해 상세 정보를 확인하세요.</p>
        </section>
        <section class="map-board" aria-label="부스 배치도">
          <div class="map-canvas">
            ${popupTestBooth ? (() => {
              const meta = JSFes.statusMeta(popupTestBooth.status);
              return `
                <button
                  type="button"
                  class="map-pin map-pin-popup-test ${JSFes.escapeHtml(popupTestBooth.status)}"
                  data-booth-id="${JSFes.escapeHtml(popupTestBooth.booth_id)}"
                  aria-label="${JSFes.escapeHtml(popupTestBooth.name)} ${meta.label}">
                  <span>20</span>
                </button>
              `;
            })() : ''}
          </div>
        </section>
        <ul class="map-legend" aria-label="부스 운영 상태">
          <li><span class="legend-dot open" aria-hidden="true"></span><span>운영중</span></li>
          <li><span class="legend-dot soldout" aria-hidden="true"></span><span>임시 중단</span></li>
          <li><span class="legend-dot closed" aria-hidden="true"></span><span>운영 종료</span></li>
        </ul>
        <section class="map-list-section" aria-labelledby="boothListTitle">
          <h2 id="boothListTitle">전체 부스 목록</h2>
          <div class="map-list">
            ${booths.map((booth) => {
              const meta = JSFes.statusMeta(booth.status);
              return `
                <button
                  type="button"
                  class="map-list-card"
                  data-booth-id="${JSFes.escapeHtml(booth.booth_id)}"
                  aria-label="${JSFes.escapeHtml(booth.name)} ${JSFes.escapeHtml(booth.room_label || booth.booth_id)}, ${meta.label}. ${JSFes.escapeHtml(booth.description || '')}">
                  <span class="map-card-status ${JSFes.escapeHtml(booth.status)}" aria-hidden="true"></span>
                  <span class="map-card-main">
                    <span>
                      <strong>${JSFes.escapeHtml(booth.name)}</strong>
                      <em>(${JSFes.escapeHtml(booth.room_label || booth.booth_id)})</em>
                    </span>
                    <small>${JSFes.escapeHtml(booth.description || '등록된 설명이 없습니다.')}</small>
                  </span>
                </button>
              `;
            }).join('')}
          </div>
        </section>
      </div>
    `;

    app.querySelectorAll('[data-booth-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const booth = state.booths.find((item) => item.booth_id === button.dataset.boothId);
        showBoothDialog(booth);
      });
    });
  }

  function showBoothDialog(booth) {
    if (!booth) return;
    let isFlipped = false;
    const boothNameParts = JSFes.splitBoothName(booth.name);
    const boothName = JSFes.escapeHtml(boothNameParts.full);
    const boothFrontName = JSFes.escapeHtml(boothNameParts.front);
    const boothBackName = JSFes.escapeHtml(boothNameParts.back);
    const boothLocation = JSFes.escapeHtml(booth.room_label || booth.booth_id);
    const boothDescription = JSFes.escapeHtml(booth.description || '등록된 설명이 없습니다.');

    dialog.innerHTML = `
      <section
        class="booth-popup"
        aria-labelledby="boothPopupTitle"
        aria-describedby="boothPopupLocation boothPopupInstruction">
        <div class="booth-popup-card">
          <div class="booth-popup-face booth-popup-front" aria-hidden="false">
            <button type="button" class="booth-popup-close" aria-label="${boothName} 팝업 닫기"></button>
            <h2 id="boothPopupTitle" class="booth-popup-title">${boothFrontName}</h2>
            <p id="boothPopupLocation" class="booth-popup-location">(${boothLocation})</p>
            <button type="button" class="booth-popup-photo" aria-label="${boothName} 안내 카드 뒷면 보기">
              <span>부스 사진 등록 위치</span>
            </button>
            <p id="boothPopupInstruction" class="booth-popup-hint">카드를 터치해 뒤집어<br>운영측 설명을 확인하세요!</p>
          </div>
          <div class="booth-popup-face booth-popup-back-face" aria-hidden="true" inert>
            <button type="button" class="booth-popup-close" aria-label="${boothName} 팝업 닫기"></button>
            <button type="button" class="booth-popup-back" aria-label="${boothName} 안내 카드 앞면 보기">
              <h2>${boothBackName}</h2>
              <span class="booth-popup-divider" aria-hidden="true"></span>
              <span class="booth-popup-description">${boothDescription}</span>
            </button>
          </div>
        </div>
      </section>
    `;

    const popup = dialog.querySelector('.booth-popup');
    const frontFace = dialog.querySelector('.booth-popup-front');
    const backFace = dialog.querySelector('.booth-popup-back-face');
    const frontControl = dialog.querySelector('.booth-popup-photo');
    const backControl = dialog.querySelector('.booth-popup-back');

    const setFlipped = (nextFlipped) => {
      isFlipped = nextFlipped;
      popup.classList.toggle('is-flipped', isFlipped);
      frontFace.setAttribute('aria-hidden', String(isFlipped));
      backFace.setAttribute('aria-hidden', String(!isFlipped));
      frontFace.inert = isFlipped;
      backFace.inert = !isFlipped;
      (isFlipped ? backControl : frontControl).focus({ preventScroll: true });
    };

    dialog.querySelectorAll('.booth-popup-close').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
    frontFace.addEventListener('click', (event) => {
      if (event.target.closest('.booth-popup-close')) return;
      setFlipped(true);
    });
    backFace.addEventListener('click', (event) => {
      if (event.target.closest('.booth-popup-close')) return;
      setFlipped(false);
    });
    dialog.showModal();
  }

  async function renderStamp(sequence) {
    if (state.token && !state.me) {
      await loadMe().catch(() => null);
    }
    if (currentRoute() !== '/stamp') return;
    if (sequence !== undefined && sequence !== renderSequence) return;

    const loggedIn = Boolean(state.token && state.me);
    const stampSlots = JSFes.buildStampBoard(loggedIn ? state.me.stamps : [], 9);

    app.innerHTML = `
      <div class="user-flow-screen stamp-screen">
        ${noticeHtml()}
        <div class="map-shell-strip" aria-hidden="true"></div>
        ${primaryNavHtml('/stamp')}
        <section class="flow-title-block">
          <h1>스탬프 적립</h1>
          <p>부스별 태그를 스캔해 스탬프를 모으세요.</p>
        </section>
        <label class="stamp-mode-switch ${state.scanMode === 'totp' ? 'is-code' : ''}">
          <span class="sr-only">6자리 코드 입력 모드</span>
          <input id="stampModeSwitch" type="checkbox" ${state.scanMode === 'totp' ? 'checked' : ''}>
          <span aria-hidden="true"></span>
        </label>
        <section class="stamp-board-card" aria-label="스탬프 진행 상황">
          <div class="stamp-progress-head">
            <span>진행률</span>
            <span>${loggedIn ? `${state.me.stampCount}/${state.me.stampRequirement}` : '0/9'}</span>
          </div>
          <progress class="stamp-progress-track" max="100" value="${loggedIn ? getProgressPercent() : 0}">${loggedIn ? getProgressPercent() : 0}%</progress>
          <div class="stamp-board">
            ${stampSlots.map((stamp) => stamp && loggedIn ? `
              <div class="stamp-cell done" title="${JSFes.escapeHtml(stamp.name)}">
                <span class="stamp-mark">
                  <img
                    class="stamp-image"
                    src="${JSFes.escapeHtml(stamp.stamp_icon)}"
                    alt=""
                    data-stamp-image>
                  <span class="stamp-image-fallback">${JSFes.stampMark('', stamp.name)}</span>
                </span>
                <span class="sr-only">${JSFes.escapeHtml(stamp.name)}에서 적립한 스탬프</span>
              </div>
            ` : '<div class="stamp-cell empty" aria-hidden="true"></div>').join('')}
          </div>
        </section>
        <section id="scanBody" class="stamp-action-panel"></section>
        <p id="pageMessage" class="message stamp-message"></p>
      </div>
    `;

    JSFes.bindStampImages(app);
    document.getElementById('stampModeSwitch').addEventListener('change', (event) => {
      state.scanMode = event.currentTarget.checked ? 'totp' : 'nfc';
      renderStamp();
    });

    renderScanBody();
  }

  function showStampLoginDialog(action) {
    state.pendingStampAction = action || null;
    if (!state.pendingRoute) state.pendingRoute = '/stamp';

    const screen = document.querySelector('.stamp-screen');
    if (!screen || screen.querySelector('.stamp-login-overlay')) return;

    screen.insertAdjacentHTML('beforeend', `
      <section class="user-number-overlay stamp-login-overlay" aria-label="팔찌 번호 로그인">
        <div class="user-number-dialog" role="dialog" aria-modal="true" aria-labelledby="stampLoginTitle">
          <h2 id="stampLoginTitle">팔찌 번호를 등록하시겠습니까?</h2>
          <form id="stampLoginForm">
            <label class="sr-only" for="stampLoginUid">팔찌 번호</label>
            <input
              id="stampLoginUid"
              name="uid"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              min="0"
              max="500"
              required
              autocomplete="off"
              placeholder="등록할 번호를 입력해주세요">
            <p id="stampLoginMessage" class="user-number-message" aria-live="polite"></p>
            <div class="user-number-actions">
              <button type="button" class="user-number-cancel stamp-login-cancel">취소</button>
              <button type="submit" class="user-number-confirm">확인</button>
            </div>
          </form>
        </div>
      </section>
    `);

    const overlay = screen.querySelector('.stamp-login-overlay');
    const form = document.getElementById('stampLoginForm');
    const input = document.getElementById('stampLoginUid');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeStampLoginDialog();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeStampLoginDialog();
    });
    overlay.querySelector('.stamp-login-cancel').addEventListener('click', closeStampLoginDialog);
    form.addEventListener('submit', handleLogin);
    window.setTimeout(() => input.focus(), 0);
  }

  function closeStampLoginDialog() {
    const overlay = document.querySelector('.stamp-login-overlay');
    if (!overlay) return;

    overlay.remove();
    state.pendingStampAction = null;
    if (state.pendingRoute === '/stamp') state.pendingRoute = null;
    document.getElementById('scanButton')?.focus();
  }

  async function requireStampUser(action) {
    if (state.token && !state.me) {
      await loadMe().catch(() => null);
    }

    if (state.token && state.me) return true;
    showStampLoginDialog(action);
    return false;
  }

  function renderScanBody() {
    const scanBody = document.getElementById('scanBody');
    if (!scanBody) return;

    const loggedIn = Boolean(state.token && state.me);
    if (loggedIn && state.me.reward_claimed) {
      scanBody.innerHTML = '<p class="message success">상품 수령이 완료되어 추가로 적립할 수 없습니다.</p>';
      return;
    }
    if (loggedIn && state.me.stampCount >= state.me.stampRequirement) {
      scanBody.innerHTML = `
        <p class="message success">스탬프판을 완성했습니다.</p>
        <button type="button" data-route="/reward">상품 수령 확인</button>
      `;
      return;
    }

    if (state.scanMode === 'nfc') {
      const supported = JSFes.getNfcSupport();
      scanBody.innerHTML = `
        <button id="scanButton" type="button" ${loggedIn && !supported ? 'disabled' : ''}>NFC 태그 스캔하기</button>
      `;

      const scanButton = document.getElementById('scanButton');
      if (scanButton) {
        scanButton.addEventListener('click', async () => {
          if (!(await requireStampUser({ type: 'nfc' }))) return;
          await startStampScan();
        });
      }
      return;
    }

    scanBody.innerHTML = `
      <form id="codeForm" class="stamp-code-form">
        <label>
          <span class="sr-only">6자리 부스 코드</span>
          <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code" placeholder="부스 코드를 입력해주세요">
        </label>
        <button type="submit">코드로 적립</button>
      </form>
    `;

    document.getElementById('codeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const payload = {
        type: 'totp',
        code: data.get('code')
      };
      if (!(await requireStampUser(payload))) return;
      await submitStamp(payload);
    });
  }

  async function startStampScan() {
    setMessage('스캔 대기 중입니다.');
    try {
      await JSFes.scanNfc(async (tagUid) => {
        if (!tagUid) {
          setMessage('태그 UID를 읽지 못했습니다.', 'error');
          return;
        }
        await submitStamp({ type: 'nfc', tag_uid: tagUid });
      }, (status) => {
        if (status === 'read-error') setMessage('NFC 태그를 읽지 못했습니다. 다시 시도하세요.', 'error');
        if (status === 'handler-error') setMessage('스탬프 처리 중 오류가 발생했습니다.', 'error');
      });
    } catch (error) {
      setMessage(error.message, 'error');
    }
  }

  async function submitStamp(payload) {
    setMessage('처리 중입니다.');
    try {
      await JSFes.apiFetch('/api/stamps', {
        method: 'POST',
        token: state.token,
        body: payload,
        retries: 2
      });
      await loadMe();
      await renderStamp();
      setMessage('스탬프가 적립되었습니다.', 'success');
    } catch (error) {
      if (payload.type === 'nfc' && shouldQueueStamp(error)) {
        const queued = enqueueStamp(payload);
        setMessage(
          queued
            ? '네트워크가 불안정해 스탬프를 저장했습니다. 연결되면 다시 전송합니다.'
            : '오프라인 스탬프를 기기에 저장하지 못했습니다.',
          queued ? 'success' : 'error'
        );
        return;
      }
      setMessage(error.message, 'error');
    }
  }

  function shouldQueueStamp(error) {
    return !navigator.onLine || error.code === 'NETWORK_ERROR' || error.status >= 500;
  }

  function readStampQueue() {
    try {
      return JSFes.normalizeStampQueue(
        localStorage.getItem(JSFes.storageKeys.stampQueue) || '[]'
      );
    } catch (error) {
      return [];
    }
  }

  function writeStampQueue(queue) {
    try {
      localStorage.setItem(JSFes.storageKeys.stampQueue, JSON.stringify(queue.slice(-30)));
      return true;
    } catch (error) {
      return false;
    }
  }

  function enqueueStamp(payload) {
    if (!state.me || !Number.isInteger(state.me.uid)) return false;
    const queue = readStampQueue();
    const tagUid = String(payload.tag_uid || '').trim();

    if (!tagUid) return false;
    if (queue.some((item) => item.uid === state.me.uid && item.tag_uid === tagUid)) return true;

    queue.push({
      type: 'nfc',
      uid: state.me.uid,
      tag_uid: tagUid,
      queued_at: new Date().toISOString()
    });
    return writeStampQueue(queue);
  }

  async function processStampQueue() {
    if (state.queueProcessing || !state.token || !state.me || !navigator.onLine) return;

    const queue = readStampQueue();
    if (queue.length === 0) return;

    state.queueProcessing = true;

    try {
      const currentUid = state.me.uid;
      const currentUserItems = queue.filter((item) => item.uid === currentUid);
      const remaining = queue.filter((item) => item.uid !== currentUid);

      for (const item of currentUserItems) {
        try {
          await JSFes.apiFetch('/api/stamps', {
            method: 'POST',
            token: state.token,
            body: {
              type: 'nfc',
              tag_uid: item.tag_uid
            },
            retries: 1
          });
        } catch (error) {
          if (!['ALREADY_STAMPED', 'TAG_NOT_FOUND', 'BOOTH_CLOSED', 'REWARD_CLAIMED', 'BOARD_COMPLETE'].includes(error.code)) {
            remaining.push(item);
          }
        }
      }

      if (!writeStampQueue(remaining)) return;

      if (remaining.length !== queue.length) {
        await loadMe().catch(() => null);
        if (currentRoute() === '/stamp') {
          await renderStamp();
          setMessage('저장해 둔 스탬프를 다시 전송했습니다.', 'success');
        }
      }
    } finally {
      state.queueProcessing = false;
    }
  }

  async function renderReward(sequence) {
    if (!(await ensureUser('/reward'))) return;
    await loadMe();
    if (currentRoute() !== '/reward') return;
    if (sequence !== undefined && sequence !== renderSequence) return;

    const eligible = state.me.stampCount >= state.me.stampRequirement;
    const claimed = state.me.reward_claimed;

    app.innerHTML = `
      <div class="user-flow-screen reward-screen">
        <div class="map-shell-strip" aria-hidden="true"></div>
        ${primaryNavHtml(null)}
        <section class="flow-title-block">
          <h1>상품 수령</h1>
          <p>지급 담당자에게 화면 번호와 실물 팔찌를 함께 보여주세요.</p>
        </section>
        <section class="flow-card reward-card">
          <div class="flow-card-head">
            <span class="flow-dot" aria-hidden="true"></span>
            <div>
              <h2>수령 상태</h2>
              <p>팔찌 ${JSFes.escapeHtml(state.me.uid)}</p>
            </div>
          </div>
        <div class="reward-progress">
          <progress class="progress-bar" max="100" value="${getProgressPercent()}">${getProgressPercent()}%</progress>
          <p class="subtle">스탬프 ${state.me.stampCount}/${state.me.stampRequirement}</p>
        </div>
        <div class="metric-grid">
          <div class="metric"><span>조건</span><strong>${eligible ? '충족' : '미충족'}</strong></div>
          <div class="metric"><span>수령 상태</span><strong>${claimed ? '완료' : '대기'}</strong></div>
        </div>
        <p class="reward-station-guide">${rewardGuideText(eligible, claimed)}</p>
        <p id="pageMessage" class="message"></p>
        </section>
      </div>
    `;
  }

  function rewardGuideText(eligible, claimed) {
    if (claimed) return '상품 지급이 완료되었습니다.';
    if (!eligible) return '스탬프 조건을 충족하면 상품 지급처에서 수령할 수 있습니다.';
    return '상품 지급이 가능합니다. 지급 담당자가 팔찌 번호를 대조한 후 처리합니다.';
  }

  async function renderSchedule() {
    app.innerHTML = `
      <div class="user-flow-screen schedule-screen">
        <div class="map-shell-strip" aria-hidden="true"></div>
        ${primaryNavHtml('/schedule')}
        <section class="flow-title-block">
          <h1>축제 일정표</h1>
          <p>오늘의 타임라인을 확인하세요.</p>
        </section>
        <section class="schedule-card" aria-label="축제 일정 타임라인">
          <img id="scheduleImage" class="schedule-image" src="/assets/images/schedule.png" alt="축제 일정표" hidden>
          <p id="scheduleFallback" class="schedule-fallback" hidden>일정표를 준비 중입니다.</p>
        </section>
      </div>
    `;

    const image = document.getElementById('scheduleImage');
    image.addEventListener('load', () => {
      image.hidden = false;
    });
    image.addEventListener('error', () => {
      image.remove();
      document.getElementById('scheduleFallback').hidden = false;
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const loginMessage = document.getElementById('stampLoginMessage');
    const setLoginMessage = (message, type) => {
      if (!loginMessage) return;
      loginMessage.textContent = message || '';
      loginMessage.className = `user-number-message ${type || ''}`.trim();
    };
    setLoginMessage('로그인 중입니다.');

    const data = new FormData(event.currentTarget);
    const uid = data.get('uid');

    try {
      const result = await JSFes.apiFetch('/api/auth/user-login', {
        method: 'POST',
        body: { uid }
      });

      state.token = result.token;
      JSFes.setToken(JSFes.storageKeys.userToken, result.token);
      await loadMe();
      const pendingAction = state.pendingStampAction;
      const targetRoute = state.pendingRoute && state.pendingRoute !== '/start'
        ? state.pendingRoute
        : '/stamp';
      state.pendingRoute = null;
      state.pendingStampAction = null;

      if (targetRoute !== '/stamp') {
        JSFes.go(targetRoute);
        return;
      }

      await renderStamp();
      if (pendingAction?.type === 'totp') {
        const form = document.getElementById('codeForm');
        if (form) {
          form.elements.code.value = pendingAction.code || '';
        }
      }
      setMessage('로그인되었습니다. 적립 버튼을 다시 눌러주세요.', 'success');
    } catch (error) {
      setLoginMessage(error.message, 'error');
    }
  }

  function handleRouteClick(event) {
    const button = event.target.closest('[data-route]');
    if (!button) return;

    const route = button.dataset.route;
    if (!routes.has(route)) return;

    event.preventDefault();
    JSFes.go(route);
  }

  function handleUserNumberClick(event) {
    if (!event.target.closest('[data-user-number-control]')) return;
    event.preventDefault();
    showUserNumberDialog();
  }

  async function render() {
    const sequence = ++renderSequence;
    const route = currentRoute();
    const hadBoothData = state.boothsLoaded;
    if (route !== '/stamp' && route !== '/reward') {
      state.pendingRoute = null;
    }
    window.scrollTo(0, 0);
    document.body.dataset.route = route.slice(1);
    JSFes.setActiveRoute(route);

    try {
      const routeDataTasks = [];
      if (route === '/start' && !state.dashboard) routeDataTasks.push(refreshDashboard());
      if ((route === '/start' || route === '/stamp') && !state.noticeLoaded) {
        routeDataTasks.push(loadNotice());
      }
      if (route === '/map' && !state.boothsLoaded) routeDataTasks.push(loadMapData());
      if (state.token && !state.me) routeDataTasks.push(loadMe().catch(() => null));
      await Promise.all(routeDataTasks);

      if (state.token && state.me) {
        recordActivity();
      }

      if (sequence !== renderSequence || currentRoute() !== route) return;

      if (route === '/start') renderStart();
      if (route === '/map') await renderMap(sequence);
      if (route === '/stamp') await renderStamp(sequence);
      if (route === '/reward') await renderReward(sequence);
      if (route === '/schedule') await renderSchedule();

      if (sequence !== renderSequence || currentRoute() !== route) return;
      app.focus({ preventScroll: true });
      if (route === '/map' && hadBoothData) {
        void refreshMapData(sequence);
      } else if (route !== '/map') {
        void prefetchMapData();
      }
    } catch (error) {
      if (sequence !== renderSequence || currentRoute() !== route) return;
      app.innerHTML = `
        <section class="panel stack">
          <h1 class="page-title">오류</h1>
          <p class="message error">${JSFes.escapeHtml(error.message)}</p>
          <button type="button" data-route="/start">시작으로 이동</button>
        </section>
      `;
    }
  }

  logoutButton.addEventListener('click', () => {
    state.token = null;
    state.me = null;
    JSFes.clearToken(JSFes.storageKeys.userToken);
    updateAuthState();
    JSFes.go('/start');
  });

  document.addEventListener('click', handleRouteClick);
  document.addEventListener('click', handleUserNumberClick);
  document.addEventListener('pointerdown', recordActivity, { passive: true });
  document.addEventListener('keydown', recordActivity);
  window.addEventListener('popstate', render);
  window.addEventListener('jsfes:navigate', render);
  window.addEventListener('online', () => void processStampQueue());
  window.addEventListener('scroll', recordActivity, { passive: true });

  render();

  window.setInterval(() => {
    if (document.hidden || currentRoute() !== '/start') return;
    void refreshDashboard();
  }, 30 * 1000);

  window.setInterval(() => {
    JSFes.apiFetch('/api/ping').catch(() => {});
  }, 5 * 60 * 1000);
})();
