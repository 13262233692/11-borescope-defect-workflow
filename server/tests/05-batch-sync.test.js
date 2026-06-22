const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../setup');
const config = require('../../src/config');

describe('5. 批量标注增量同步与自动合并测试', () => {
  let server;
  let user1Token, user2Token, reviewerToken;
  let caseId, engineId, imageId;
  let user1Id, user2Id, reviewerId;

  beforeAll(async () => {
    jest.setTimeout(30000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    user1Id = uuidv4();
    user2Id = uuidv4();
    reviewerId = uuidv4();

    const pwd = await bcrypt.hash('test123456', 10);
    await pool.query(`
      INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES
      ($1, 'sync_ins1', $4, '同步判读1', 'INSPECTOR'),
      ($2, 'sync_ins2', $4, '同步判读2', 'INSPECTOR'),
      ($3, 'sync_rev', $4, '复核员', 'REVIEWER')`,
      [user1Id, user2Id, reviewerId, pwd]);

    user1Token = jwt.sign({ userId: user1Id, username: 'sync_ins1', role: 'INSPECTOR' }, config.jwt.secret, { expiresIn: '1h' });
    user2Token = jwt.sign({ userId: user2Id, username: 'sync_ins2', role: 'INSPECTOR' }, config.jwt.secret, { expiresIn: '1h' });
    reviewerToken = jwt.sign({ userId: reviewerId, username: 'sync_rev', role: 'REVIEWER' }, config.jwt.secret, { expiresIn: '1h' });

    engineId = uuidv4();
    caseId = uuidv4();
    imageId = uuidv4();

    await pool.query(`INSERT INTO engine (id, engine_serial, model, manufacturer) VALUES ($1, 'ENG-SYNC-1', 'CFM56', 'CFM')`, [engineId]);

    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, 'BS-SYNC-001', $2, '2026-06-22', 'A检', 'HPT', 'PENDING', $3, $3)`,
      [caseId, engineId, user1Id]);

    await pool.query(`
      INSERT INTO inspection_image
      (id, case_id, file_name, original_path, width, height, tile_size, max_level, has_tiles, tile_base_path, thumbnail_path)
      VALUES ($1, $2, 'sync_test.jpg', 'uploads/sync_test.jpg', 1024, 1024, 256, 2, true, 'tile_sync', 'thumb_sync.jpg')`,
      [imageId, caseId]);
  });

  afterAll(() => { try { server.close && server.close(); } catch (e) {} });

  test('5.1 空 operations 数组被拒绝', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ operations: [], autoMerge: true });
    expect(res.status).toBe(400);
  });

  test('5.2 批量新增多个标注：两用户互不覆盖', async () => {
    const u1Payload = {
      operations: [
        { op: 'create', tempId: 'u1-1', caseId, imageId, defectType: 'CRACK', severity: 'MAJOR', x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, description: 'U1裂纹1' },
        { op: 'create', tempId: 'u1-2', caseId, imageId, defectType: 'CORROSION', severity: 'MINOR', x1: 0.4, y1: 0.4, x2: 0.5, y2: 0.5 }
      ],
      autoMerge: true
    };
    const u2Payload = {
      operations: [
        { op: 'create', tempId: 'u2-1', caseId, imageId, defectType: 'BURN', severity: 'CRITICAL', x1: 0.7, y1: 0.1, x2: 0.8, y2: 0.2, description: 'U2烧蚀1' }
      ],
      autoMerge: true
    };

    const [res1, res2] = await Promise.all([
      request(server).post(`/api/cases/${caseId}/annotations/sync`).set('Authorization', `Bearer ${user1Token}`).send(u1Payload),
      request(server).post(`/api/cases/${caseId}/annotations/sync`).set('Authorization', `Bearer ${user2Token}`).send(u2Payload)
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const r1Created = res1.body.data.results.filter(r => r.status === 'created');
    const r2Created = res2.body.data.results.filter(r => r.status === 'created');
    expect(r1Created.length).toBe(2);
    expect(r2Created.length).toBe(1);

    const total = new Set([
      ...r1Created.map(r => r.id),
      ...r2Created.map(r => r.id)
    ]);
    expect(total.size).toBe(3);

    const allServer = res1.body.data.serverAnnotations;
    expect(allServer.length).toBeGreaterThanOrEqual(3);

    global._syncIds = {
      u1a: r1Created[0].id,
      u1b: r1Created[1].id,
      u2a: r2Created[0].id,
      u1a_token: r1Created[0].data.conflictToken,
      u2a_token: r2Created[0].data.conflictToken
    };
  });

  test('5.3 用户1改severity / 用户2改measurement → 自动合并不同字段', async () => {
    const { u1a, u1a_token } = global._syncIds;

    const { rows: [baseline] } = await pool.query(
      'SELECT * FROM defect_annotation WHERE id = $1', [u1a]
    );

    const res1 = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        operations: [{
          op: 'update',
          id: u1a,
          version: baseline.version,
          conflictToken: baseline.conflict_token,
          severity: 'CRITICAL',
          updatedAt: baseline.updated_at
        }]
      });

    expect(res1.status).toBe(200);
    const update1 = res1.body.data.results.find(r => r.id === u1a);
    expect(['updated', 'merged']).toContain(update1.status);
    const v2Token = update1.data.conflictToken;
    expect(v2Token).not.toBe(baseline.conflict_token);

    const res2 = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        operations: [{
          op: 'update',
          id: u1a,
          version: baseline.version,
          conflictToken: baseline.conflict_token,
          measurement: 2.54,
          measurementUnit: 'mm',
          description: 'U2补充的描述'
        }],
        autoMerge: true
      });

    expect(res2.status).toBe(200);
    const update2 = res2.body.data.results.find(r => r.id === u1a);
    expect(update2.status).toBe('merged');
    expect(update2.mergedFields.length).toBeGreaterThanOrEqual(1);

    const finalData = update2.data;
    expect(finalData.severity).toBe('CRITICAL');
    expect(Number(finalData.measurement)).toBe(2.54);
    expect(finalData.measurementUnit).toBe('mm');
    expect(finalData.version).toBeGreaterThan(baseline.version);
  });

  test('5.4 两用户同时改同一字段(severity) → 返回明确冲突', async () => {
    const { u1b } = global._syncIds;

    const { rows: [baseline] } = await pool.query(
      'SELECT * FROM defect_annotation WHERE id = $1', [u1b]
    );

    const [res1, res2] = await Promise.all([
      request(server).post(`/api/cases/${caseId}/annotations/sync`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          operations: [{
            op: 'update', id: u1b,
            version: baseline.version,
            conflictToken: baseline.conflict_token,
            severity: 'CRITICAL'
          }]
        }),
      request(server).post(`/api/cases/${caseId}/annotations/sync`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          operations: [{
            op: 'update', id: u1b,
            version: baseline.version,
            conflictToken: baseline.conflict_token,
            severity: 'MINOR'
          }],
          autoMerge: true
        })
    ]);

    const results = [res1, res2].map(r => r.body.data.results.find(x => x.id === u1b));
    const successCount = results.filter(r => r && ['updated', 'merged'].includes(r.status)).length;
    const conflictCount = results.filter(r => r && r.status === 'conflict').length;

    expect(successCount).toBe(1);
    expect(conflictCount).toBe(1);

    const conflicted = results.find(r => r.status === 'conflict');
    expect(conflicted.details).toBeTruthy();
    expect(conflicted.details.ours).toBeTruthy();
    expect(conflicted.details.currentVersion).toBeGreaterThan(baseline.version);
  });

  test('5.5 复核员(REVIEWER)尝试批量创建标注 → 全部403', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        operations: [{
          op: 'create', tempId: 'rv1', caseId, imageId,
          defectType: 'WEAR', severity: 'MINOR',
          x1: 0.1, y1: 0.5, x2: 0.2, y2: 0.6
        }]
      });
    expect(res.status).toBe(403);
  });

  test('5.6 用户2删除用户1的标注 → 返回403并保留标注', async () => {
    const { u1a } = global._syncIds;

    const { rows: [before] } = await pool.query(
      'SELECT is_deleted FROM defect_annotation WHERE id = $1', [u1a]
    );
    expect(before.is_deleted).toBe(false);

    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({
        operations: [{ op: 'delete', id: u1a }]
      });

    expect(res.status).toBe(200);
    const r = res.body.data.results.find(x => x.id === u1a);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/无权/);

    const { rows: [after] } = await pool.query(
      'SELECT is_deleted FROM defect_annotation WHERE id = $1', [u1a]
    );
    expect(after.is_deleted).toBe(false);
  });

  test('5.7 用户1删除自己的标注 + 用户2新增自己的标注 混合同步 → 双方结果独立正确', async () => {
    const { u2a, u2a_token } = global._syncIds;

    const u1Op = { op: 'delete', id: global._syncIds.u1b };
    const u2Op = {
      op: 'create', tempId: 'u2-new', caseId, imageId,
      defectType: 'DEBRIS', severity: 'MODERATE',
      x1: 0.8, y1: 0.8, x2: 0.9, y2: 0.9
    };

    const [res1, res2] = await Promise.all([
      request(server).post(`/api/cases/${caseId}/annotations/sync`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ operations: [u1Op] }),
      request(server).post(`/api/cases/${caseId}/annotations/sync`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ operations: [u2Op] })
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const delRes = res1.body.data.results.find(r => r.id === global._syncIds.u1b);
    expect(delRes.status).toBe('deleted');

    const createRes = res2.body.data.results.find(r => r.tempId === 'u2-new');
    expect(createRes.status).toBe('created');

    const { rows: [checkDeleted] } = await pool.query(
      'SELECT is_deleted FROM defect_annotation WHERE id = $1', [global._syncIds.u1b]
    );
    expect(checkDeleted.is_deleted).toBe(true);

    const serverIds = new Set(res2.body.data.serverAnnotations.map(a => a.id));
    expect(serverIds.has(createRes.id)).toBe(true);
    expect(serverIds.has(global._syncIds.u1a)).toBe(true);
    expect(serverIds.has(global._syncIds.u2a)).toBe(true);
  });

  test('5.8 首次更新(v1→v2)也必须做冲突检测，不能跳过', async () => {
    const annId = uuidv4();
    const token = uuidv4();
    await pool.query(`
      INSERT INTO defect_annotation
      (id, case_id, image_id, defect_type, severity, x1, y1, x2, y2, created_by, version, conflict_token)
      VALUES ($1, $2, $3, 'CRACK', 'MINOR', 0.01, 0.01, 0.05, 0.05, $4, 1, $5)`,
      [annId, caseId, imageId, user1Id, token]);

    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        operations: [{
          op: 'update',
          id: annId,
          version: 999,
          conflictToken: '00000000-0000-0000-0000-000000000000',
          severity: 'CRITICAL'
        }]
      });

    expect(res.status).toBe(200);
    const r = res.body.data.results.find(x => x.id === annId);
    expect(r.status).toBe('conflict');
    expect(r.details.expectedVersion).toBe(999);
    expect(r.details.currentVersion).toBe(1);
  });

  test('5.9 operations超过200条 → 参数校验失败', async () => {
    const manyOps = Array.from({ length: 205 }).map((_, i) => ({
      op: 'create',
      tempId: `b${i}`,
      caseId, imageId,
      defectType: 'OTHER', severity: 'MINOR',
      x1: i * 0.001, y1: i * 0.001,
      x2: (i + 1) * 0.001, y2: (i + 1) * 0.001
    }));
    const res = await request(server)
      .post(`/api/cases/${caseId}/annotations/sync`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ operations: manyOps });
    expect(res.status).toBe(400);
  });
});
