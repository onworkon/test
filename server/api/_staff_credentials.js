function parseManagerLoginCode(value) {
  const normalized = String(value || '').trim().replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;

  const codeNumber = Number(normalized.slice(0, 2));
  if (!Number.isInteger(codeNumber) || codeNumber < 1 || codeNumber > 99) return null;

  return {
    normalized,
    codeNumber,
    password: normalized.slice(2)
  };
}

module.exports = {
  parseManagerLoginCode
};
