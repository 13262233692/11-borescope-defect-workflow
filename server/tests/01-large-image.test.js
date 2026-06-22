const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { pool } = require('../setup');
const config = require('../../src/config');

describe('1. 超大图瓦片加载测试', () => {
  let server;
  let token;
  let caseId;
  let engineId;
  let userId;

  beforeAll(async () => {
    jest.setTimeout(60000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    userId = uuidv4();
    const pwd = await bcrypt.hash('test123456', 10);
    await pool.query(`
      INSERT INTO app_user (id, username, password_hash, display_name, role)
      VALUES ($1, 'test_inspector', $2, '测试判读员', 'INSPECTOR')`,
      [userId, pwd]);

    token = jwt.sign(
      { userId, username: 'test_inspector', role: 'INSPECTOR', displayName: '测试' },
      config.jwt.secret,
      { expiresIn: '1h' }
    );

    engineId = uuidv4();
    await pool.query(`
      INSERT INTO engine (id, engine_serial, model, manufacturer)
      VALUES ($1, 'TEST-ENGINE-001', 'CFM56-7B', 'CFM International')`,
      [engineId]);

    caseId = uuidv4();
    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, 'BS-TEST-001', $2, '2026-06-22', 'A检孔探', 'HPT', 'PENDING', $3, $3)`,
      [caseId, engineId, userId]);
  });

  afterAll(() => {
    try { server.close && server.close(); } catch (e) {}
  });

  async function createLargeImage(width, height) {
    const buffer = await sharp({
      create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } }
    })
      .jpeg({ quality: 85 })
      .toBuffer();
    return buffer;
  }

  test('1.1 上传4096x4096大图并触发瓦片生成', async () => {
    const buffer = await createLargeImage(4096, 4096);

    const res = await request(server)
      .post(`/api/cases/${caseId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', buffer, 'large_4k.jpg');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const image = res.body.data[0];
    expect(image.width).toBe(4096);
    expect(image.height).toBe(4096);
    expect(image.maxLevel).toBeGreaterThanOrEqual(4);

    const expectedMaxLevel = Math.ceil(Math.log2(Math.max(4096, 4096) / 256));
    expect(image.maxLevel).toBe(expectedMaxLevel);
  }, 60000);

  test('1.2 上传16384x16384超超大图', async () => {
    const buffer = await createLargeImage(16384, 16384);

    const res = await request(server)
      .post(`/api/cases/${caseId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', buffer, 'giant_16k.jpg');

    expect(res.status).toBe(201);
    const image = res.body.data[0];
    expect(image.width).toBe(16384);
    expect(image.maxLevel).toBe(Math.ceil(Math.log2(16384 / 256)));
  }, 60000);

  test('1.3 超过16384限制的图片被拒绝', async () => {
    const buffer = await createLargeImage(17000, 17000);

    const res = await request(server)
      .post(`/api/cases/${caseId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', buffer, 'too_large.jpg');

    expect([400, 500, 413]).toContain(res.status);
    expect(res.body.success).not.toBe(true);
  }, 60000);

  test('1.4 获取瓦片信息', async () => {
    const buffer = await createLargeImage(2048, 2048);
    const uploadRes = await request(server)
      .post(`/api/cases/${caseId}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', buffer, 'tile_test.jpg');
    const image = uploadRes.body.data[0];

    const infoRes = await request(server)
      .get(`/api/cases/${caseId}/images/${image.id}/tiles/info`)
      .set('Authorization', `Bearer ${token}`);

    expect(infoRes.status).toBe(200);
    expect(infoRes.body.data.width).toBe(2048);
    expect(infoRes.body.data.height).toBe(2048);
    expect(infoRes.body.data.tileSize).toBe(256);
  }, 30000);

  test('1.5 瓦片数量计算正确性', async () => {
    const sizes = [
      { w: 512, h: 512, levels: 2, expectedCols: [1, 2] },
      { w: 1024, h: 768, levels: 3, expectedCols: [1, 2, 4] }
    ];

    for (const s of sizes) {
      const buffer = await createLargeImage(s.w, s.h);
      const res = await request(server)
        .post(`/api/cases/${caseId}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('images', buffer, `size_${s.w}.jpg`);
      const image = res.body.data[0];
      expect(image.maxLevel).toBe(s.levels);
    }
  }, 60000);
});
