function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) {
    const error = new Error(`Missing required environment variable: ${name}`);
    error.statusCode = 500;
    error.code = 'CONFIG_ERROR';
    throw error;
  }
  return value;
}

function requiredSecret(name, minLength = 32) {
  const value = requiredEnv(name);
  if (value.length < minLength || value.includes('replace-')) {
    const error = new Error(`${name} must be at least ${minLength} characters and must not be a placeholder`);
    error.statusCode = 500;
    error.code = 'CONFIG_ERROR';
    throw error;
  }
  return value;
}

function positiveIntegerEnv(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return fallback;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function getStampRequirement() {
  return 9;
}

function getPoolMax() {
  return positiveIntegerEnv('PG_POOL_MAX', 10, 100);
}

function getPrizePassword() {
  return String(process.env.PRIZE_PASSWORD || '0000').trim() || '0000';
}

function getAllowedOrigin() {
  const configured = (process.env.ALLOWED_ORIGIN || '*').trim();
  if (configured === '*') return '*';

  try {
    const url = new URL(configured);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '*';
  } catch (error) {
    return '*';
  }
}

module.exports = {
  requiredEnv,
  requiredSecret,
  positiveIntegerEnv,
  getStampRequirement,
  getPoolMax,
  getPrizePassword,
  getAllowedOrigin
};
