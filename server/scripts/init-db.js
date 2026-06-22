#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');
const logger = require('../src/utils/logger');

async function run() {
  const sqlPath = path.resolve(__dirname, '..', '..', 'database', 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client(config.database.url
    ? { connectionString: config.database.url }
    : {
        host: config.database.host,
        port: config.database.port,
        database: 'postgres',
        user: config.database.user,
        password: config.database.password
      });

  try {
    logger.info('Connecting to PostgreSQL...');
    await client.connect();

    logger.info(`Creating database ${config.database.name}...`);
    try {
      await client.query(`CREATE DATABASE ${config.database.name}`);
      logger.info('Database created');
    } catch (e) {
      if (e.code === '42P04') {
        logger.info('Database already exists');
      } else {
        throw e;
      }
    }

    await client.end();

    const appClient = new Client(config.database.url
      ? { connectionString: config.database.url }
      : {
          host: config.database.host,
          port: config.database.port,
          database: config.database.name,
          user: config.database.user,
          password: config.database.password
        });

    logger.info('Running init.sql...');
    await appClient.connect();
    await appClient.query(sql);
    await appClient.end();

    logger.info('Database initialization complete!');
    logger.info('Default test accounts:');
    logger.info('  admin     / admin123     (管理员)');
    logger.info('  inspector / inspector123 (判读员)');
    logger.info('  inspector2/ inspector123 (判读员)');
    logger.info('  reviewer  / reviewer123  (复核员)');
    logger.info('  releaser  / releaser123  (放行工程师)');
  } catch (err) {
    logger.error('Database init failed:', err);
    process.exit(1);
  }
}

run();
