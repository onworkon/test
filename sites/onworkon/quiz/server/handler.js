'use strict';
const { getConfig } = require('./config');
const { createStore } = require('./store');
const { sha256, verifyPassword, createSession, isAdmin, cookie, participantId } = require('./auth');
const data = require('./questions');

const errors = {
  CONTENT_CHANGED: [409, '문항 설정이 변경되었습니다. 진행자에게 문의해 주세요.'],
  ENDED: [409, '퀴즈가 종료되어 더 이상 제출할 수 없습니다.'],
  NOT_STARTED: [409, '아직 퀴즈가 시작되지 않았습니다.'],
  UNKNOWN_PARTICIPANT: [401, '참가 정보를 찾을 수 없습니다. 같은 브라우저에서 다시 접속해 주세요.'],
  ADMISSION_CLOSED: [403, '시작 후에는 새로 참여할 수 없습니다. 기존 참가자는 참여했던 브라우저를 이용해 주세요.'],
  OUT_OF_ORDER: [409, '앞 문항부터 순서대로 제출해 주세요.'],
  ANSWER_LOCKED: [409, '이미 제출한 답은 수정할 수 없습니다.'],
  INVALID_ANSWER: [400, '문항과 답을 확인해 주세요.']
};

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
function failure(res, code, status = 400, message = '요청을 확인해 주세요.') {
  const known = errors[code];
  send(res, known?.[0] || status, { error: { code, message: known?.[1] || message } });
}
async function readBody(req) {
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 4096) throw new Error('BODY_TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 4096) throw new Error('BODY_TOO_LARGE');
  if (typeof body === 'string') body = JSON.parse(body || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_BODY');
  return body;
}

// A whitelist projection is the only way questions leave the server.
function participantView(result, config) {
  const submitted = result.submitted;
  const current = result.status === 'running' && submitted < config.total ? data.questions[submitted] : null;
  return { eventId: config.eventId, status: result.status, submitted, total: config.total, isTest: data.isTest,
    question: current ? { id: current.id, prompt: current.prompt, options: current.options } : null };
}
function withRate(row) {
  return { ...row, rate: row.submitted ? (row.correct / row.submitted * 100).toFixed(1) : null };
}

function createHandler({ env = process.env, command } = {}) {
  return async function quizHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const config = getConfig(env);
      const parsed = new URL(req.url, 'http://localhost');
      // Vercel rewrites to /api/quiz?quizPath=...; local dev uses the original URL.
      // Both entry points use this exact allowlist and the same authorization.
      let path = parsed.pathname.replace(/\/$/, '');
      if (path === '/api/quiz') {
        const rewritten = req.query?.quizPath || parsed.searchParams.get('quizPath');
        if (typeof rewritten === 'string') path = `/api/quiz/${rewritten}`;
      }
      const methods = {
        '/api/quiz/public': 'GET', '/api/quiz/session': 'POST', '/api/quiz/answer': 'POST',
        '/api/quiz/admin/login': 'POST', '/api/quiz/admin/logout': 'POST',
        '/api/quiz/admin/stats': 'GET', '/api/quiz/admin/control': 'POST', '/api/quiz/admin/qr': 'GET'
      };
      if (!methods[path]) return failure(res, 'NOT_FOUND', 404);
      if (req.method !== methods[path]) {
        res.setHeader('Allow', methods[path]);
        return failure(res, 'METHOD_NOT_ALLOWED', 405);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.method === 'POST' && req.headers.origin !== config.origin)) {
        return failure(res, 'ORIGIN_REJECTED', 403, '같은 사이트에서 다시 접속해 주세요.');
      }
      if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
        return failure(res, 'JSON_REQUIRED', 415);
      }
      const adminRoute = path.startsWith('/api/quiz/admin/') && path !== '/api/quiz/admin/login';
      if (adminRoute && !isAdmin(req, config)) return failure(res, 'AUTH_REQUIRED', 401, '진행자 로그인이 필요합니다.');
      const store = createStore(config, command);
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (path === '/api/quiz/admin/login') {
        // Vercel supplies x-vercel-forwarded-for; local dev falls back to socket IP.
        const ip = req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
        if (!await store.allowLogin(sha256(`${config.sessionSecret}:${ip}`))) {
          res.setHeader('Retry-After', '600');
          return failure(res, 'RATE_LIMITED', 429, '로그인 시도가 많습니다. 10분 후 다시 시도해 주세요.');
        }
        if (!await verifyPassword(body.password, config)) return failure(res, 'LOGIN_FAILED', 401, '비밀번호를 확인해 주세요.');
        res.setHeader('Set-Cookie', cookie(config, createSession(config)));
        return send(res, 200, { authenticated: true });
      }
      if (path === '/api/quiz/admin/logout') {
        res.setHeader('Set-Cookie', cookie(config));
        return send(res, 200, { authenticated: false });
      }
      if (path === '/api/quiz/admin/qr') {
        const svg = await require('qrcode').toString(`${config.origin}/quiz`, { type: 'svg', margin: 4, width: 256,
          errorCorrectionLevel: 'M', color: { dark: '#201D13', light: '#FFF6DA' } });
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.statusCode = 200;
        return res.end(svg);
      }
      let result;
      if (path === '/api/quiz/public') {
        result = await store.run('public');
        if (result.error) return failure(res, result.error);
        return send(res, 200, { eventId: config.eventId, status: result.status, total: config.total, isTest: data.isTest });
      }
      if (path === '/api/quiz/admin/stats') {
        result = await store.run('stats');
        if (result.error) return failure(res, result.error);
        return send(res, 200, { ...result, questions: result.questions.map(withRate), overall: withRate(result.overall),
          joinUrl: `${config.origin}/quiz`, isTest: data.isTest, onlineWindowSeconds: 45 });
      }
      if (path === '/api/quiz/admin/control') {
        if (!['start', 'end'].includes(body.action)) return failure(res, 'INVALID_ACTION');
        result = await store.run(body.action);
      } else {
        const pid = participantId(req);
        if (!pid) return failure(res, 'PARTICIPANT_REQUIRED', 401, '참가 ID를 확인할 수 없습니다.');
        if (path === '/api/quiz/answer') {
          if (!Number.isInteger(body.questionId) || body.questionId < 1 || body.questionId > config.total ||
            !Number.isInteger(body.choice) || body.choice < 1 || body.choice > 4) return failure(res, 'INVALID_ANSWER');
          result = await store.run('answer', pid, body.questionId, body.choice, data.questions[body.questionId - 1].correct);
        } else result = await store.run('session', pid);
        if (result.error) return failure(res, result.error);
        return send(res, 200, participantView(result, config));
      }
      if (result.error) return failure(res, result.error);
      return send(res, 200, result);
    } catch (error) {
      if (error instanceof SyntaxError || ['INVALID_BODY', 'BODY_TOO_LARGE'].includes(error.message)) {
        return failure(res, 'INVALID_BODY', error.message === 'BODY_TOO_LARGE' ? 413 : 400);
      }
      // Do not log request bodies, answers, tokens, or existing-site telemetry.
      return failure(res, 'UNAVAILABLE', 503, '연결을 확인하고 다시 시도해 주세요. 계속되면 진행자에게 알려 주세요.');
    }
  };
}

module.exports = { createHandler, participantView, withRate };
