const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { query, transaction } = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');
const {
  NotFoundError,
  ValidationError,
  ConflictError,
  ForbiddenError
} = require('../utils/errors');

const ARCHIVE_DIR = path.resolve(
  process.env.ARCHIVE_DIR || path.join(__dirname, '..', '..', 'archives')
);
const ARCHIVE_STATIC_PREFIX = '/static/archives';

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  const caseDir = path.join(ARCHIVE_DIR, 'cases');
  if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
}
ensureArchiveDir();

const ARCHIVE_DEFS = [
  { key: 'defect_json',      file: 'defect.json' },
  { key: 'workflow_csv',     file: 'workflow.csv' },
  { key: 'image_manifest',   file: 'image_manifest.csv' },
  { key: 'release_note_pdf', file: 'release_note.pdf' }
];

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

async function isCaseArchived(caseId) {
  const { rows } = await query(
    "SELECT COUNT(1) AS c FROM archive_record WHERE case_id = $1 AND status = 'COMPLETED'",
    [caseId]
  );
  return Number(rows[0].c) > 0;
}

function isCaseClosable(status) {
  return ['CLEAR', 'CLOSED'].includes(status);
}

async function listByCase(caseId) {
  const { rows } = await query(
    `SELECT a.*, u.display_name AS creator_name
     FROM archive_record a
     LEFT JOIN app_user u ON a.created_by = u.id
     WHERE a.case_id = $1
     ORDER BY a.created_at DESC`,
    [caseId]
  );
  return rows.map(formatArchive);
}

async function getArchive(id) {
  const { rows } = await query(
    `SELECT a.*, u.display_name AS creator_name
     FROM archive_record a
     LEFT JOIN app_user u ON a.created_by = u.id
     WHERE a.id = $1`,
    [id]
  );
  if (!rows[0]) throw new NotFoundError('归档记录不存在');
  return formatArchive(rows[0]);
}

async function createArchiveTask(caseId, user, options = {}) {
  return transaction(async (client) => {
    const { rows: [kase] } = await client.query(
      `SELECT c.*, e.engine_serial, e.model AS engine_model,
              u1.display_name AS inspector_name,
              u2.display_name AS reviewer_name,
              u3.display_name AS releaser_name
       FROM inspection_case c
       LEFT JOIN engine e ON c.engine_id = e.id
       LEFT JOIN app_user u1 ON c.inspector_id = u1.id
       LEFT JOIN app_user u2 ON c.reviewer_id = u2.id
       LEFT JOIN app_user u3 ON c.releaser_id = u3.id
       WHERE c.id = $1`,
      [caseId]
    );
    if (!kase) throw new NotFoundError('工单不存在');

    if (!isCaseClosable(kase.status)) {
      throw new ValidationError(
        `仅 CLEAR 或 CLOSED 状态的工单可归档（当前: ${kase.status}）`
      );
    }

    const { rows: [existingCompleted] } = await client.query(
      "SELECT id FROM archive_record WHERE case_id = $1 AND status = 'COMPLETED'",
      [caseId]
    );
    if (existingCompleted) {
      throw new ConflictError('该工单已有完成的归档，不允许重复归档');
    }

    const { rows: [pendingTask] } = await client.query(
      "SELECT id FROM archive_record WHERE case_id = $1 AND status IN ('PENDING', 'PROCESSING')",
      [caseId]
    );
    if (pendingTask) {
      throw new ConflictError('该工单已有正在进行的归档任务，请稍后再试');
    }

    const archiveId = uuidv4();
    const releaseNumber = `REL-${kase.case_number}-${Date.now().toString(36).toUpperCase()}`;

    await client.query(
      `INSERT INTO archive_record
       (id, case_id, status, release_number, release_note_text, created_by)
       VALUES ($1, $2, 'PENDING', $3, $4, $5)`,
      [archiveId, caseId, releaseNumber, options.releaseNote || '', user.id]
    );

    setImmediate(() => {
      executeArchiveJob(archiveId).catch(err => {
        logger.error(`[archive] job failed for ${archiveId}:`, err);
        markFailed(archiveId, err.message).catch(() => {});
      });
    });

    const { rows: [saved] } = await client.query(
      `SELECT a.*, u.display_name AS creator_name
       FROM archive_record a LEFT JOIN app_user u ON a.created_by = u.id WHERE a.id = $1`,
      [archiveId]
    );
    return formatArchive(saved);
  });
}

async function retryArchive(archiveId, user) {
  return transaction(async (client) => {
    const { rows: [rec] } = await client.query(
      'SELECT * FROM archive_record WHERE id = $1 FOR UPDATE',
      [archiveId]
    );
    if (!rec) throw new NotFoundError('归档记录不存在');
    if (rec.status !== 'FAILED') {
      throw new ConflictError(`仅 FAILED 状态的归档可重试（当前: ${rec.status}）`);
    }
    if (rec.retry_count >= rec.max_retries) {
      throw new ConflictError(`已达到最大重试次数 (${rec.max_retries})`);
    }

    await client.query(
      `UPDATE archive_record
       SET status = 'PENDING', retry_count = retry_count + 1, last_error = NULL
       WHERE id = $1`,
      [archiveId]
    );

    setImmediate(() => {
      executeArchiveJob(archiveId).catch(err => {
        logger.error(`[archive] retry failed for ${archiveId}:`, err);
        markFailed(archiveId, err.message).catch(() => {});
      });
    });

    const { rows: [saved] } = await client.query(
      `SELECT a.*, u.display_name AS creator_name
       FROM archive_record a LEFT JOIN app_user u ON a.created_by = u.id WHERE a.id = $1`,
      [archiveId]
    );
    return formatArchive(saved);
  });
}

async function markFailed(archiveId, errorMessage) {
  await query(
    `UPDATE archive_record SET status = 'FAILED', last_error = $1 WHERE id = $2`,
    [String(errorMessage).slice(0, 1000), archiveId]
  );
}

async function executeArchiveJob(archiveId) {
  await query(
    `UPDATE archive_record SET status = 'PROCESSING', started_at = NOW() WHERE id = $1`,
    [archiveId]
  );
  logger.info(`[archive] start job ${archiveId}`);

  try {
    const { rows: [archive] } = await query(
      'SELECT * FROM archive_record WHERE id = $1', [archiveId]
    );
    if (!archive) throw new NotFoundError('归档记录不存在');

    const caseDir = path.join(ARCHIVE_DIR, 'cases', archive.case_id, archive.id);
    fs.mkdirSync(caseDir, { recursive: true });

    const payload = await gatherArchiveData(archive.case_id);

    const manifest = [];

    const defectPath = writeDefectJson(caseDir, payload);
    manifest.push({ file: 'defect.json', size: fs.statSync(defectPath).size,
      sha256: sha256File(defectPath), bytes_path: defectPath });

    const wfPath = writeWorkflowCsv(caseDir, payload);
    manifest.push({ file: 'workflow.csv', size: fs.statSync(wfPath).size,
      sha256: sha256File(wfPath), bytes_path: wfPath });

    const imgPath = writeImageManifestCsv(caseDir, payload);
    manifest.push({ file: 'image_manifest.csv', size: fs.statSync(imgPath).size,
      sha256: sha256File(imgPath), bytes_path: imgPath });

    const notePath = writeReleaseNotePdf(caseDir, payload, archive);
    manifest.push({ file: 'release_note.pdf', size: fs.statSync(notePath).size,
      sha256: sha256File(notePath), bytes_path: notePath });

    for (const item of payload.images) {
      const targetFile = `images/${item.id}_${item.file_name}`;
      const targetPath = path.join(caseDir, targetFile);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      let copyDone = false;
      if (item.original_path && fs.existsSync(item.original_path)) {
        try { fs.copyFileSync(item.original_path, targetPath); copyDone = true; }
        catch (e) { logger.warn('copy original fail:', e.message); }
      }
      if (!copyDone) {
        fs.writeFileSync(targetPath, Buffer.alloc(0));
      }
      manifest.push({
        file: targetFile,
        size: fs.statSync(targetPath).size,
        sha256: sha256File(targetPath),
        bytes_path: targetPath
      });
    }

    const tarPath = path.join(ARCHIVE_DIR, 'cases', archive.case_id);
    fs.mkdirSync(tarPath, { recursive: true });
    const pkgFileName = `${archive.case_number || 'CASE'}_${archive.release_number}_${formatDate(archive.created_at).slice(0,10).replace(/-/g,'')}.tar.gz`;
    const pkgFullPath = path.join(tarPath, pkgFileName);
    createTarGz(caseDir, pkgFullPath, manifest);

    const pkgSize = fs.statSync(pkgFullPath).size;
    const pkgHash = sha256File(pkgFullPath);

    const relativePkg = path.relative(ARCHIVE_DIR, pkgFullPath);

    await query(
      `UPDATE archive_record
       SET status = 'COMPLETED', package_path = $1, package_name = $2,
           package_size = $3, checksum_sha256 = $4,
           image_count = $5, annotation_count = $6, workflow_count = $7,
           completed_at = NOW()
       WHERE id = $8`,
      [relativePkg, pkgFileName, pkgSize, pkgHash,
       payload.images.length, payload.annotations.length, payload.workflow.length,
       archiveId]
    );
    logger.info(`[archive] completed ${archiveId} -> ${pkgFileName} (${pkgSize}B)`);
  } catch (err) {
    logger.error(`[archive] execute fail ${archiveId}:`, err);
    await markFailed(archiveId, err.stack || err.message);
    throw err;
  }
}

async function gatherArchiveData(caseId) {
  const { rows: [kase] } = await query(
    `SELECT c.*, e.engine_serial, e.model AS engine_model,
            e.manufacturer, e.tsn, e.csn,
            u1.display_name AS inspector_name,
            u2.display_name AS reviewer_name,
            u3.display_name AS releaser_name
     FROM inspection_case c
     LEFT JOIN engine e ON c.engine_id = e.id
     LEFT JOIN app_user u1 ON c.inspector_id = u1.id
     LEFT JOIN app_user u2 ON c.reviewer_id = u2.id
     LEFT JOIN app_user u3 ON c.releaser_id = u3.id
     WHERE c.id = $1`,
    [caseId]
  );

  const { rows: images } = await query(
    `SELECT * FROM inspection_image WHERE case_id = $1 ORDER BY created_at`,
    [caseId]
  );

  const { rows: annotations } = await query(
    `SELECT a.*, u.display_name AS creator_name, u.badge_number AS creator_badge
     FROM defect_annotation a
     LEFT JOIN app_user u ON a.created_by = u.id
     WHERE a.case_id = $1 AND a.is_deleted = false
     ORDER BY a.created_at`,
    [caseId]
  );

  const { rows: workflow } = await query(
    `SELECT w.*, u.display_name AS actor_name, u.role AS actor_role,
            u.badge_number AS actor_badge
     FROM workflow_record w
     LEFT JOIN app_user u ON w.actor_id = u.id
     WHERE w.case_id = $1
     ORDER BY w.created_at`,
    [caseId]
  );

  return { kase, images, annotations, workflow };
}

function writeDefectJson(dir, payload) {
  const out = {
    export_version: '1.0',
    exported_at: new Date().toISOString(),
    case: {
      case_number: payload.kase.case_number,
      status: payload.kase.status,
      engine: {
        serial: payload.kase.engine_serial,
        model: payload.kase.engine_model,
        manufacturer: payload.kase.manufacturer,
        tsn: payload.kase.tsn, csn: payload.kase.csn
      },
      inspection: {
        type: payload.kase.inspection_type,
        section: payload.kase.section,
        stage: payload.kase.stage,
        location: payload.kase.location,
        date: payload.kase.inspection_date,
        scope: payload.kase.inspection_scope,
        hours: payload.kase.inspection_hours,
        summary: payload.kase.inspection_summary
      },
      personnel: {
        inspector: payload.kase.inspector_name,
        reviewer: payload.kase.reviewer_name,
        releaser: payload.kase.releaser_name
      },
      decision: {
        repair_needed: payload.kase.status === 'REPAIR' || payload.kase.repair_needed === true,
        repair_deadline: payload.kase.repair_deadline,
        repair_instructions: payload.kase.repair_instructions,
        release_note: payload.kase.release_note,
        released_at: payload.kase.released_at,
        closed_at: payload.kase.closed_at
      }
    },
    annotations: payload.annotations.map(a => ({
      id: a.id,
      image_id: a.image_id,
      defect_type: a.defect_type,
      severity: a.severity,
      description: a.description,
      box: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 },
      polygon: a.polygon,
      measurement: a.measurement,
      measurement_unit: a.measurement_unit,
      created_by: { name: a.creator_name, badge: a.creator_badge },
      created_at: a.created_at,
      updated_at: a.updated_at,
      version: a.version
    }))
  };
  const filePath = path.join(dir, 'defect.json');
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  return filePath;
}

function writeWorkflowCsv(dir, payload) {
  const headers = [
    'ID', 'Timestamp', 'Actor', 'Role', 'Badge',
    'Action', 'From', 'To', 'AnnotationID', 'Comment', 'Metadata'
  ];
  const lines = [headers.map(csvEscape).join(',')];
  for (const w of payload.workflow) {
    lines.push([
      w.id,
      formatDate(w.created_at),
      w.actor_name,
      w.actor_role,
      w.actor_badge,
      w.action,
      w.from_status,
      w.to_status,
      w.annotation_id || '',
      w.comment || '',
      w.metadata ? JSON.stringify(w.metadata) : ''
    ].map(csvEscape).join(','));
  }
  const filePath = path.join(dir, 'workflow.csv');
  fs.writeFileSync(filePath, '\ufeff' + lines.join('\n'), 'utf8');
  return filePath;
}

function writeImageManifestCsv(dir, payload) {
  const headers = [
    'ImageID', 'FileName', 'TileBasePath',
    'Width', 'Height', 'TileSize', 'MaxLevel', 'HasTiles',
    'OriginalPath', 'ThumbnailPath', 'AnnotationCount', 'SHA256'
  ];
  const annByImage = new Map();
  for (const a of payload.annotations) {
    annByImage.set(a.image_id, (annByImage.get(a.image_id) || 0) + 1);
  }
  const lines = [headers.map(csvEscape).join(',')];
  for (const img of payload.images) {
    const targetFile = `images/${img.id}_${img.file_name}`;
    const absPath = path.join(dir, targetFile);
    const sha = fs.existsSync(absPath) ? sha256File(absPath) : '';
    lines.push([
      img.id, img.file_name, img.tile_base_path,
      img.width, img.height, img.tile_size, img.max_level,
      img.has_tiles ? 'YES' : 'NO',
      img.original_path, img.thumbnail_path,
      annByImage.get(img.id) || 0, sha
    ].map(csvEscape).join(','));
  }
  const filePath = path.join(dir, 'image_manifest.csv');
  fs.writeFileSync(filePath, '\ufeff' + lines.join('\n'), 'utf8');
  return filePath;
}

function writeReleaseNotePdf(dir, payload, archive) {
  const kase = payload.kase;
  const critical = payload.annotations.filter(a => a.severity === 'CRITICAL').length;
  const major = payload.annotations.filter(a => a.severity === 'MAJOR').length;
  const moderate = payload.annotations.filter(a => a.severity === 'MODERATE').length;
  const minor = payload.annotations.filter(a => a.severity === 'MINOR').length;

  const lines = [
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`,
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`,
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj`,
    `5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`,
    `6 0 obj<</Title(${archive.release_number || 'Release Note'})/Author(Airworthiness Office)/Creator(Borescope Workflow)>>endobj`
  ];

  let y = 750;
  const content = [];
  const addText = (text, size = 10, indent = 40) => {
    content.push(`BT /F1 ${size} Tf ${indent} ${y} Td (${escapePdf(String(text))}) Tj ET`);
    y -= (size + 6);
  };

  addText('AIRWORTHINESS RELEASE NOTE', 18, 60); y -= 20;
  addText(`Certificate No.: ${archive.release_number}`, 11);
  addText(`Date: ${formatDate(new Date())}`, 11);
  addText(`Case Number: ${kase.case_number}`, 11); y -= 10;

  addText('--- ENGINE ---', 12);
  addText(`Serial: ${kase.engine_serial}`);
  addText(`Model:  ${kase.engine_model}  (${kase.manufacturer})`);
  addText(`TSN: ${kase.tsn} h / CSN: ${kase.csn} cycles`); y -= 10;

  addText('--- INSPECTION ---', 12);
  addText(`Type: ${kase.inspection_type}  Section: ${kase.section}${kase.stage ? ' / Stage: '+kase.stage : ''}`);
  addText(`Date: ${kase.inspection_date}   Hours: ${kase.inspection_hours}`); y -= 10;

  addText('--- PERSONNEL ---', 12);
  addText(`Inspector: ${kase.inspector_name}`);
  addText(`Reviewer:  ${kase.reviewer_name}`);
  addText(`Releaser:  ${kase.releaser_name}`); y -= 10;

  addText('--- DEFECT SUMMARY ---', 12);
  addText(`CRITICAL  : ${critical}`);
  addText(`MAJOR     : ${major}`);
  addText(`MODERATE  : ${moderate}`);
  addText(`MINOR     : ${minor}`);
  addText(`Total defects: ${payload.annotations.length} in ${payload.images.length} images`); y -= 10;

  addText('--- DECISION ---', 12);
  const disposition = kase.status === 'CLOSED' ? 'CLOSED' : 'RELEASED FOR SERVICE';
  addText(`Disposition: ${disposition}`);
  if (kase.repair_needed || kase.status === 'REPAIR') {
    addText(`Repair required: YES`);
    addText(`Deadline: ${kase.repair_deadline || 'N/A'}`);
  } else {
    addText(`Repair required: NO`);
  }
  addText(`Release note: ${kase.release_note || archive.release_note_text || 'N/A'}`, 10); y -= 20;
  addText(`Signoff: __________________  ${kase.releaser_name}`, 11);

  lines.push(`4 0 obj<</Length ${content.join('\n').length}>>stream\n${content.join('\n')}\nendstream\nendobj`);
  lines.push(`7 0 obj<</Count 7/Kids[1 0 R 2 0 R 3 0 R 4 0 R 5 0 R 6 0 R]>>endobj`);
  lines.push('xref\n0 8\n0000000000 65535 f ');
  let offset = 0;
  const xref = [];
  for (let i = 0; i < lines.length; i++) {
    xref.push(padLeft(offset, 10) + ' 00000 n ');
    offset += Buffer.byteLength(lines[i] + '\n');
  }
  const startXref = offset;
  lines.push(`trailer<</Size 8/Root 1 0 R/Info 6 0 R>>`);
  lines.push(`startxref\n${startXref}\n%%EOF`);

  const filePath = path.join(dir, 'release_note.pdf');
  fs.writeFileSync(filePath, lines.join('\n'), 'binary');
  return filePath;
}

function escapePdf(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\u0080-\uffff]/g, '?');
}
function padLeft(n, len) { return String(n).padStart(len, '0'); }

function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  if (!fs.existsSync(filePath)) return '';
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function createTarGz(sourceDir, targetPath, manifest) {
  const blocks = [];
  const pushStr = (s) => blocks.push(Buffer.from(s, 'binary'));

  for (const item of manifest) {
    const relName = item.file;
    const size = item.size || 0;
    blocks.push(buildTarHeader(relName, size));
    const content = fs.readFileSync(item.bytes_path);
    blocks.push(content);
    const pad = (512 - (size % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  const tarBuf = Buffer.concat(blocks);
  const gzBuf = zlib.gzipSync(tarBuf, { level: 9 });
  fs.writeFileSync(targetPath, gzBuf);
}

function buildTarHeader(name, size) {
  const buf = Buffer.alloc(512);
  const enc = (s, max) => Buffer.from(String(s).slice(0, max - 1) + '\0', 'utf8');
  enc(name, 100).copy(buf, 0);
  enc('0000777', 8).copy(buf, 100);
  enc('0000000', 8).copy(buf, 108);
  enc('0000000', 8).copy(buf, 116);
  enc(size.toString(8).padStart(11, '0'), 12).copy(buf, 124);
  enc(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'), 12).copy(buf, 136);
  buf.write('        ', 148, 8);
  enc('ustar', 6).copy(buf, 257);
  buf.write('00', 263, 2);
  const chksum = buf.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0');
  enc(chksum + '\0 ', 8).copy(buf, 148);
  return buf;
}

function formatArchive(a) {
  if (!a) return null;
  return {
    id: a.id,
    caseId: a.case_id,
    status: a.status,
    releaseNumber: a.release_number,
    releaseNoteText: a.release_note_text,
    packagePath: a.package_path,
    packageName: a.package_name,
    packageSize: Number(a.package_size || 0),
    packageUrl: a.package_path ? `${ARCHIVE_STATIC_PREFIX}/${a.package_path.replace(/\\/g, '/')}` : null,
    checksumSha256: a.checksum_sha256,
    imageCount: Number(a.image_count || 0),
    annotationCount: Number(a.annotation_count || 0),
    workflowCount: Number(a.workflow_count || 0),
    retryCount: Number(a.retry_count || 0),
    maxRetries: Number(a.max_retries || 0),
    lastError: a.last_error,
    startedAt: a.started_at,
    completedAt: a.completed_at,
    createdByName: a.creator_name,
    createdAt: a.created_at,
    updatedAt: a.updated_at
  };
}

module.exports = {
  listByCase,
  getArchive,
  createArchiveTask,
  retryArchive,
  isCaseArchived,
  ARCHIVE_DIR,
  ARCHIVE_STATIC_PREFIX
};
