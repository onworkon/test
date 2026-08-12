const { URL } = require('url');
const { sendError, handleApiError } = require('../server/api/_http');

const exactRoutes = new Map([
  ['/api/auth/user-login', require('../server/api/auth/user-login')],
  ['/api/auth/login', require('../server/api/auth/login')],
  ['/api/auth/prize-login', require('../server/api/auth/prize-login')],
  ['/api/auth/prize-session', require('../server/api/auth/prize-session')],
  ['/api/users/me', require('../server/api/users/me')],
  ['/api/users/activity', require('../server/api/users/activity')],
  ['/api/dashboard', require('../server/api/dashboard')],
  ['/api/booths', require('../server/api/booths')],
  ['/api/stamps', require('../server/api/stamps')],
  ['/api/reward/claim', require('../server/api/reward/claim')],
  ['/api/prize/user', require('../server/api/prize/user')],
  ['/api/notices', require('../server/api/notices')],
  ['/api/ping', require('../server/api/ping')],
  ['/api/manager/booth', require('../server/api/manager/booth')],
  ['/api/manager/totp', require('../server/api/manager/totp')],
  ['/api/staff/password', require('../server/api/staff/password')],
  ['/api/admin/stats', require('../server/api/admin/stats')],
  ['/api/admin/logs', require('../server/api/admin/logs')],
  ['/api/admin/readiness', require('../server/api/admin/readiness')],
  ['/api/admin/export', require('../server/api/admin/export')],
  ['/api/admin/tags', require('../server/api/admin/tags')],
  ['/api/admin/notice', require('../server/api/admin/notice')],
  ['/api/admin/booths/close-all', require('../server/api/admin/booths/close-all')]
]);

const dynamicRoutes = [
  {
    pattern: /^\/api\/booths\/([^/]+)$/,
    parameter: 'booth_id',
    handler: require('../server/api/booths/[booth_id]')
  },
  {
    pattern: /^\/api\/admin\/users\/([^/]+)$/,
    parameter: 'uid',
    handler: require('../server/api/admin/users/[uid]')
  },
  {
    pattern: /^\/api\/admin\/users\/([^/]+)\/reward$/,
    parameter: 'uid',
    handler: require('../server/api/admin/users/[uid]/reward')
  },
  {
    pattern: /^\/api\/admin\/tags\/([^/]+)$/,
    parameter: 'tag_uid',
    handler: require('../server/api/admin/tags/[tag_uid]')
  }
];

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return null;
  }
}

function resolveRoute(pathname) {
  const exactHandler = exactRoutes.get(pathname);
  if (exactHandler) return { handler: exactHandler, query: {} };

  for (const route of dynamicRoutes) {
    const match = pathname.match(route.pattern);
    if (!match) continue;
    const value = decodePathSegment(match[1]);
    if (value === null) return null;
    return {
      handler: route.handler,
      query: { [route.parameter]: value }
    };
  }

  return null;
}

module.exports = async function gateway(req, res) {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = parsedUrl.pathname;
    const catchAllPath = req.query && req.query.path;

    if (catchAllPath) {
      const segments = Array.isArray(catchAllPath) ? catchAllPath : [catchAllPath];
      pathname = `/api/${segments.join('/')}`;
    }

    const route = resolveRoute(pathname);
    if (!route) {
      sendError(res, 404, 'API_NOT_FOUND', 'API route was not found');
      return;
    }

    req.query = {
      ...Object.fromEntries(parsedUrl.searchParams.entries()),
      ...(req.query || {}),
      ...route.query
    };
    delete req.query.path;

    await route.handler(req, res);
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.resolveRoute = resolveRoute;
