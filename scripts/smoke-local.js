const { spawn } = require('child_process');
const http = require('http');
const { join } = require('path');

const root = join(__dirname, '..');
const port = Number.parseInt(process.env.SMOKE_PORT || '3100', 10);

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        timeout: 5000
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out: ${path}`));
    });
    req.on('error', reject);
    req.end();
  });
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local server did not start in time')), 8000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (text.includes('local server')) {
        clearTimeout(timer);
        resolve();
      }
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Local server exited early with code ${code}`));
    });
  });
}

async function main() {
  const child = spawn(process.execPath, ['scripts/local-dev.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);

    const checks = [
      { path: '/', status: 307, location: '/start' },
      { path: '/start', status: 200 },
      { path: '/map', status: 200 },
      { path: '/stamp', status: 200 },
      { path: '/reward', status: 307, location: '/stamp' },
      { path: '/schedule', status: 200 },
      { path: '/js/analytics.js', status: 200 },
      { path: '/manager', status: 200 },
      { path: '/admin', status: 200 },
      { path: '/prize', status: 200 },
      { path: '/api/ping', status: 200 },
      { path: '/api/ping', method: 'OPTIONS', status: 204 },
      { path: '/api/ping', method: 'POST', status: 405 },
      { path: '/start', method: 'POST', status: 405 },
      { path: '/..%5cpackage.json', status: 404 },
      { path: '/%E0%A4%A', status: 404 },
      { path: '/api/admin/tags', status: 401 },
      { path: '/api/admin/readiness', status: 401 },
      { path: '/api/admin/export', status: 401 },
      { path: '/api/admin/tags/test-tag', method: 'DELETE', status: 401 },
      { path: '/api/users/activity', method: 'POST', status: 401 },
      { path: '/api/auth/prize-session', status: 401 },
      { path: '/api/prize/user?uid=1', status: 401 },
      { path: '/api/reward/claim', method: 'POST', status: 401 }
    ];

    for (const check of checks) {
      const response = await request(check.path, check.method || 'GET');
      if (response.statusCode !== check.status) {
        throw new Error(`${check.path} returned ${response.statusCode}, expected ${check.status}`);
      }
      if (check.location && response.headers.location !== check.location) {
        throw new Error(
          `${check.path} redirected to ${response.headers.location || 'nowhere'}, expected ${check.location}`
        );
      }

      if (!response.headers['x-content-type-options']) {
        throw new Error(`${check.path} did not include security headers`);
      }
      const csp = response.headers['content-security-policy'] || '';
      if (csp.includes("'unsafe-inline'")) {
        throw new Error(`${check.path} allows inline styles or scripts`);
      }
    }

    console.log(`Smoke checked ${checks.length} routes.`);
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
