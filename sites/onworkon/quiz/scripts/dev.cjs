'use strict';
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, join, sep, extname } = require('node:path');
const { createHandler } = require('../server/handler');
const root = resolve(__dirname, '..', '..');
const quiz = createHandler();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.otf': 'font/otf' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/quiz' || url.pathname.startsWith('/api/quiz/')) return quiz(req, res);
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  const isQuiz = path === '/quiz' || path.startsWith('/quiz/');
  const directory = isQuiz ? join(root, 'quiz', 'public') : join(root, 'dist');
  if (isQuiz) {
    path = path.replace(/^\/quiz\/?/, '');
    path = path === '' ? 'index.html' : ['admin', 'admin/'].includes(path) ? 'admin.html' : path;
  } else path = path === '/' ? 'index.html' : path.slice(1);
  const file = resolve(directory, path);
  if (!file.startsWith(directory + sep)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end(); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Quiz local server: http://127.0.0.1:${server.address().port}`));
