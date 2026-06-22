const express = require('express');
const router = express.Router();
const authModel = require('../models/authModel');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { UnauthorizedError } = require('../utils/errors');

router.post('/login', validate('login'), async (req, res, next) => {
  try {
    const result = await authModel.login(req.body.username, req.body.password);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: req.user });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: '已登出' });
});

router.get('/users', authenticate, requireRole('ADMIN', 'REVIEWER', 'RELEASER'), async (req, res, next) => {
  try {
    const users = await authModel.listUsers({
      role: req.query.role,
      search: req.query.search
    });
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
});

router.post('/users', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await authModel.createUser(req.body, req.user.id);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id', authenticate, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await authModel.updateUser(req.params.id, req.body);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
