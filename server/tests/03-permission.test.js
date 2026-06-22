const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../setup');
const config = require('../../src/config');

describe('3. 权限越权测试', () => {
  let server;
  let tokens = {};
  let caseIds = {};
  let engineId;

  const createUser = async (username, role) => {
    const id = uuidv4();
    const pwd = await bcrypt.hash('test123456', 10);
    await pool.query(
      `INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, username, pwd, `${role}-${username}`, role]
    );
    return { id, token: jwt.sign({ userId: id, username, role }, config.jwt.secret, { expiresIn: '1h' }) };
  };

  beforeAll(async () => {
    jest.setTimeout(30000);
    delete require.cache[require.resolve('../../src/app')];
    server = require('../../src/app');

    const insp = await createUser('insp_x', 'INSPECTOR');
    const rev = await createUser('rev_x', 'REVIEWER');
    const rel = await createUser('rel_x', 'RELEASER');
    const adm = await createUser('adm_x', 'ADMIN');
    tokens = { insp, rev, rel, adm };

    engineId = uuidv4();
    await pool.query(`INSERT INTO engine (id, engine_serial, model, manufacturer) VALUES ($1, 'ENG-PERM-1', 'CFM56', 'CFM')`, [engineId]);

    caseIds.ownedByInsp = uuidv4();
    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, 'BS-PERM-OWN', $2, '2026-06-22', 'A检', 'HPT', 'PENDING', $3, $3)`,
      [caseIds.ownedByInsp, engineId, insp.id]);

    caseIds.ownedByOther = uuidv4();
    const otherId = uuidv4();
    const otherPwd = await bcrypt.hash('x', 10);
    await pool.query(`INSERT INTO app_user (id, username, password_hash, display_name, role) VALUES ($1, 'other_insp', $2, '其他判读', 'INSPECTOR')`, [otherId, otherPwd]);
    await pool.query(`
      INSERT INTO inspection_case
      (id, case_number, engine_id, inspection_date, inspection_type, section, status, inspector_id, created_by)
      VALUES ($1, 'BS-PERM-OTHER', $2, '2026-06-22', 'A检', 'HPT', 'PENDING', $3, $3)`,
      [caseIds.ownedByOther, engineId, otherId]);
  });

  afterAll(() => { try { server.close && server.close(); } catch (e) {} });

  test('3.1 未携带token访问受保护接口返回401', async () => {
    const res = await request(server).get('/api/cases');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('3.2 携带无效token返回401', async () => {
    const res = await request(server)
      .get('/api/cases')
      .set('Authorization', 'Bearer invalid_token_12345');
    expect(res.status).toBe(401);
  });

  test('3.3 判读员不能访问别人的工单详情', async () => {
    const res = await request(server)
      .get(`/api/cases/${caseIds.ownedByOther}`)
      .set('Authorization', `Bearer ${tokens.insp.token}`);
    expect(res.status).toBe(403);
  });

  test('3.4 判读员能访问自己的工单详情', async () => {
    const res = await request(server)
      .get(`/api/cases/${caseIds.ownedByInsp}`)
      .set('Authorization', `Bearer ${tokens.insp.token}`);
    expect(res.status).toBe(200);
  });

  test('3.5 复核员可以访问任意工单详情', async () => {
    const res = await request(server)
      .get(`/api/cases/${caseIds.ownedByOther}`)
      .set('Authorization', `Bearer ${tokens.rev.token}`);
    expect(res.status).toBe(200);
  });

  test('3.6 判读员不能执行复核操作', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseIds.ownedByInsp}/review`)
      .set('Authorization', `Bearer ${tokens.insp.token}`)
      .send({ decision: 'CLEAR', comment: '测试' });
    expect(res.status).toBe(403);
  });

  test('3.7 复核员不能签发放行', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseIds.ownedByInsp}/release`)
      .set('Authorization', `Bearer ${tokens.rev.token}`)
      .send({ certificateNo: 'TEST-REL-001' });
    expect(res.status).toBe(403);
  });

  test('3.8 放行工程师不能创建标注', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseIds.ownedByInsp}/annotations`)
      .set('Authorization', `Bearer ${tokens.rel.token}`)
      .send({ caseId: caseIds.ownedByInsp, imageId: uuidv4(), defectType: 'CRACK', severity: 'MAJOR', x1: 0, y1: 0, x2: 0.1, y2: 0.1 });
    expect(res.status).toBe(403);
  });

  test('3.9 非管理员不能创建用户', async () => {
    const res = await request(server)
      .post('/api/auth/users')
      .set('Authorization', `Bearer ${tokens.rev.token}`)
      .send({ username: 'hacker', password: '12345678', displayName: 'hack', role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  test('3.10 管理员可以强制关闭任意状态工单', async () => {
    const res = await request(server)
      .post(`/api/cases/${caseIds.ownedByOther}/close`)
      .set('Authorization', `Bearer ${tokens.adm.token}`)
      .send({ comment: '管理员强制关闭' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
  });

  test('3.11 管理员可以访问用户列表', async () => {
    const res = await request(server)
      .get('/api/auth/users')
      .set('Authorization', `Bearer ${tokens.adm.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
