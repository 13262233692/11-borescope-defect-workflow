const express = require('express');
const { body, param, query } = require('express-validator');

const archiveModel = require('../models/archiveModel');
const caseModel = require('../models/caseModel');
const { authenticate, requirePermission, canAccessCase } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const logger = require('../utils/logger');
const { ValidationError, ForbiddenError } = require('../utils/errors');

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.param('caseId', canAccessCase);
router.param('archiveId', async (req, res, next, id) => {
  try {
    req.archive = await archiveModel.getArchive(id);
    next();
  } catch (e) { next(e); }
});

router.get(
  '/',
  requirePermission('archive', 'view'),
  async (req, res, next) => {
    try {
      const list = await archiveModel.listByCase(req.params.caseId);
      res.json({ success: true, data: list });
    } catch (e) { next(e); }
  }
);

router.post(
  '/',
  requirePermission('archive', 'create'),
  async (req, res, next) => {
    try {
      if (userRoleCannotArchive(req.user)) {
        throw new ForbiddenError('仅放行工程师或管理员可触发归档');
      }
      const result = await archiveModel.createArchiveTask(
        req.params.caseId, req.user, req.body || {}
      );
      res.status(202).json({ success: true, data: result });
    } catch (e) { next(e); }
  }
);

router.get(
  '/:archiveId',
  requirePermission('archive', 'view'),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: req.archive });
    } catch (e) { next(e); }
  }
);

router.post(
  '/:archiveId/retry',
  requirePermission('archive', 'retry'),
  async (req, res, next) => {
    try {
      if (userRoleCannotArchive(req.user)) {
        throw new ForbiddenError('仅放行工程师或管理员可重试归档');
      }
      if (req.archive.caseId !== req.params.caseId) {
        throw new ValidationError('归档记录与工单不匹配');
      }
      const result = await archiveModel.retryArchive(req.archive.id, req.user);
      res.status(202).json({ success: true, data: result });
    } catch (e) { next(e); }
  }
);

router.get(
  '/:archiveId/download',
  requirePermission('archive', 'download'),
  async (req, res, next) => {
    try {
      if (req.archive.caseId !== req.params.caseId) {
        throw new ValidationError('归档记录与工单不匹配');
      }
      if (req.archive.status !== 'COMPLETED') {
        throw new ValidationError(
          `仅 COMPLETED 状态可下载（当前: ${req.archive.status}）`
        );
      }
      const fullPath = require('path').join(archiveModel.ARCHIVE_DIR, req.archive.packagePath);
      if (!require('fs').existsSync(fullPath)) {
        throw new ValidationError('归档包文件已丢失，请重新归档');
      }
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition',
        `attachment; filename="${encodeURIComponent(req.archive.packageName || 'archive.tar.gz')}"`);
      if (req.archive.packageSize) res.setHeader('Content-Length', req.archive.packageSize);
      if (req.archive.checksumSha256) res.setHeader('X-Package-Checksum', req.archive.checksumSha256);
      require('fs').createReadStream(fullPath).pipe(res);
    } catch (e) { next(e); }
  }
);

function userRoleCannotArchive(user) {
  return user.role !== 'RELEASER' && user.role !== 'ADMIN';
}

module.exports = router;
