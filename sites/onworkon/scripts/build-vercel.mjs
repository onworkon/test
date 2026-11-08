import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import './build-card.mjs';

const root = new URL('../', import.meta.url);
for (const file of ['dist/index.html', 'dist/styles.css', 'dist/welcome.js', 'dist/welcome-flow.js', 'dist/workspace.html', 'dist/card.html', 'dist/work.html', 'dist/client.html', 'dist/about.html', 'dist/portfolio.html', 'dist/contact.html', 'dist/name-validation.js', 'dist/assets/logo.svg', 'dist/assets/PPSupplyMono-Regular.otf', 'dist/assets/Pretendard-Regular.woff2', 'dist/assets/Pretendard-LICENSE.txt', 'api/names.js']) {
  await access(new URL(file, root));
}
const html = await readFile(new URL('dist/index.html', root), 'utf8');
for (const file of ['dist/page-navigation.js', 'dist/page-routes.js', 'dist/card.css', 'dist/card-loader.js', 'dist/card-viewer.js', 'dist/assets/card-front.png', 'dist/assets/card-back.png', 'dist/assets/three-LICENSE.txt']) {
  await access(new URL(file, root));
}
if (!html.includes('welcome.js')) throw new Error('The welcome entrypoint is missing.');

if (process.env.VERCEL) {
  if (!process.env.DATABASE_URL) throw new Error('Connect the name database before deploying.');
  execFileSync(process.execPath, ['scripts/migrate-postgres.mjs'], { cwd: root, stdio: 'inherit' });
}
console.log('Static page and name API are ready for Vercel.');
