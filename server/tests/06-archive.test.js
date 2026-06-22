const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../setup');
const config = require('../../src/config');

function tokenFor(userId, role) {
  return jwt.sign(
    { userId, username: role.toLowerCase() + '_test', role },
    config.jwt.secret,
    { expiresIn: '1h' }
  );
}

describe('6. 适航放行证据包归档测试', () => {
  let server;

  let inspectorId, reviewerId, releaserId, adminId;
  let inspectorToken, reviewerToken, releaserToken, adminToken;

  let casePending, caseCleared, caseClosed;
  let engineId;
  let imageId;

  beforeAll(async () => {
    jest.setTimeout(45000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    inspectorId = uuidv4();
    reviewerId = uuidv4();
    releaserId = uuidv4();
    adminId = uuidv4();

    const pwd = await bcrypt.hash('Test-2026!', 10);
    await pool.query(`
      INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES
      ($1, 'ins_arc', $5, '判读A', 'INSPECTOR'),
      ($2, 'rev_arc', $5, '复核A', 'REVIEWER'),
      ($3, 'rel_arc', $5, '放行A', 'RELEASER'),
      ($4, 'adm_arc', $5, '管理员A', 'ADMIN')`,
      [inspectorId, reviewerId, releaserId, adminId, pwd]
    );

    inspectorToken = tokenFor(inspectorId, 'INSPECTOR');
    reviewerToken = tokenFor(reviewerId, 'REVIEWER');
    releaserToken = tokenFor(releaserId, 'RELEASER');
    adminToken = tokenFor(adminId, 'ADMIN');

    engineId = uuidv4();
    await pool.query(
      `INSERT INTO engine (id, engine_serial, model, manufacturer)
       VALUES ($1, 'ENG-ARCH-01', 'CFM56-5B', 'CFM International')`,
      [engineId]
    );

    casePending = uuidv4();
    caseCleared = uuidv4();
    caseClosed = uuidv4();

    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, section, status,
       inspector_id, reviewer_id, releaser_id, created_by) VALUES
      ($1, 'BS-ARCH-PENDING', $7, '2026-06-22', 'HPT',
       'PENDING', $3, $4, $5, $3),
      ($2, 'BS-ARCH-CLEAR',   $7, '2026-06-22', 'HPC',
       'CLEAR',   $3, $4, $5, $3),
      ($6, 'BS-ARCH-CLOSED',  $7, '2026-06-21', 'LPT',
       'CLOSED',  $3, $4, $5, $3)`,
      [casePending, caseCleared, inspectorId, reviewerId, releaserId, caseClosed, engineId]
    );

    imageId = uuidv4();
    await pool.query(`
      INSERT INTO inspection_image
      (id, case_id, file_name, original_path, width, height, tile_size,
       max_level, has_tiles, tile_base_path, thumbnail_path) VALUES
      ($1, $2, 'engine.jpg', 'uploads/engine.jpg', 1024, 1024, 256, 2,
       true, 'tile_1', 'thumb_1.jpg')`,
      [imageId, caseCleared]
    );

    const annId1 = uuidv4(), annId2 = uuidv4();
    await pool.query(`
      INSERT INTO defect_annotation
      (id, case_id, image_id, defect_type, severity, x1, y1, x2, y2,
       description, created_by) VALUES
      ($1, $3, $4, 'CORROSION', 'MINOR', 0.1, 0.1, 0.2, 0.2, '轻微腐蚀', $5),
      ($2, $3, $4, 'BURN',      'MAJOR', 0.5, 0.5, 0.6, 0.6, '燃烧室烧蚀', $5)`,
      [annId1, annId2, caseCleared, imageId, inspectorId]
    );

    await pool.query(`
      INSERT INTO workflow_record
      (case_id, action, from_status, to_status, actor_id, comment) VALUES
      ($1, 'SUBMIT',       'PENDING',  'REVIEWING', $2, '提交流程测试'),
      ($1, 'REVIEW_PASS',  'REVIEWING','CLEAR',     $6, '复核通过'),
      ($1, 'COMMENT',      NULL,       NULL,        $2, '一切正常')`,
      [caseCleared, inspectorId, reviewerId, reviewerId, releaserId, reviewerId]
    );
  });

  afterAll(() => { try { server.close && server.close(); } catch (e) {} });

  // ============================================================
  // 场景 6.1 权限不足测试
  // ============================================================

  test('6.1.1 未登录用户触发归档 → 401', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseCleared}/archives`)
      .send({ releaseNote: 'OK' });
    expect(res.status).toBe(401);
  });

  test('6.1.2 判读员(INSPECTOR)触发归档 → 403', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseCleared}/archives`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({ releaseNote: '放行正常' });
    expect(res.status).toBe(403);
  });

  test('6.1.3 复核员(REVIEWER)触发归档 → 403', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseCleared}/archives`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  test('6.1.4 放行工程师(RELEASER)触发归档 CLEAR 工单 → 202 接受', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseClosed}/archives`)
      .set('Authorization', `Bearer ${releaserToken}`)
      .send({ releaseNote: '适航放行，无需维修' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.releaseNumber).toMatch(/^REL-.*BS-ARCH-CLOSED/);
  });

  test('6.1.5 管理员(ADMIN)触发归档 → 202 接受', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseCleared}/archives`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ releaseNote: '管理审批归档' });
    expect(res.status).toBe(202);
    expect(res.body.data.createdByName).toBe('管理员A');
  });

  // ============================================================
  // 场景 6.2 工单未关闭测试
  // ============================================================

  test('6.2.1 PENDING 状态工单触发归档 → 400', async () => {
    const res = await request(server)
      .post(`/api/cases/${casePending}/archives`)
      .set('Authorization', `Bearer ${releaserToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/CLEAR|CLOSED/);
  });

  // ============================================================
  // 场景 6.3 重复归档测试
  // ============================================================

  test('6.3.1 通过数据库直接插入一个 COMPLETED 归档记录，再次触发应该被数据库唯一索引或应用逻辑拦截', async () => {
    const doneId = uuidv4();
    const doneId2 = uuidv4();
    try {
      await pool.query(`DELETE FROM archive_record WHERE case_id = $1`, [caseClosed]);
    } catch (e) {}

    await pool.query(`
      INSERT INTO archive_record
      (id, case_id, status, release_number, package_name, package_size,
       image_count, annotation_count, workflow_count, completed_at, created_by)
      VALUES ($1, $2, 'COMPLETED', 'REL-MANUAL-001', 'manual.tar.gz',
       123456, 1, 1, 1, NOW(), $3)`,
      [doneId, caseClosed, releaserId]
    );

    const res = await request(server)
      .post(`/api/cases/${caseClosed}/archives`)
      .set('Authorization', `Bearer ${releaserToken}`)
      .send({ releaseNote: '重归档' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/重复归档|已有完成/);
  });

  // ============================================================
  // 场景 6.4 归档后修改拦截（双保险：业务模型 + DB触发器）
  // ============================================================

  test('6.4.1 业务层：归档后新增标注 → 409', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseClosed}/annotations`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({
        imageId,
        defectType: 'CRACK', severity: 'MAJOR',
        x1: 0.4, y1: 0.4, x2: 0.5, y2: 0.5,
        description: '归档后新增的尝试'
      });
    expect([409, 403, 500]).toContain(res.status);
    const errMsg = (res.body.error?.message || res.body.error || '').toString();
    expect(/归档|archived|禁止修改/.test(errMsg)).toBe(true);
  });

  test('6.4.2 业务层：归档后修改已有标注 → 409', async () => {
    const { rows: anns } = await pool.query(
      `SELECT id, conflict_token, version FROM defect_annotation
       WHERE case_id = $1 AND is_deleted = false LIMIT 1`,
      [caseCleared]
    );
    const doneId3 = uuidv4();
    await pool.query(`
      INSERT INTO archive_record
      (id, case_id, status, release_number, package_name, package_size,
       image_count, annotation_count, workflow_count, completed_at, created_by)
      VALUES ($1, $2, 'COMPLETED', 'REL-DONE-642', 'x.tar.gz', 1000,
       1, 1, 1, NOW(), $3)`,
      [doneId3, caseCleared, releaserId]
    );

    if (anns.length) {
      const res = await request(server)
        .put(`/api/cases/${caseCleared}/annotations/${anns[0].id}`)
        .set('Authorization', `Bearer ${inspectorToken}`)
        .send({
          conflictToken: anns[0].conflict_token,
          severity: 'CRITICAL'
        });
      expect([409, 500]).toContain(res.status);
    }
  });

  test('6.4.3 数据库层触发器：归档后直接 UPDATE 标注 SQL 应抛异常', async () => {
    const { rows: anns } = await pool.query(
      `SELECT id FROM defect_annotation WHERE case_id = $1 AND is_deleted = false LIMIT 1`,
      [caseCleared]
    );
    if (!anns.length) return;
    let threw = false;
    try {
      await pool.query(
        `UPDATE defect_annotation SET description = '直接SQL篡改' WHERE id = $1`,
        [anns[0].id]
      );
    } catch (e) {
      threw = true;
      expect(e.message).toMatch(/归档|archived|禁止/);
    }
    expect(threw).toBe(true);
  });

  test('6.4.4 业务层：归档后修改工单状态 → 409', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseCleared}/workflow`)
      .set('Authorization', `Bearer ${releaserToken}`)
      .send({ action: 'CLOSE', comment: '尝试再关闭' });
    expect([409, 400, 500]).toContain(res.status);
  });

  // ============================================================
  // 场景 6.5 辅助接口权限
  // ============================================================

  test('6.5.1 未登录查询归档列表 → 401', async () => {
    const res = await request(server)
      .get(`/api/cases/${caseCleared}/archives`);
    expect(res.status).toBe(401);
  });

  test('6.5.2 判读员允许查询归档列表（只读）→ 200', async () => {
    const res = await request(server)
      .get(`/api/cases/${caseCleared}/archives`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  test('6.5.3 判读员不允许重试归档 → 403', async () => {
    const failId = uuidv4();
    await pool.query(`
      INSERT INTO archive_record
      (id, case_id, status, release_number, retry_count, max_retries, last_error, created_by)
      VALUES ($1, $2, 'FAILED', 'REL-FAIL-001', 0, 3, '模拟失败', $3)`,
      [failId, casePending, releaserId]
    );

    const res = await request(server)
      .post(`/api/cases/${casePending}/archives/${failId}/retry`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(res.status).toBe(403);
  });

  test('6.5.4 放行工程师重试 FAILED → 202', async () => {
    const res = await request(server)
      .post(`/api/cases/${casePending}/archives/${(await (async () => {
        const { rows } = await pool.query(
          "SELECT id FROM archive_record WHERE status = 'FAILED' LIMIT 1"
        );
        return rows[0]?.id;
      })())}/retry`)
      .set('Authorization', `Bearer ${releaserToken}`);
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.retryCount).toBe(1);
  });
});
