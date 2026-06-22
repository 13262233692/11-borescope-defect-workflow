const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { query } = require('../db/pool');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new UnauthorizedError('缺少有效的认证令牌'));
    }

    const token = authHeader.slice(7);
    let decoded;

    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new UnauthorizedError('令牌已过期'));
      }
      return next(new UnauthorizedError('令牌无效'));
    }

    const { rows: [user] } = await query(
      `SELECT id, username, display_name, role, is_active, badge_number, email
       FROM app_user WHERE id = $1 AND is_active = true`,
      [decoded.userId]
    );

    if (!user) {
      return next(new UnauthorizedError('用户不存在或已禁用'));
    }

    req.user = {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      badgeNumber: user.badge_number,
      email: user.email
    };

    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(
        `需要角色 ${allowedRoles.join('/')}，当前角色 ${req.user.role}`
      ));
    }

    next();
  };
}

function requirePermission(resource, action) {
  const permissionMap = {
    'inspection_case:create': ['INSPECTOR', 'ADMIN'],
    'inspection_case:read': ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'],
    'inspection_case:submit': ['INSPECTOR', 'ADMIN'],
    'inspection_case:approve': ['REVIEWER', 'ADMIN'],
    'inspection_case:reject': ['REVIEWER', 'ADMIN'],
    'inspection_case:release': ['RELEASER', 'ADMIN'],
    'inspection_case:close': ['RELEASER', 'ADMIN'],
    'inspection_case:force_close': ['ADMIN'],
    'annotation:create': ['INSPECTOR', 'ADMIN'],
    'annotation:read': ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'],
    'annotation:update': ['INSPECTOR', 'ADMIN'],
    'annotation:delete': ['INSPECTOR', 'ADMIN'],
    'image:upload': ['INSPECTOR', 'ADMIN'],
    'image:read': ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'],
    'workflow:comment': ['INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN'],
    'certificate:generate': ['RELEASER', 'ADMIN'],
    'user:manage': ['ADMIN'],
    'system:config': ['ADMIN']
  };

  const key = `${resource}:${action}`;
  const allowedRoles = permissionMap[key] || ['ADMIN'];

  return requireRole(...allowedRoles);
}

async function canAccessCase(req, res, next) {
  try {
    const caseId = req.params.caseId || req.body.caseId;
    const { role, id: userId } = req.user;

    if (role === 'ADMIN') return next();

    const { rows: [caseRecord] } = await query(
      'SELECT inspector_id, reviewer_id FROM inspection_case WHERE id = $1',
      [caseId]
    );

    if (!caseRecord) return next();

    if (role === 'INSPECTOR' && caseRecord.inspector_id !== userId) {
      return next(new ForbiddenError('只能访问分配给您的工单'));
    }

    next();
  } catch (err) {
    next(err);
  }
}

function authenticateWS(token) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject(new UnauthorizedError('WebSocket 缺少令牌'));
    }

    jwt.verify(token, config.jwt.secret, (err, decoded) => {
      if (err) {
        return reject(new UnauthorizedError('WebSocket 令牌无效'));
      }
      resolve({
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        displayName: decoded.displayName
      });
    });
  });
}

module.exports = {
  authenticate,
  requireRole,
  requirePermission,
  canAccessCase,
  authenticateWS
};
