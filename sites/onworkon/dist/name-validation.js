export function normalizeName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

export function validName(value) {
  const name = normalizeName(value);
  return name.length > 0 && name.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(name);
}