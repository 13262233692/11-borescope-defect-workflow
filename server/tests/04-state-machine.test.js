const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../setup');
const config = require('../../src/config');

describe('4. 工单状态机非法跳转测试', () => {
  let server;
  let tokens = {};
  let engineId;

  const createUser = async (username, role) => {
    const id = uuidv4();
    const pwd = await bcrypt.hash('test123456', 10);
    await pool.query(
      `INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, username, pwd, role + '-' + username, role]
    );
    return { id, token: jwt.sign({ userId: id, username, role }, config.jwt.secret, { expiresIn: '1h' }) };
  };

  const createCase = async (status, inspectorId) => {
    const id = uuidv4();
    const cn = 'BS-STATE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, $2, $3, '2026-06-22', 'A检', 'HPT', $4, $5, $5)`,
      [id, cn, engineId, status, inspectorId]);
    return id;
  };

  beforeAll(async () => {
    jest.setTimeout(30000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    const insp = await createUser('st_insp', 'INSPECTOR');
    const rev = await createUser('st_rev', 'REVIEWER');
    const rel = await createUser('st_rel', 'RELEASER');
    tokens = { insp, rev, rel };

    engineId = uuidv4();
    await pool.query(`INSERT INTO engine (id, engine_serial, model, manufacturer) VALUES ($1, 'ENG-STATE-1', 'GE90', 'GE')`, [engineId]);
  });

  afterAll(() => { try { server.close && server.close(); } catch (e) {} });

  describe('合法状态流转验证', () => {
    test('4.1 PENDING -> REVIEWING (判读员提交)', async () => {
      const id = await createCase('PENDING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/submit`)
        .set('Authorization', `Bearer ${tokens.insp.token}`)
        .send({ summary: '已完成判读', conclusion: '存在轻微腐蚀' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REVIEWING');
      expect(res.body.data.version).toBe(2);
    });

    test('4.2 REVIEWING -> CLEAR (复核员判定放行)', async () => {
      const id = await createCase('REVIEWING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'CLEAR', comment: '无影响飞行安全缺陷' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLEAR');
    });

    test('4.3 REVIEWING -> REPAIR (复核员判定维修)', async () => {
      const id = await createCase('REVIEWING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'REPAIR', comment: '发现超标裂纹需维修' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REPAIR');
    });

    test('4.4 REVIEWING -> PENDING (复核员退回)', async () => {
      const id = await createCase('REVIEWING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'REJECT', comment: '标注不完整，请补充' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PENDING');
    });

    test('4.5 CLEAR -> CLOSED (放行工程师签发)', async () => {
      const id = await createCase('CLEAR', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/release`)
        .set('Authorization', `Bearer ${tokens.rel.token}`)
        .send({ certificateNo: 'REL-2026-' + Date.now(), comment: '符合适航标准' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
    });

    test('4.6 REPAIR -> CLOSED (放行工程师关闭)', async () => {
      const id = await createCase('REPAIR', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/close`)
        .set('Authorization', `Bearer ${tokens.rel.token}`)
        .send({ comment: '维修完成，已验证' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CLOSED');
    });
  });

  describe('非法状态流转检测', () => {
    test('4.7 不能直接从 PENDING -> CLEAR (跳过复核)', async () => {
      const id = await createCase('PENDING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'CLEAR' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    test('4.8 不能从 REPAIR -> CLEAR (需要重新判读)', async () => {
      const id = await createCase('REPAIR', tokens.insp.id);
      await pool.query('UPDATE inspection_case SET status = $1 WHERE id = $2', ['PENDING', id]);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'CLEAR' });
      expect(res.status).toBe(409);
    });

    test('4.9 不能从 CLOSED 重新打开任何状态', async () => {
      const id = await createCase('CLOSED', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/submit`)
        .set('Authorization', `Bearer ${tokens.insp.token}`);
      expect(res.status).toBe(409);
    });

    test('4.10 判读员不能 REVIEWING -> CLEAR (角色越权)', async () => {
      const id = await createCase('REVIEWING', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.insp.token}`)
        .send({ decision: 'CLEAR' });
      expect(res.status).toBe(403);
    });

    test('4.11 复核员不能 CLEAR -> CLOSED (需要放行工程师)', async () => {
      const id = await createCase('CLEAR', tokens.insp.id);
      const res = await request(server)
        .post(`/api/cases/${id}/release`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ certificateNo: 'X' });
      expect(res.status).toBe(403);
    });

    test('4.12 数据库层面禁止非法流转（触发器验证）', async () => {
      const id = await createCase('PENDING', tokens.insp.id);
      try {
        await pool.query('UPDATE inspection_case SET status = $1 WHERE id = $2', ['CLOSED', id]);
        fail('Expected PostgreSQL trigger to throw');
      } catch (err) {
        expect(err.message).toMatch(/非法状态流转|status.*transition/i);
      }
    });

    test('4.13 版本号在合法流转时递增', async () => {
      const id = await createCase('PENDING', tokens.insp.id);
      const res1 = await request(server)
        .post(`/api/cases/${id}/submit`)
        .set('Authorization', `Bearer ${tokens.insp.token}`);
      expect(res1.body.data.version).toBe(2);

      const res2 = await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'CLEAR' });
      expect(res2.body.data.version).toBe(3);
    });

    test('4.14 每次状态变更都会写入 workflow_record', async () => {
      const id = await createCase('PENDING', tokens.insp.id);

      await request(server)
        .post(`/api/cases/${id}/submit`)
        .set('Authorization', `Bearer ${tokens.insp.token}`);

      await request(server)
        .post(`/api/cases/${id}/review`)
        .set('Authorization', `Bearer ${tokens.rev.token}`)
        .send({ decision: 'REPAIR' });

      const { rows: records } = await pool.query(
        'SELECT action, from_status, to_status FROM workflow_record WHERE case_id = $1 ORDER BY created_at ASC',
        [id]
      );

      expect(records.length).toBeGreaterThanOrEqual(3);
      expect(records[0].action).toBe('CREATE');
      expect(records[1].action).toBe('SUBMIT');
      expect(records[1].from_status).toBe('PENDING');
      expect(records[1].to_status).toBe('REVIEWING');
    });
  });
});
