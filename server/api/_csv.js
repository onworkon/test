const { setCommonHeaders } = require('./_http');

function escapeCsvCell(value) {
  if (value === undefined || value === null) return '';

  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.map((header) => escapeCsvCell(header.label)).join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header.key])).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

function sendCsv(res, fileName, headers, rows) {
  setCommonHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.end(toCsv(headers, rows));
}

module.exports = {
  escapeCsvCell,
  toCsv,
  sendCsv
};
