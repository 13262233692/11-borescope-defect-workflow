const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../setup');
const config = require('../../src/config');

describe('2. 多人标注并发冲突测试', () => {
  let server;
  let user1Token, user2Token, adminToken;
  let caseId, engineId, imageId;
  let user1Id, user2Id, adminId;

  beforeAll(async () => {
    jest.setTimeout(30000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    user1Id = uuidv4();
    user2Id = uuidv4();
    adminId = uuidv4();

    const pwd = await bcrypt.hash('test123456', 10);
    await pool.query(`
      INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES
      ($1, 'user_a', $4, '判读员A', 'INSPECTOR'),
      ($2, 'user_b', $4, '判读员B', 'INSPECTOR'),
      ($3, 'admin_u', $4, '管理员', 'ADMIN')`,
      [user1Id, user2Id, adminId, pwd]);

    user1Token = jwt.sign({ userId: user1Id, username: 'user_a', role: 'INSPECTOR' }, config.jwt.secret, { expiresIn: '1h' });
    user2Token = jwt.sign({ userId: user2Id, username: 'user_b', role: 'INSPECTOR' }, config.jwt.secret, { expiresIn: '1h' });
    adminToken = jwt.sign({ userId: adminId, username: 'admin_u', role: 'ADMIN' }, config.jwt.secret, { expiresIn: '1h' });

    engineId = uuidv4();
    caseId = uuidv4();
    imageId = uuidv4();

    await pool.query(`INSERT INTO engine (id, engine_serial, model, manufacturer) VALUES ($1, 'ENG-CONF-1', 'CFM56', 'CFM')`, [engineId]);

    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, 'BS-CONF-001', $2, '2026-06-22', 'A检', 'HPT', 'PENDING', $3, $3)`,
      [caseId, engineId, user1Id]);

    await pool.query(`
      INSERT INTO inspection_image
      (id, case_id, file_name, original_path, width, height, tile_size, max_level, has_tiles, tile_base_path, thumbnail_path)
      VALUES ($1, $2, 'test.jpg', 'uploads/test.jpg', 1024, 1024, 256, 2, true, 'tile_base', 'thumb.jpg')`,
      [imageId, caseId]);
  });

  afterAll(() => { try { server.close && server.close(); } catch (e) {} });

  test('2.1 用户1创建标注，返回conflictToken和version=1', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        caseId,
        imageId,
        defectType: 'CRACK',
        severity: 'MAJOR',
        x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3,
        description: '用户A创建的裂纹'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.conflictToken).toBeTruthy();
    expect(res.body.data.defectType).toBe('CRACK');
    expect(res.body.data.createdBy).toBe(user1Id);

    global.testAnnotationId = res.body.data.id;
    global.testAnnotationToken = res.body.data.conflictToken;
  });

  test('2.2 用户2使用旧token更新标注，触发冲突检测（409）', async () => {
    const annId = global.testAnnotationId;
    const oldToken = global.testAnnotationToken;

    await request(server)
      .put(`/api/cases/${caseId}/annotations/${annId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        defectType: 'CORROSION',
        severity: 'MODERATE',
        conflictToken: oldToken
      });

    const conflictRes = await request(server)
      .put(`/api/cases/${caseId}/annotations/${annId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        defectType: 'BURN',
        severity: 'CRITICAL',
        conflictToken: oldToken
      });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('CONFLICT');
    expect(conflictRes.body.error.details.currentVersion).toBe(2);
  });

  test('2.3 携带最新token可成功更新', async () => {
    const annId = global.testAnnotationId;

    const getRes = await request(server)
      .get(`/api/cases/${caseId}/annotations/${annId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(getRes.status).toBe(200);
    const latestToken = getRes.body.data.conflictToken;

    const updateRes = await request(server)
      .put(`/api/cases/${caseId}/annotations/${annId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        defectType: 'BURN',
        severity: 'CRITICAL',
        conflictToken: latestToken
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.version).toBe(3);
  });

  test('2.4 用户2删除用户1的标注被禁止（非本人）', async () => {
    const res = await request(server)
      .delete(`/api/cases/${caseId}/annotations/${global.testAnnotationId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(res.status).toBe(403);
  });

  test('2.5 并发提交两次更新，只有一次成功', async () => {
    const createRes = await request(server)
      .post(`/api/cases/${caseId}/annotations`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        caseId, imageId, defectType: 'WEAR', severity: 'MINOR',
        x1: 0.5, y1: 0.5, x2: 0.7, y2: 0.7
      });
    const annId = createRes.body.data.id;
    const token = createRes.body.data.conflictToken;

    const [res1, res2] = await Promise.all([
      request(server)
        .put(`/api/cases/${caseId}/annotations/${annId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ severity: 'MAJOR', conflictToken: token }),
      request(server)
        .put(`/api/cases/${caseId}/annotations/${annId}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ severity: 'CRITICAL', conflictToken: token })
    ]);

    const successCount = [res1.status, res2.status].filter(s => s === 200).length;
    const failCount = [res1.status, res2.status].filter(s => s === 409).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);
  });
});
