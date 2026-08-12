const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { dirname, join } = require('path');

const projectRoot = join(__dirname, '..');
const sourceRoot = join(projectRoot, '..', 'source');
const publicAssets = join(projectRoot, 'public', 'assets');
const assets = [
  { source: 'schedule.png', target: 'images/schedule.png', optional: true },
  { source: 'num.svg', target: 'images/num.svg', optional: false },
  { source: 'edit.svg', target: 'icons/edit.svg', optional: false },
  { source: 're.svg', target: 'icons/re.svg', optional: false }
];

for (const asset of assets) {
  const source = join(sourceRoot, asset.source);
  const target = join(publicAssets, asset.target);

  if (existsSync(source)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    console.log(`Synced source/${asset.source}.`);
  } else if (asset.optional) {
    console.log(`source/${asset.source} not found; the fallback UI remains active.`);
  } else {
    throw new Error(`Required source asset is missing: source/${asset.source}`);
  }
}
