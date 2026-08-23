(function () {
  const USER_UID_MAX = 799;

  class ApiError extends Error {
    constructor(message, code, status, payload) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.status = status;
      this.payload = payload;
    }
  }

  const storageKeys = {
    userToken: 'jsfes:user-token',
    staffToken: 'jsfes:staff-token',
    staffRole: 'jsfes:staff-role',
    staffBoothId: 'jsfes:staff-booth-id',
    prizeToken: 'jsfes:prize-token',
    stampQueue: 'jsfes:stamp-queue'
  };
  let activeNfcController = null;

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getToken(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function setToken(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearToken(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // Storage may be unavailable in restricted browser modes.
    }
  }

  function normalizeStampQueue(value) {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value || '[]');
      } catch (error) {
        return [];
      }
    }

    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => (
      item &&
      item.type === 'nfc' &&
      Number.isInteger(item.uid) &&
      item.uid >= 0 &&
      item.uid <= USER_UID_MAX &&
      typeof item.tag_uid === 'string' &&
      item.tag_uid.trim()
    ));
  }

  function buildStampBoard(stamps, size = 9) {
    const safeSize = Number.isInteger(size) && size > 0 ? size : 9;
    const slots = Array.from({ length: safeSize }, () => null);

    if (!Array.isArray(stamps)) return slots;

    for (const stamp of stamps) {
      const boardSlot = Number(stamp && stamp.board_slot);
      if (!Number.isInteger(boardSlot) || boardSlot < 0 || boardSlot >= safeSize) continue;
      if (slots[boardSlot] === null) slots[boardSlot] = stamp;
    }

    return slots;
  }

  function bindStampImages(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    root.querySelectorAll('[data-stamp-image]').forEach((image) => {
      const fallback = image.parentElement.querySelector('.stamp-image-fallback');
      const showImage = () => {
        image.classList.add('is-loaded');
        if (fallback) fallback.hidden = true;
      };
      const showFallback = () => {
        image.remove();
        if (fallback) fallback.hidden = false;
      };

      image.addEventListener('load', showImage, { once: true });
      image.addEventListener('error', showFallback, { once: true });

      if (image.complete) {
        if (image.naturalWidth > 0) showImage();
        else showFallback();
      }
    });
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function apiFetchOnce(path, options) {
    const config = options || {};
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 12000;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      Accept: 'application/json',
      ...(config.headers || {})
    };

    if (config.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`;
    }

    let response;
    try {
      response = await fetch(path, {
        method: config.method || 'GET',
        headers,
        body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;

    if (!response.ok || (payload && payload.success === false && payload.error)) {
      const error = payload && payload.error ? payload.error : {};
      throw new ApiError(
        error.message || '요청을 처리하지 못했습니다.',
        error.code || 'REQUEST_FAILED',
        response.status,
        payload
      );
    }

    if (response.status !== 204 && !payload) {
      throw new ApiError(
        '서버 응답 형식이 올바르지 않습니다.',
        'INVALID_RESPONSE',
        response.status,
        null
      );
    }

    return payload;
  }

  async function apiFetch(path, options) {
    const config = options || {};
    const parsedRetries = Number.parseInt(config.retries || 0, 10);
    const retries = Number.isFinite(parsedRetries) && parsedRetries > 0 ? parsedRetries : 0;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await apiFetchOnce(path, config);
      } catch (error) {
        lastError = error;
        const canRetry =
          attempt < retries &&
          (error.name !== 'ApiError' || error.status === 0 || error.status >= 500);

        if (!canRetry) break;
        await wait(350 * (attempt + 1));
      }
    }

    if (lastError && lastError.name === 'ApiError') {
      throw lastError;
    }

    throw new ApiError(
      '네트워크 연결을 확인하세요.',
      'NETWORK_ERROR',
      0,
      null
    );
  }

  function go(path) {
    if (window.location.pathname !== path) {
      history.pushState(null, '', path);
    }
    window.dispatchEvent(new Event('jsfes:navigate'));
  }

  function statusMeta(status) {
    const map = {
      open: { label: '운영중', className: 'status-open' },
      closed: { label: '운영 종료', className: 'status-closed' },
      soldout: { label: '임시 중단', className: 'status-soldout' }
    };

    return map[status] || { label: status || '미확인', className: 'status-closed' };
  }

  function formatCountdown(seconds) {
    const safe = Math.max(0, Number.parseInt(seconds, 10) || 0);
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function getNfcSupport() {
    return 'NDEFReader' in window;
  }

  function isAuthError(error) {
    return Boolean(error && (error.status === 401 || error.status === 403));
  }

  async function scanNfc(onReading, onStatus) {
    if (!getNfcSupport()) {
      throw new Error('NFC를 지원하지 않는 브라우저입니다.');
    }

    if (activeNfcController) activeNfcController.abort();

    const controller = new AbortController();
    const reader = new NDEFReader();
    activeNfcController = controller;
    try {
      await reader.scan({ signal: controller.signal });
    } catch (error) {
      if (activeNfcController === controller) activeNfcController = null;
      throw error;
    }
    if (onStatus) onStatus('scan-ready');

    reader.addEventListener('reading', (event) => {
      const uid = event.serialNumber || '';
      controller.abort();
      if (activeNfcController === controller) activeNfcController = null;
      let readingResult;
      try {
        readingResult = onReading(uid);
      } catch (error) {
        if (onStatus) onStatus('handler-error');
        return;
      }
      Promise.resolve(readingResult).catch(() => {
        if (onStatus) onStatus('handler-error');
      });
    }, { once: true });

    reader.addEventListener('readingerror', () => {
      controller.abort();
      if (activeNfcController === controller) activeNfcController = null;
      if (onStatus) onStatus('read-error');
    }, { once: true });
  }

  function setActiveRoute(route) {
    document.querySelectorAll('.route-nav [data-route]').forEach((button) => {
      button.classList.toggle('active', button.dataset.route === route);
    });
  }

  function stampMark(icon, name) {
    const raw = String(icon || name || 'S').trim();
    return escapeHtml(raw.slice(0, 2).toUpperCase());
  }

  function splitBoothName(name) {
    const full = String(name || '').trim();
    const match = full.match(/^(.*?)\s*\(([^()]*)\)\s*$/);

    if (!match || !match[1].trim() || !match[2].trim()) {
      return { full, front: full, back: full };
    }

    return {
      full,
      front: match[1].trim(),
      back: match[2].trim()
    };
  }

  const exports = {
    ApiError,
    userUidMax: USER_UID_MAX,
    storageKeys,
    escapeHtml,
    apiFetch,
    go,
    getToken,
    setToken,
    clearToken,
    normalizeStampQueue,
    buildStampBoard,
    bindStampImages,
    statusMeta,
    formatCountdown,
    isIos,
    getNfcSupport,
    isAuthError,
    scanNfc,
    setActiveRoute,
    stampMark,
    splitBoothName
  };

  if (typeof window !== 'undefined') {
    window.JSFes = exports;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
})();
