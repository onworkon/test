const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return null;

  const index = trimmed.indexOf('=');
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? { key, value } : null;
}

function loadEnv(root) {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = join(root, fileName);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const entry = parseEnvLine(line);
      if (entry && process.env[entry.key] === undefined) {
        process.env[entry.key] = entry.value;
      }
    }
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Add it to .env.local or the environment.`);
  }
  return value;
}

module.exports = {
  loadEnv,
  required
};
