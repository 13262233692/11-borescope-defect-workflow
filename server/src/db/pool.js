const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');

const poolConfig = config.database.url
  ? { connectionString: config.database.url }
  : {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      max: config.database.max,
      idleTimeoutMillis: config.database.idleTimeoutMillis,
      connectionTimeoutMillis: config.database.connectionTimeoutMillis
    };

if (config.server.env === 'production') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

async function query(text, params, client) {
  const executor = client || pool;
  try {
    const start = Date.now();
    const result = await executor.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`DB query: ${text.split('\n')[0].trim().slice(0, 80)} - ${result.rowCount} rows (${duration}ms)`);
    return result;
  } catch (err) {
    logger.error(`DB query failed: ${err.message}`, { query: text?.slice(0, 200), params });
    throw err;
  }
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function testConnection() {
  try {
    await query('SELECT NOW() as now');
    logger.info('Database connection: OK');
    return true;
  } catch (err) {
    logger.error('Database connection failed:', err.message);
    return false;
  }
}

module.exports = { pool, query, transaction, testConnection };
