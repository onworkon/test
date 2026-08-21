const { copyFileSync, existsSync, mkdirSync, readdirSync } = require('fs');
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

const sourceStamps = join(sourceRoot, 'stamp');
const publicStamps = join(publicAssets, 'stamps');

if (existsSync(sourceStamps)) {
  const stampTargets = new Map();

  for (const fileName of readdirSync(sourceStamps)) {
    const match = fileName.match(/^(\d{1,2})\.webp$/i);
    if (!match) continue;

    const stampNumber = Number(match[1]);
    if (stampNumber < 1 || stampNumber > 99) {
      throw new Error(`Stamp asset number must be between 1 and 99: source/stamp/${fileName}`);
    }

    const targetName = `${String(stampNumber).padStart(2, '0')}.webp`;
    if (stampTargets.has(targetName)) {
      throw new Error(
        `Duplicate stamp assets map to ${targetName}: ${stampTargets.get(targetName)} and ${fileName}`
      );
    }
    stampTargets.set(targetName, fileName);
  }

  mkdirSync(publicStamps, { recursive: true });
  for (const [targetName, fileName] of [...stampTargets.entries()].sort()) {
    copyFileSync(join(sourceStamps, fileName), join(publicStamps, targetName));
  }
  console.log(`Synced ${stampTargets.size} stamp assets from source/stamp/.`);
}
