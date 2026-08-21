const { getAllowedOrigin } = require('./_config');
const { captureException, flushMonitoring } = require('./_monitoring');

const MAX_JSON_BODY_BYTES = 16 * 1024;

function setCommonHeaders(res) {
  const allowedOrigin = getAllowedOrigin();
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

function allowMethods(req, res, methods) {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
    res.statusCode = 204;
    res.end();
    return false;
  }

  if (!methods.includes(req.method)) {
    res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '));
    sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    return false;
  }

  return true;
}

function sendJson(res, statusCode, payload, options = {}) {
  setCommonHeaders(res);
  if (options.cacheControl) res.setHeader('Cache-Control', options.cacheControl);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extra = {}) {
  sendJson(res, statusCode, {
    success: false,
    error: {
      ...extra,
      code,
      message
    }
  });
}

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readJson(req) {
  const declaredLength = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw httpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
  }

  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength > MAX_JSON_BODY_BYTES) {
      throw httpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    }
    return parseJsonObject(req.body.toString('utf8'));
  }

  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    const body = ensureJsonObject(req.body);
    let serialized;
    try {
      serialized = JSON.stringify(body);
    } catch (error) {
      throw httpError(400, 'INVALID_BODY', 'Request body must be a JSON object');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BODY_BYTES) {
      throw httpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    }
    return body;
  }

  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_JSON_BODY_BYTES) {
      throw httpError(413, 'BODY_TOO_LARGE', 'Request body is too large');
    }
    return parseJsonObject(req.body);
  }

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength > MAX_JSON_BODY_BYTES) {
        settled = true;
        reject(httpError(413, 'BODY_TOO_LARGE', 'Request body is too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (!settled) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });

  return parseJsonObject(raw);
}

function ensureJsonObject(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw httpError(400, 'INVALID_BODY', 'Request body must be a JSON object');
  }
  return value;
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    return ensureJsonObject(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === 'INVALID_BODY') throw error;
    throw httpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

function getQueryParam(req, name) {
  const value = req.query && req.query[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function handleApiError(res, error) {
  if (res.headersSent || res.writableEnded) {
    captureException(error);
    console.error(error);
    await flushMonitoring();
    return;
  }

  if (error && error.statusCode && error.code) {
    if (error.statusCode >= 500) {
      captureException(error, { errorCode: error.code });
      console.error(error);
    }
    sendError(res, error.statusCode, error.code, error.message);
    if (error.statusCode >= 500) await flushMonitoring();
    return;
  }

  captureException(error);
  console.error(error);
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  await flushMonitoring();
}

module.exports = {
  setCommonHeaders,
  allowMethods,
  sendJson,
  sendError,
  readJson,
  getQueryParam,
  handleApiError,
  httpError
};
