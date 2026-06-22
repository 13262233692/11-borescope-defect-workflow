const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const annotationModel = require('../models/annotationModel');
const { authenticate, requirePermission, canAccessCase } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const collabWs = require('../wsServer');
const logger = require('../utils/logger');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|png|gif|bmp|tiff|webp)$/;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式: ' + file.mimetype));
    }
  }
});

router.use(authenticate);

router.post('/', requirePermission('annotation', 'create'),
  canAccessCase, validate('createAnnotation'), async (req, res, next) => {
  try {
    const result = await annotationModel.createAnnotation(req.body, req.user);
    collabWs.broadcastToRoom(req.params.caseId, {
      type: 'ANNOTATION_CREATED',
      payload: { annotation: result, by: req.user, serverTimestamp: Date.now() }
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.put('/:annotationId', requirePermission('annotation', 'update'),
  canAccessCase, validate('updateAnnotation'), async (req, res, next) => {
  try {
    const result = await annotationModel.updateAnnotation(
      req.params.annotationId, req.body, req.user
    );
    collabWs.broadcastToRoom(req.params.caseId, {
      type: 'ANNOTATION_UPDATED',
      payload: { annotation: result, by: req.user, serverTimestamp: Date.now() }
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/:annotationId', requirePermission('annotation', 'delete'),
  canAccessCase, async (req, res, next) => {
  try {
    const result = await annotationModel.deleteAnnotation(
      req.params.annotationId, req.user
    );
    collabWs.broadcastToRoom(req.params.caseId, {
      type: 'ANNOTATION_DELETED',
      payload: { annotationId: req.params.annotationId, by: req.user, serverTimestamp: Date.now() }
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
