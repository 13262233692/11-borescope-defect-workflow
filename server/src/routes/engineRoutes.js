const express = require('express');
const router = express.Router();
const engineModel = require('../models/engineModel');
const { authenticate, requirePermission } = require('../middleware/auth');

router.use(authenticate);

router.get('/', requirePermission('inspection_case', 'read'), async (req, res, next) => {
  try {
    const result = await engineModel.listEngines(
      { search: req.query.search, manufacturer: req.query.manufacturer },
      { limit: parseInt(req.query.limit || 50), offset: parseInt(req.query.offset || 0) }
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('inspection_case', 'read'), async (req, res, next) => {
  try {
    const engine = await engineModel.getEngineById(req.params.id);
    res.json({ success: true, data: engine });
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('system', 'config'), async (req, res, next) => {
  try {
    const engine = await engineModel.createEngine(req.body);
    res.status(201).json({ success: true, data: engine });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('system', 'config'), async (req, res, next) => {
  try {
    const engine = await engineModel.updateEngine(req.params.id, req.body);
    res.json({ success: true, data: engine });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
