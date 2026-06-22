const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../db/pool');
const config = require('../config');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger');

const TILE_SIZE = config.storage.tileSize;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function uploadImage(caseId, file, metadata = {}) {
  ensureDir(config.storage.uploadDir);
  ensureDir(config.storage.tileDir);

  const imageId = uuidv4();
  const ext = path.extname(file.originalname).toLowerCase() || '.png';
  const safeName = `${imageId}${ext}`;
  const uploadPath = path.join(config.storage.uploadDir, caseId);
  ensureDir(uploadPath);

  const fullPath = path.join(uploadPath, safeName);
  fs.writeFileSync(fullPath, file.buffer);

  let imgMeta;
  try {
    imgMeta = await sharp(file.buffer).metadata();
  } catch (e) {
    throw new ValidationError('无法解析图片文件: ' + e.message);
  }

  const width = imgMeta.width;
  const height = imgMeta.height;

  if (width > 16384 || height > 16384) {
    throw new ValidationError('图片尺寸超过最大限制 (16384x16384)');
  }

  const maxLevel = Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)));

  const tileBase = path.join(caseId, imageId);
  const tileDir = path.join(config.storage.tileDir, tileBase);
  ensureDir(tileDir);

  const thumbDir = path.join(config.storage.uploadDir, caseId, 'thumbs');
  ensureDir(thumbDir);
  const thumbPath = path.join('uploads', caseId, 'thumbs', `${imageId}.jpg`);
  const thumbFullPath = path.join(config.storage.uploadDir, caseId, 'thumbs', `${imageId}.jpg`);

  await sharp(file.buffer)
    .resize(400, 300, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toFile(thumbFullPath);

  const { rows: [image] } = await query(
    `INSERT INTO inspection_image
     (id, case_id, file_name, original_path, mime_type, file_size,
      width, height, tile_size, max_level, has_tiles, tile_base_path,
      thumbnail_path, description, capture_datetime, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [imageId, caseId, file.originalname,
     path.join('uploads', caseId, safeName),
     file.mimetype || imgMeta.format,
     file.size,
     width, height, TILE_SIZE, maxLevel,
     false, tileBase, thumbPath,
     metadata.description,
     metadata.captureDatetime || new Date(),
     metadata.sortOrder || 0]
  );

  generateTilesAsync(imageId, file.buffer, tileDir, width, height, maxLevel, TILE_SIZE);

  logger.info(`Image uploaded: ${imageId} (${width}x${height}, maxLevel=${maxLevel}) for case ${caseId}`);

  return formatImage(image);
}

async function generateTilesAsync(imageId, buffer, tileDir, width, height, maxLevel, tileSize) {
  setImmediate(async () => {
    try {
      logger.info(`Start tile generation: ${imageId}`);
      await generateTiles(imageId, buffer, tileDir, width, height, maxLevel, tileSize);
      await query('UPDATE inspection_image SET has_tiles = true WHERE id = $1', [imageId]);
      logger.info(`Tile generation completed: ${imageId}`);
    } catch (err) {
      logger.error(`Tile generation failed for ${imageId}:`, err.message);
    }
  });
}

async function generateTiles(imageId, buffer, tileDir, width, height, maxLevel, tileSize) {
  const tiles = [];

  for (let level = 0; level <= maxLevel; level++) {
    const levelWidth = Math.ceil(width / Math.pow(2, maxLevel - level));
    const levelHeight = Math.ceil(height / Math.pow(2, maxLevel - level));
    const cols = Math.max(1, Math.ceil(levelWidth / tileSize));
    const rows = Math.max(1, Math.ceil(levelHeight / tileSize));
    const levelDir = path.join(tileDir, String(level));
    ensureDir(levelDir);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const tilePath = path.join(levelDir, `${y}_${x}.jpg`);
        const srcX = Math.floor(x * tileSize * Math.pow(2, maxLevel - level));
        const srcY = Math.floor(y * tileSize * Math.pow(2, maxLevel - level));
        const srcW = Math.min(tileSize * Math.pow(2, maxLevel - level), width - srcX);
        const srcH = Math.min(tileSize * Math.pow(2, maxLevel - level), height - srcY);
        const dstW = Math.ceil(srcW / Math.pow(2, maxLevel - level));
        const dstH = Math.ceil(srcH / Math.pow(2, maxLevel - level));

        await sharp(buffer)
          .extract({ left: srcX, top: srcY, width: srcW, height: srcH })
          .resize(dstW, dstH)
          .jpeg({ quality: 85 })
          .toFile(tilePath);

        tiles.push({
          image_id: imageId,
          zoom_level: level,
          tile_x: x,
          tile_y: y,
          tile_path: tilePath.replace(config.storage.tileDir, 'tiles'),
          width: dstW,
          height: dstH
        });
      }
    }
  }

  if (tiles.length) {
    const placeholders = tiles.map((_, i) => {
      const base = i * 7;
      return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`;
    }).join(',');
    const values = tiles.flatMap(t => [
      t.image_id, t.zoom_level, t.tile_x, t.tile_y, t.tile_path, t.width, t.height
    ]);

    await query(
      `INSERT INTO image_tile
       (image_id, zoom_level, tile_x, tile_y, tile_path, width, height)
       VALUES ${placeholders}
       ON CONFLICT (image_id, zoom_level, tile_x, tile_y) DO UPDATE SET tile_path = EXCLUDED.tile_path`,
      values
    );
  }

  return tiles.length;
}

async function listImages(caseId) {
  const { rows } = await query(
    'SELECT * FROM inspection_image WHERE case_id = $1 ORDER BY sort_order, created_at',
    [caseId]
  );
  return rows.map(formatImage);
}

async function getImage(id) {
  const { rows: [image] } = await query(
    'SELECT * FROM inspection_image WHERE id = $1',
    [id]
  );
  if (!image) throw new NotFoundError('图片不存在');
  return formatImage(image);
}

async function deleteImage(id) {
  const image = await getImage(id);
  try {
    const fullPath = path.join(config.storage.tileDir, image.tileBasePath);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  } catch (e) {
    logger.warn(`Failed to delete tiles for image ${id}:`, e.message);
  }
  await query('DELETE FROM inspection_image WHERE id = $1', [id]);
  return true;
}

async function getTile(imageId, level, x, y) {
  const { rows: [tile] } = await query(
    'SELECT * FROM image_tile WHERE image_id = $1 AND zoom_level = $2 AND tile_x = $3 AND tile_y = $4',
    [imageId, level, x, y]
  );
  if (!tile) throw new NotFoundError('瓦片不存在');
  return tile;
}

async function getTileInfo(imageId) {
  const image = await getImage(imageId);
  return {
    imageId,
    width: image.width,
    height: image.height,
    tileSize: image.tileSize,
    maxLevel: image.maxLevel,
    hasTiles: image.hasTiles,
    tileBasePath: image.tileBasePath
  };
}

function formatImage(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    fileName: row.file_name,
    originalPath: row.original_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    tileSize: row.tile_size,
    maxLevel: row.max_level,
    hasTiles: row.has_tiles,
    tileBasePath: row.tile_base_path,
    thumbnailPath: row.thumbnail_path,
    description: row.description,
    captureDatetime: row.capture_datetime,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  };
}

module.exports = {
  uploadImage,
  generateTiles,
  listImages,
  getImage,
  deleteImage,
  getTile,
  getTileInfo,
  TILE_SIZE
};
