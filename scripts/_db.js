const { Pool } = require('pg');
const { required } = require('./_env');
const { normalizedConnectionString } = require('../server/api/_db');

function createPool() {
  const connectionString = required('DATABASE_URL');
  const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false';
  const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
  const needsSsl =
    ['require', 'verify-ca', 'verify-full'].includes(sslMode) ||
    /[?&]sslmode=(require|verify-ca|verify-full)(?:&|$)/i.test(connectionString);

  return new Pool({
    connectionString: normalizedConnectionString(connectionString, rejectUnauthorized),
    ssl: needsSsl
      ? { rejectUnauthorized }
      : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });
}

module.exports = {
  createPool
};
