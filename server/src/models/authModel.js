const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');
const { UnauthorizedError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

async function login(username, password) {
  const { rows: [user] } = await query(
    `SELECT id, username, password_hash, display_name, role, is_active, badge_number, email
     FROM app_user WHERE username = $1`,
    [username]
  );

  if (!user) {
    logger.warn(`Login failed: user not found - ${username}`);
    throw new UnauthorizedError('用户名或密码错误');
  }

  if (!user.is_active) {
    logger.warn(`Login failed: account disabled - ${username}`);
    throw new UnauthorizedError('账号已被禁用');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    logger.warn(`Login failed: invalid password - ${username}`);
    throw new UnauthorizedError('用户名或密码错误');
  }

  await query(
    'UPDATE app_user SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  logger.info(`User login successful: ${username} (${user.role})`);

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      badgeNumber: user.badge_number,
      email: user.email
    }
  };
}

async function getUserById(id) {
  const { rows: [user] } = await query(
    `SELECT id, username, display_name, role, email, phone, badge_number,
            is_active, last_login_at, created_at, updated_at
     FROM app_user WHERE id = $1`,
    [id]
  );
  return user;
}

async function listUsers(filters = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.role) {
    conditions.push(`role = $${idx++}`);
    params.push(filters.role);
  }
  if (filters.search) {
    conditions.push(`(username ILIKE $${idx} OR display_name ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT id, username, display_name, role, email, badge_number,
            is_active, last_login_at, created_at
     FROM app_user ${where}
     ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function createUser(data, createdBy) {
  const passwordHash = await bcrypt.hash(data.password, 10);
  const { rows: [user] } = await query(
    `INSERT INTO app_user
     (username, password_hash, display_name, role, email, phone, badge_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, username, display_name, role, email, badge_number`,
    [data.username, passwordHash, data.displayName, data.role,
     data.email, data.phone, data.badgeNumber]
  );
  logger.info(`User created: ${user.username} (${user.role}) by ${createdBy}`);
  return user;
}

async function updateUser(id, data) {
  const updates = [];
  const params = [];
  let idx = 1;

  if (data.displayName !== undefined) {
    updates.push(`display_name = $${idx++}`); params.push(data.displayName);
  }
  if (data.role !== undefined) {
    updates.push(`role = $${idx++}`); params.push(data.role);
  }
  if (data.email !== undefined) {
    updates.push(`email = $${idx++}`); params.push(data.email);
  }
  if (data.isActive !== undefined) {
    updates.push(`is_active = $${idx++}`); params.push(data.isActive);
  }
  if (data.password) {
    updates.push(`password_hash = $${idx++}`);
    params.push(await bcrypt.hash(data.password, 10));
  }

  if (!updates.length) {
    return getUserById(id);
  }

  params.push(id);
  const { rows: [user] } = await query(
    `UPDATE app_user SET ${updates.join(', ')}
     WHERE id = $${idx}
     RETURNING id, username, display_name, role, email, badge_number, is_active`,
    params
  );
  return user;
}

module.exports = {
  login,
  getUserById,
  listUsers,
  createUser,
  updateUser
};
