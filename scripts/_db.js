const { Pool } = require('pg');
const { required } = require('./_env');

function createPool() {
  const connectionString = required('DATABASE_URL');
  const needsSsl =
    process.env.PGSSLMODE === 'require' ||
    connectionString.includes('sslmode=require');

  return new Pool({
    connectionString,
    ssl: needsSsl
      ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });
}

module.exports = {
  createPool
};
