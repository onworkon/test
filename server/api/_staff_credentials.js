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

function staffAccountIdForRole(role, codeNumber) {
  if (role === 'admin') return 0;
  if (role !== 'manager') return null;

  const normalizedCodeNumber = Number(codeNumber);
  if (
    !Number.isInteger(normalizedCodeNumber) ||
    normalizedCodeNumber < 1 ||
    normalizedCodeNumber > 99
  ) {
    return null;
  }

  return normalizedCodeNumber;
}

module.exports = {
  parseManagerLoginCode,
  staffAccountIdForRole
};
