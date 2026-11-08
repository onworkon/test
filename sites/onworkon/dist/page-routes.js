const destinations = new Map([
  ['home', './'],
  ['card', './card.html'],
  ['work', './work.html'],
  ['client', './workspace.html'],
  ['about', './about.html'],
  ['portfolio', './portfolio.html'],
  ['contact', './contact.html'],
]);

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolvePageCode(value) {
  return destinations.get(normalizeCode(value)) ?? null;
}

export function resolveInvitationCode(value) {
  const code = normalizeCode(value);
  return ['card', 'work', 'client'].includes(code) ? destinations.get(code) : null;
}
