const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const imageModel = require('../models/imageModel');
const { authenticate, requirePermission, canAccessCase } = require('../middleware/auth');
const config = require('../config');
const { NotFoundError } = require('../utils/errors');

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

router.post('/', requirePermission('image', 'upload'), canAccessCase,
  upload.array('images', 50), async (req, res, next) => {
  try {
    const results = [];
    for (const file of req.files) {
      const img = await imageModel.uploadImage(req.params.caseId, file, req.body);
      results.push(img);
    }
    res.status(201).json({ success: true, data: results, count: results.length });
  } catch (err) {
    next(err);
  }
});

router.get('/', requirePermission('image', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const images = await imageModel.listImages(req.params.caseId);
    res.json({ success: true, data: images });
  } catch (err) {
    next(err);
  }
});

router.get('/:imageId', requirePermission('image', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const image = await imageModel.getImage(req.params.imageId);
    res.json({ success: true, data: image });
  } catch (err) {
    next(err);
  }
});

router.delete('/:imageId', requirePermission('image', 'upload'), canAccessCase, async (req, res, next) => {
  try {
    await imageModel.deleteImage(req.params.imageId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/:imageId/tiles/info', requirePermission('image', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const info = await imageModel.getTileInfo(req.params.imageId);
    res.json({ success: true, data: info });
  } catch (err) {
    next(err);
  }
});

router.get('/:imageId/tiles/:level/:x/:y.jpg', requirePermission('image', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const level = parseInt(req.params.level);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const image = await imageModel.getImage(req.params.imageId);
    const tilePath = path.join(config.storage.tileDir, image.tileBasePath, String(level), `${y}_${x}.jpg`);

    if (!fs.existsSync(tilePath)) {
      if (!image.hasTiles) {
        return next(new NotFoundError('图片瓦片尚未生成，请稍候重试'));
      }
      return next(new NotFoundError('瓦片不存在'));
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(tilePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/:imageId/raw', requirePermission('image', 'read'), canAccessCase, async (req, res, next) => {
  try {
    const image = await imageModel.getImage(req.params.imageId);
    const fullPath = path.resolve(config.storage.uploadDir.replace('./', ''), image.originalPath.replace('uploads/', ''));
    const absolute = path.join(process.cwd(), image.originalPath);

    if (!fs.existsSync(absolute)) {
      return next(new NotFoundError('原图文件不存在'));
    }

    res.setHeader('Content-Type', image.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(absolute).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
