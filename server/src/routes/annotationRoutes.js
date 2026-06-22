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

router.post('/sync', requirePermission('annotation', 'create'),
  canAccessCase, async (req, res, next) => {
  try {
    const result = await annotationModel.syncAnnotations(
      req.params.caseId, req.user, req.body
    );

    const changed = { created: [], updated: [], merged: [], deleted: [] };
    for (const r of result.results) {
      if (r.status === 'created' && r.data) changed.created.push(r.data);
      else if (r.status === 'updated' && r.data) changed.updated.push(r.data);
      else if (r.status === 'merged' && r.data) changed.merged.push(r.data);
      else if (r.status === 'deleted') changed.deleted.push(r.id);
    }

    const summary = {
      caseId: req.params.caseId,
      by: req.user,
      serverTimestamp: Date.now(),
      batchId: require('uuid').v4(),
      operations: req.body?.operations?.length || 0,
      results: result.results,
      serverAnnotations: result.serverAnnotations
    };

    for (const ann of changed.created) {
      collabWs.broadcastToRoom(req.params.caseId, {
        type: 'ANNOTATION_CREATED',
        payload: { annotation: ann, by: req.user, serverTimestamp: Date.now(), batchSync: true }
      });
    }
    for (const ann of [...changed.updated, ...changed.merged]) {
      collabWs.broadcastToRoom(req.params.caseId, {
        type: 'ANNOTATION_UPDATED',
        payload: { annotation: ann, by: req.user, serverTimestamp: Date.now(), batchSync: true }
      });
    }
    for (const annId of changed.deleted) {
      collabWs.broadcastToRoom(req.params.caseId, {
        type: 'ANNOTATION_DELETED',
        payload: { annotationId: annId, by: req.user, serverTimestamp: Date.now(), batchSync: true }
      });
    }

    collabWs.broadcastToRoom(req.params.caseId, {
      type: 'ANNOTATION_SYNC_COMPLETE',
      payload: summary
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
