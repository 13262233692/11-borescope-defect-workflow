#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query } = require('../src/db/pool');
const config = require('../src/config');
const { ensureDir } = require('../src/utils/logger');
const logger = require('../src/utils/logger');

const { TILE_SIZE } = config.storage.tileSize;

function ensureDirFn(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function generateSampleTiles() {
  logger.info('Generating sample tiles for demo...');

  const { rows: cases } = await query('SELECT id FROM inspection_case LIMIT 5');

  for (const c of cases) {
    for (let imgIdx = 0; imgIdx < 2; imgIdx++) {
      const width = 4096;
      const height = 4096;
      const maxLevel = Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE));
      const imageId = `sample-${c.id}-${imgIdx}`;
      const tileBase = path.join(c.id, imageId);
      const tileDir = path.join(config.storage.tileDir, tileBase);
      ensureDirFn(tileDir);

      logger.info(`Generating synthetic tiles for case ${c.id} image ${imgIdx}`);

      for (let level = 0; level <= maxLevel; level++) {
        const levelWidth = Math.ceil(width / Math.pow(2, maxLevel - level));
        const levelHeight = Math.ceil(height / Math.pow(2, maxLevel - level));
        const cols = Math.max(1, Math.ceil(levelWidth / TILE_SIZE));
        const rows = Math.max(1, Math.ceil(levelHeight / TILE_SIZE));
        const levelDir = path.join(tileDir, String(level));
        ensureDirFn(levelDir);

        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const hue = ((x * 37 + y * 73 + level * 113 + imgIdx * 17) % 360);
            const tilePath = path.join(levelDir, `${y}_${x}.jpg`);
            await sharp({
              create: {
                width: TILE_SIZE,
                height: TILE_SIZE,
                channels: 3,
                background: { h: hue, s: 50 + (level * 7) % 40, l: 40 + (x + y) % 30 }
              }
            })
              .jpeg({ quality: 80 })
              .toFile(tilePath);
          }
        }
      }
    }
  }
  logger.info('Sample tile generation complete!');
}

generateSampleTiles().catch(err => {
  logger.error(err);
  process.exit(1);
});
