process.env.NODE_ENV = 'test';
require('dotenv').config({ path: '.env.test' });

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.TEST_DB_NAME || 'borescope_test',
  user: process.env.DB_USER || 'borescope_admin',
  password: process.env.DB_PASSWORD || 'Borescope@2026'
});

beforeAll(async () => {
  const fs = require('fs');
  const path = require('path');
  try {
    const sql = fs.readFileSync(path.resolve(__dirname, '..', '..', 'database', 'init.sql'), 'utf8');
    await pool.query(sql);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('Test init warning:', e.message);
    }
  }
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  await pool.query(`
    DELETE FROM defect_annotation;
    DELETE FROM workflow_record;
    DELETE FROM inspection_image;
    DELETE FROM image_tile;
    DELETE FROM inspection_case;
    DELETE FROM engine;
    DELETE FROM app_user WHERE role != 'ADMIN';
  `);
});

module.exports = { pool };
