function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizeTagUid(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s:-]/g, '');
}

function parseUid(value) {
  const text = typeof value === 'number' ? String(value) : cleanText(value, 20);
  if (!/^\d{1,3}$/.test(text)) return null;

  const uid = Number(text);
  return Number.isInteger(uid) && uid >= 0 && uid <= 500 ? uid : null;
}

function isValidPassword(value, minimumLength = 8) {
  if (typeof value !== 'string') return false;
  const byteLength = Buffer.byteLength(value, 'utf8');
  return value.length >= minimumLength && byteLength <= 72;
}

module.exports = {
  cleanText,
  normalizeTagUid,
  parseUid,
  isValidPassword
};
