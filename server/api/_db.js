const { Pool } = require('pg');
const { attachDatabasePool } = require('@vercel/functions');
const { getPoolMax } = require('./_config');

let pool;

function normalizedConnectionString(connectionString, rejectUnauthorized) {
  return connectionString.replace(
    /([?&])sslmode=(prefer|require|verify-ca)(?=(&|$))/i,
    `$1sslmode=${rejectUnauthorized ? 'verify-full' : 'no-verify'}`
  );
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      const error = new Error('DATABASE_URL is not configured');
      error.statusCode = 500;
      error.code = 'CONFIG_ERROR';
      throw error;
    }

    const rejectUnauthorized = process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false';
    const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
    const needsSsl =
      ['require', 'verify-ca', 'verify-full'].includes(sslMode) ||
      /[?&]sslmode=(require|verify-ca|verify-full)(?:&|$)/i.test(connectionString);

    pool = new Pool({
      connectionString: normalizedConnectionString(connectionString, rejectUnauthorized),
      ssl: needsSsl
        ? { rejectUnauthorized }
        : undefined,
      max: getPoolMax(),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }

  return pool;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function transaction(callback) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizedConnectionString,
  query,
  transaction
};
