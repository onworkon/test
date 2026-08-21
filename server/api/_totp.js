const crypto = require('crypto');
const speakeasy = require('speakeasy');
const { requiredSecret } = require('./_config');

const STEP_SECONDS = 3600;
const DIGITS = 4;
const WINDOW = 0;
const PREVIOUS_STEP_GRACE_SECONDS = 30;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MAX_GENERATION = 9223372036854775807n;

function base32Encode(buffer) {
  let bits = '';
  let output = '';

  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }

  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }

  return output;
}

function normalizeGeneration(generation = 0) {
  const value = String(generation ?? 0).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error('Booth code generation must be a non-negative integer');
  }

  const normalized = value.replace(/^0+(?=\d)/, '');
  if (BigInt(normalized) > MAX_GENERATION) {
    throw new Error('Booth code generation exceeds the database limit');
  }

  return normalized;
}

function getDerivedSecret(boothId, generation = 0) {
  const normalizedGeneration = normalizeGeneration(generation);
  const secretScope = normalizedGeneration === '0'
    ? String(boothId)
    : `${boothId}\0${normalizedGeneration}`;
  const digest = crypto
    .createHmac('sha256', requiredSecret('MASTER_SECRET'))
    .update(secretScope)
    .digest();

  return base32Encode(digest);
}

function getCurrentStep(nowMs = Date.now()) {
  return Math.floor(Math.floor(nowMs / 1000) / STEP_SECONDS);
}

function getTotpInfo(boothId, nowMs = Date.now(), generation = 0) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const currentStep = getCurrentStep(nowMs);
  const expiresAtSeconds = (currentStep + 1) * STEP_SECONDS;
  const normalizedGeneration = normalizeGeneration(generation);
  const secret = getDerivedSecret(boothId, normalizedGeneration);
  const code = speakeasy.totp({
    secret,
    encoding: 'base32',
    digits: DIGITS,
    step: STEP_SECONDS,
    time: nowSeconds
  });

  return {
    code,
    generation: normalizedGeneration,
    timeStep: currentStep,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    secondsRemaining: Math.max(0, expiresAtSeconds - nowSeconds)
  };
}

function getCompositeTotpInfo(boothId, codeNumber, nowMs = Date.now(), generation = 0) {
  const numericCode = Number(codeNumber);
  if (!Number.isInteger(numericCode) || numericCode < 1 || numericCode > 99) {
    throw new Error('Booth code number must be an integer between 1 and 99');
  }

  const totp = getTotpInfo(boothId, nowMs, generation);
  const boothCode = String(numericCode).padStart(2, '0');

  return {
    ...totp,
    boothCode,
    entryCode: `${boothCode}${totp.code}`,
    displayCode: `${boothCode}-${totp.code}`
  };
}

function parseCompositeTotpCode(value) {
  const normalized = String(value || '').trim().replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;

  const codeNumber = Number(normalized.slice(0, 2));
  if (!Number.isInteger(codeNumber) || codeNumber < 1 || codeNumber > 99) return null;

  return {
    normalized,
    codeNumber,
    code: normalized.slice(2)
  };
}

function verifyTotpCode(boothId, code, nowMs = Date.now(), generation = 0) {
  const token = String(code || '').trim();

  if (!/^\d{4}$/.test(token)) {
    return { valid: false };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  const verificationOptions = {
    secret: getDerivedSecret(boothId, generation),
    encoding: 'base32',
    token,
    digits: DIGITS,
    step: STEP_SECONDS,
    window: WINDOW,
    time: nowSeconds
  };
  const delta = speakeasy.totp.verifyDelta(verificationOptions);

  if (delta) {
    return {
      valid: true,
      timeStep: getCurrentStep(nowMs) + delta.delta
    };
  }

  // Allow only a short post-boundary grace period for a code submitted just before expiry.
  if (nowSeconds % STEP_SECONDS < PREVIOUS_STEP_GRACE_SECONDS) {
    const previousDelta = speakeasy.totp.verifyDelta({
      ...verificationOptions,
      time: nowSeconds - STEP_SECONDS
    });
    if (previousDelta) {
      return {
        valid: true,
        timeStep: getCurrentStep(nowMs) - 1
      };
    }
  }

  return { valid: false };
}

function getReissuedCompositeTotpInfo(boothId, codeNumber, currentGeneration, nowMs = Date.now()) {
  const normalizedGeneration = normalizeGeneration(currentGeneration);
  const acceptedOldCodes = new Set();

  const earliestDelta = Math.floor(nowMs / 1000) % STEP_SECONDS < PREVIOUS_STEP_GRACE_SECONDS
    ? -1
    : -WINDOW;
  for (let delta = earliestDelta; delta <= WINDOW; delta += 1) {
    const adjacentTime = nowMs + (delta * STEP_SECONDS * 1000);
    acceptedOldCodes.add(getTotpInfo(boothId, adjacentTime, normalizedGeneration).code);
  }

  let nextGeneration = BigInt(normalizedGeneration) + 1n;
  for (let attempt = 0; attempt < 1000 && nextGeneration <= MAX_GENERATION; attempt += 1) {
    const candidateGeneration = nextGeneration.toString();
    const oldCodeStillValid = [...acceptedOldCodes].some((oldCode) => (
      verifyTotpCode(boothId, oldCode, nowMs, candidateGeneration).valid
    ));

    if (!oldCodeStillValid) {
      return getCompositeTotpInfo(boothId, codeNumber, nowMs, candidateGeneration);
    }

    nextGeneration += 1n;
  }

  throw new Error('Booth code generation is exhausted');
}

module.exports = {
  getCompositeTotpInfo,
  getReissuedCompositeTotpInfo,
  getTotpInfo,
  parseCompositeTotpCode,
  verifyTotpCode
};
