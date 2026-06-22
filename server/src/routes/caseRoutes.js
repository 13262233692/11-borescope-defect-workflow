const express = require('express');
const router = express.Router();
const caseModel = require('../models/caseModel');
const annotationModel = require('../models/annotationModel');
const { authenticate, requirePermission, canAccessCase } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const collabWs = require('../wsServer');

router.use(authenticate);

router.get('/', requirePermission('inspection_case', 'read'), async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      engineId: req.query.engineId,
      search: req.query.search,
      inspectionDateFrom: req.query.dateFrom,
      inspectionDateTo: req.query.dateTo
    };
    const pagination = {
      limit: parseInt(req.query.limit || 30),
      offset: parseInt(req.query.offset || 0)
    };
    const result = await caseModel.listCases(filters, req.user, pagination);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('inspection_case', 'create'), validate('createCase'), async (req, res, next) => {
  try {
    const newCase = await caseModel.createCase(req.body, req.user);
    res.status(201).json({ success: true, data: newCase });
  } catch (err) {
    next(err);
  }
});

router.get('/:caseId', requirePermission('inspection_case', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const detail = await caseModel.getCaseById(req.params.caseId, req.user);
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
});

router.put('/:caseId', requirePermission('inspection_case', 'submit'), canAccessCase, validate('updateCase'), async (req, res, next) => {
  try {
    res.json({ success: true, message: '使用工作流接口更新状态' });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/submit', requirePermission('inspection_case', 'submit'), canAccessCase, async (req, res, next) => {
  try {
    const result = await caseModel.submitForReview(
      req.params.caseId, req.user, req.body.summary, req.body.conclusion
    );
    collabWs.handleCaseStatusChange(
      { user: req.user, id: 'server' },
      { caseId: req.params.caseId, fromStatus: 'PENDING', toStatus: 'REVIEWING' }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/review', requirePermission('inspection_case', 'approve'), canAccessCase, async (req, res, next) => {
  try {
    const { decision, comment } = req.body;
    if (decision === 'REJECT') {
      const result = await caseModel.rejectReview(req.params.caseId, req.user, comment);
      collabWs.handleCaseStatusChange(
        { user: req.user, id: 'server' },
        { caseId: req.params.caseId, fromStatus: 'REVIEWING', toStatus: 'PENDING' }
      );
      return res.json({ success: true, data: result });
    }
    const result = await caseModel.reviewCase(req.params.caseId, req.user, decision, comment);
    collabWs.handleCaseStatusChange(
      { user: req.user, id: 'server' },
      { caseId: req.params.caseId, fromStatus: 'REVIEWING', toStatus: decision }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/release', requirePermission('inspection_case', 'release'), canAccessCase, async (req, res, next) => {
  try {
    const result = await caseModel.releaseCase(
      req.params.caseId, req.user, req.body.certificateNo, req.body.comment
    );
    collabWs.handleCaseStatusChange(
      { user: req.user, id: 'server' },
      { caseId: req.params.caseId, fromStatus: 'CLEAR', toStatus: 'CLOSED' }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/close', requirePermission('inspection_case', 'close'), canAccessCase, async (req, res, next) => {
  try {
    const detail = await caseModel.getCaseById(req.params.caseId, req.user);
    const result = await caseModel.closeCase(req.params.caseId, req.user, req.body.comment);
    collabWs.handleCaseStatusChange(
      { user: req.user, id: 'server' },
      { caseId: req.params.caseId, fromStatus: detail.status, toStatus: 'CLOSED' }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/reopen', requirePermission('inspection_case', 'submit'), canAccessCase, async (req, res, next) => {
  try {
    const result = await caseModel.reopenForReview(
      req.params.caseId, req.user, req.body.comment
    );
    collabWs.handleCaseStatusChange(
      { user: req.user, id: 'server' },
      { caseId: req.params.caseId, fromStatus: 'REPAIR', toStatus: 'REVIEWING' }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:caseId/comments', requirePermission('workflow', 'comment'), canAccessCase, async (req, res, next) => {
  try {
    const result = await caseModel.addComment(
      req.params.caseId, req.user, req.body.comment
    );
    collabWs.broadcastToRoom(req.params.caseId, {
      type: 'NEW_COMMENT',
      payload: { comment: result, by: req.user, serverTimestamp: Date.now() }
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/:caseId/annotations', requirePermission('annotation', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const annotations = await annotationModel.listAnnotations({
      caseId: req.params.caseId,
      severity: req.query.severity,
      defectType: req.query.defectType
    });
    res.json({ success: true, data: annotations });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
