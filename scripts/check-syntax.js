const { existsSync, readFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');
const ignored = new Set(['node_modules', '.vercel']);
const files = [];
const projectFiles = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignored.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
    } else if (name.endsWith('.js')) {
      files.push(path);
    }
    if (!stat.isDirectory()) projectFiles.push(path);
  }
}

walk(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status);
  }
}

for (const fileName of ['package.json', 'vercel.json']) {
  const path = join(root, fileName);
  JSON.parse(readFileSync(path, 'utf8'));
}

for (const file of projectFiles.filter((path) => path.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  if (!/^<!doctype html>/i.test(html) || !html.includes('</html>')) {
    throw new Error(`HTML document is incomplete: ${file}`);
  }
  if (/\son[a-z]+\s*=|\sstyle\s*=/i.test(html)) {
    throw new Error(`Inline event handlers or styles are not allowed: ${file}`);
  }

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`HTML document contains duplicate IDs: ${file}`);
  }

  for (const match of html.matchAll(/\s(?:src|href)="(\/(?:css|js|assets)\/[^"?#]+)"/g)) {
    const assetPath = join(root, 'public', ...match[1].slice(1).split('/'));
    if (!existsSync(assetPath)) {
      throw new Error(`Referenced asset does not exist: ${match[1]} (${file})`);
    }
  }
}

for (const file of projectFiles.filter((path) => path.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8');
  const opening = (css.match(/{/g) || []).length;
  const closing = (css.match(/}/g) || []).length;
  if (opening !== closing) {
    throw new Error(`CSS braces are unbalanced: ${file}`);
  }
}

const browserJavaScript = projectFiles
  .filter((path) => path.includes(`${require('path').sep}public${require('path').sep}js${require('path').sep}`))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
if (/\sstyle\s*=/.test(browserJavaScript)) {
  throw new Error('Browser templates must not use inline styles under the project CSP.');
}

const migrationsDir = join(root, 'db', 'migrations');
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
if (migrationFiles.some((name) => !/^\d+_.+\.sql$/.test(name))) {
  throw new Error('Database migrations must use the format <number>_<name>.sql.');
}
const migrationVersions = migrationFiles
  .map((name) => name.match(/^(\d+)_/))
  .map((match) => match[1]);
if (new Set(migrationVersions).size !== migrationVersions.length) {
  throw new Error('Database migration numeric prefixes must be unique.');
}

console.log(`Checked ${files.length} JavaScript files and project structure.`);
