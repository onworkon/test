'use strict';
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const root = join(__dirname, '..', '..');
// Rebuild the existing card asset, then add only the isolated quiz static files.
execFileSync(process.execPath, ['scripts/build-card.mjs'], { cwd: root, stdio: 'inherit' });
for (const file of ['dist/index.html', 'dist/card.html', 'dist/welcome.js', 'api/names.js', 'api/quiz.js']) {
  if (!existsSync(join(root, file))) throw new Error(`Missing required site file: ${file}`);
}
cpSync(join(root, 'quiz', 'public'), join(root, 'dist', 'quiz'), { recursive: true });
console.log('Existing site and isolated quiz static files are ready.');
