const { Pool } = require('pg');
const { getPoolMax } = require('./_config');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      const error = new Error('DATABASE_URL is not configured');
      error.statusCode = 500;
      error.code = 'CONFIG_ERROR';
      throw error;
    }

    const needsSsl =
      process.env.PGSSLMODE === 'require' ||
      connectionString.includes('sslmode=require');

    pool = new Pool({
      connectionString,
      ssl: needsSsl
        ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
      max: getPoolMax(),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
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
  query,
  transaction
};
