const { createServer } = require('http');
const { existsSync, readFileSync, statSync } = require('fs');
const { extname, isAbsolute, join, relative, sep } = require('path');
const { loadEnv } = require('./_env');
const { positiveIntegerEnv } = require('../server/api/_config');

const root = join(__dirname, '..');
const publicDir = join(root, 'public');
const apiDir = join(root, 'server', 'api');

loadEnv(root);

const port = positiveIntegerEnv('PORT', 3000, 65535);

const exactApiRoutes = new Map([
  ['/api/auth/user-login', 'auth/user-login.js'],
  ['/api/auth/login', 'auth/login.js'],
  ['/api/auth/prize-login', 'auth/prize-login.js'],
  ['/api/auth/prize-session', 'auth/prize-session.js'],
  ['/api/users/me', 'users/me.js'],
  ['/api/users/activity', 'users/activity.js'],
  ['/api/dashboard', 'dashboard.js'],
  ['/api/booths', 'booths.js'],
  ['/api/stamps', 'stamps.js'],
  ['/api/reward/claim', 'reward/claim.js'],
  ['/api/prize/user', 'prize/user.js'],
  ['/api/notices', 'notices.js'],
  ['/api/ping', 'ping.js'],
  ['/api/manager/booth', 'manager/booth.js'],
  ['/api/manager/totp', 'manager/totp.js'],
  ['/api/staff/password', 'staff/password.js'],
  ['/api/admin/stats', 'admin/stats.js'],
  ['/api/admin/logs', 'admin/logs.js'],
  ['/api/admin/readiness', 'admin/readiness.js'],
  ['/api/admin/export', 'admin/export.js'],
  ['/api/admin/tags', 'admin/tags.js'],
  ['/api/admin/notice', 'admin/notice.js'],
  ['/api/admin/booths/close-all', 'admin/booths/close-all.js']
]);

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

function setLocalSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  );
}

function serveFile(req, res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', getMimeType(filePath));
  res.setHeader('Cache-Control', 'no-cache');
  res.end(req.method === 'HEAD' ? undefined : readFileSync(filePath));
}

function resolveStatic(pathname) {
  if (pathname === '/') return join(publicDir, 'index.html');
  if (['/start', '/map', '/stamp', '/reward', '/schedule'].includes(pathname)) {
    return join(publicDir, 'user.html');
  }
  if (pathname === '/manager') return join(publicDir, 'manager.html');
  if (pathname === '/admin') return join(publicDir, 'admin.html');
  if (pathname === '/prize') return join(publicDir, 'prize.html');

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    return null;
  }

  const filePath = join(publicDir, decodedPath.replace(/^\/+/, ''));
  const rel = relative(publicDir, filePath);

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }

  return filePath;
}

function resolveApi(pathname) {
  if (exactApiRoutes.has(pathname)) {
    return {
      file: join(apiDir, exactApiRoutes.get(pathname)),
      query: {}
    };
  }

  let match = pathname.match(/^\/api\/booths\/([^/]+)$/);
  if (match) {
    const boothId = decodePathSegment(match[1]);
    if (boothId === null) return null;
    return {
      file: join(apiDir, 'booths', '[booth_id].js'),
      query: { booth_id: boothId }
    };
  }

  match = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (match) {
    const uid = decodePathSegment(match[1]);
    if (uid === null) return null;
    return {
      file: join(apiDir, 'admin', 'users', '[uid].js'),
      query: { uid }
    };
  }

  match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reward$/);
  if (match) {
    const uid = decodePathSegment(match[1]);
    if (uid === null) return null;
    return {
      file: join(apiDir, 'admin', 'users', '[uid]', 'reward.js'),
      query: { uid }
    };
  }

  match = pathname.match(/^\/api\/admin\/tags\/([^/]+)$/);
  if (match) {
    const tagUid = decodePathSegment(match[1]);
    if (tagUid === null) return null;
    return {
      file: join(apiDir, 'admin', 'tags', '[tag_uid].js'),
      query: { tag_uid: tagUid }
    };
  }

  return null;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return null;
  }
}

async function handleApi(req, res, pathname, searchParams) {
  const route = resolveApi(pathname);
  if (!route) {
    sendText(res, 404, 'API route not found');
    return;
  }

  req.query = Object.fromEntries(searchParams.entries());
  Object.assign(req.query, route.query);

  try {
    delete require.cache[require.resolve(route.file)];
    const handler = require(route.file);
    await handler(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        success: false,
        error: {
          code: 'LOCAL_DEV_ERROR',
          message: 'Local server failed to run API handler'
        }
      }));
    }
  }
}

async function handleRequest(req, res) {
  setLocalSecurityHeaders(res);

  let requestUrl;
  try {
    requestUrl = new URL(req.url, 'http://localhost');
  } catch (error) {
    sendText(res, 400, 'Invalid request URL');
    return;
  }

  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname, requestUrl.searchParams);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const filePath = resolveStatic(pathname);
  if (!filePath) {
    sendText(res, 404, 'Not found');
    return;
  }

  serveFile(req, res, filePath);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendText(res, 500, 'Local server error');
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

function startServer() {
  server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

  server.listen(port, () => {
    console.log(`JSFes NFC local server: http://localhost:${port}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  getMimeType,
  resolveApi,
  resolveStatic,
  startServer
};
