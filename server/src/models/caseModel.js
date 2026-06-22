const { query, transaction } = require('../db/pool');
const config = require('../config');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

const STATUS_TRANSITIONS = {
  PENDING: { allowed: ['REVIEWING', 'CLOSED'], label: '待判读' },
  REVIEWING: { allowed: ['REPAIR', 'CLEAR', 'PENDING', 'CLOSED'], label: '待复核' },
  REPAIR: { allowed: ['CLOSED', 'REVIEWING'], label: '需维修' },
  CLEAR: { allowed: ['CLOSED'], label: '可放行' },
  CLOSED: { allowed: [], label: '已关闭' }
};

async function listCases(filters = {}, user, pagination = {}) {
  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`c.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.engineId) {
    conditions.push(`c.engine_id = $${idx++}`);
    params.push(filters.engineId);
  }
  if (filters.search) {
    conditions.push(`(c.case_number ILIKE $${idx} OR c.section ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.inspectionDateFrom) {
    conditions.push(`c.inspection_date >= $${idx++}`);
    params.push(filters.inspectionDateFrom);
  }
  if (filters.inspectionDateTo) {
    conditions.push(`c.inspection_date <= $${idx++}`);
    params.push(filters.inspectionDateTo);
  }

  if (user.role === 'INSPECTOR') {
    conditions.push(`c.inspector_id = $${idx++}`);
    params.push(user.id);
  }

  const where = conditions.join(' AND ');
  const limit = pagination.limit || 30;
  const offset = pagination.offset || 0;

  const { rows } = await query(
    `SELECT c.*,
            e.engine_serial, e.model AS engine_model, e.aircraft_registration,
            u_insp.display_name AS inspector_name,
            u_rev.display_name AS reviewer_name,
            (SELECT COUNT(*) FROM defect_annotation a WHERE a.case_id = c.id AND a.is_deleted = false) AS defect_count,
            (SELECT COUNT(*) FROM inspection_image i WHERE i.case_id = c.id) AS image_count
     FROM inspection_case c
     LEFT JOIN engine e ON c.engine_id = e.id
     LEFT JOIN app_user u_insp ON c.inspector_id = u_insp.id
     LEFT JOIN app_user u_rev ON c.reviewer_id = u_rev.id
     WHERE ${where}
     ORDER BY c.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM inspection_case c WHERE ${where}`,
    params
  );

  return { items: rows.map(formatCase), total: parseInt(count, 10), limit, offset };
}

async function getCaseById(id, user) {
  const { rows: [caseRow] } = await query(
    `SELECT c.*,
            e.engine_serial, e.model AS engine_model, e.manufacturer,
            e.aircraft_registration, e.tsn, e.csn, e.tso, e.cso,
            u_insp.display_name AS inspector_name,
            u_rev.display_name AS reviewer_name,
            u_rel.display_name AS releaser_name
     FROM inspection_case c
     LEFT JOIN engine e ON c.engine_id = e.id
     LEFT JOIN app_user u_insp ON c.inspector_id = u_insp.id
     LEFT JOIN app_user u_rev ON c.reviewer_id = u_rev.id
     LEFT JOIN app_user u_rel ON c.releaser_id = u_rel.id
     WHERE c.id = $1`,
    [id]
  );

  if (!caseRow) {
    throw new NotFoundError('工单不存在');
  }

  if (user.role === 'INSPECTOR' && caseRow.inspector_id !== user.id) {
    throw new ForbiddenError('无权访问此工单');
  }

  const { rows: images } = await query(
    `SELECT * FROM inspection_image WHERE case_id = $1 ORDER BY sort_order, created_at`,
    [id]
  );

  const { rows: annotations } = await query(
    `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
     FROM defect_annotation a
     LEFT JOIN app_user u ON a.created_by = u.id
     LEFT JOIN app_user u2 ON a.updated_by = u2.id
     WHERE a.case_id = $1 AND a.is_deleted = false
     ORDER BY a.created_at`,
    [id]
  );

  const { rows: workflow } = await query(
    `SELECT w.*, u.display_name AS actor_name, u.role AS actor_role
     FROM workflow_record w
     LEFT JOIN app_user u ON w.actor_id = u.id
     WHERE w.case_id = $1
     ORDER BY w.created_at ASC`,
    [id]
  );

  return {
    ...formatCase(caseRow),
    images: images.map(formatImage),
    annotations: annotations.map(formatAnnotation),
    workflow: workflow.map(formatWorkflow)
  };
}

async function createCase(data, user) {
  return transaction(async (client) => {
    const caseNumber = data.caseNumber || generateCaseNumber();
    const inspectorId = data.inspectorId || user.id;

    const { rows: [caseRow] } = await client.query(
      `INSERT INTO inspection_case
       (case_number, engine_id, inspection_date, inspection_type, borescope_model,
        section, stage, location, status, inspector_id, created_by, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [caseNumber, data.engineId, data.inspectionDate, data.inspectionType,
       data.borescopeModel, data.section, data.stage || null, data.location || null,
       'PENDING', inspectorId, user.id, data.summary || '']
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment, client_timestamp)
       VALUES ($1, $2, NULL, $3, $4, $5, $6)`,
      [caseRow.id, 'CREATE', 'PENDING', user.id, `创建工单 ${caseNumber}`, new Date()]
    );

    logger.info(`Case created: ${caseNumber} by ${user.username}`);
    return formatCase(caseRow);
  });
}

async function submitForReview(caseId, user, summary, conclusion) {
  return performTransition(caseId, user, {
    action: 'SUBMIT',
    fromStatus: 'PENDING',
    toStatus: 'REVIEWING',
    allowedRoles: ['INSPECTOR', 'ADMIN'],
    updates: { summary, conclusion },
    comment: conclusion ? `提交判读: ${conclusion}` : '提交判读'
  });
}

async function reviewCase(caseId, user, decision, comment) {
  if (!['REPAIR', 'CLEAR'].includes(decision)) {
    throw new ValidationError('复核判定必须是 REPAIR 或 CLEAR');
  }

  return performTransition(caseId, user, {
    action: decision === 'REPAIR' ? 'REVIEW_PASS' : 'REVIEW_PASS',
    fromStatus: 'REVIEWING',
    toStatus: decision,
    allowedRoles: ['REVIEWER', 'ADMIN'],
    updates: { conclusion: comment, reviewerId: user.id },
    comment: `复核判定: ${decision}${comment ? ' - ' + comment : ''}`
  });
}

async function rejectReview(caseId, user, comment) {
  return performTransition(caseId, user, {
    action: 'REVIEW_REJECT',
    fromStatus: 'REVIEWING',
    toStatus: 'PENDING',
    allowedRoles: ['REVIEWER', 'ADMIN'],
    comment: `退回判读: ${comment || '需要重新判读'}`
  });
}

async function releaseCase(caseId, user, certificateNo, comment) {
  return performTransition(caseId, user, {
    action: 'RELEASE',
    fromStatus: 'CLEAR',
    toStatus: 'CLOSED',
    allowedRoles: ['RELEASER', 'ADMIN'],
    updates: {
      releaserId: user.id,
      releaseCertificateNo: certificateNo,
      releasedAt: new Date(),
      closedAt: new Date()
    },
    comment: `签发放行${certificateNo ? ' (证书: ' + certificateNo + ')' : ''}: ${comment || '适航放行'}`
  });
}

async function closeCase(caseId, user, comment) {
  return transaction(async (client) => {
    const { rows: [caseRow] } = await client.query(
      'SELECT * FROM inspection_case WHERE id = $1 FOR UPDATE',
      [caseId]
    );

    if (!caseRow) throw new NotFoundError('工单不存在');

    const fromStatus = caseRow.status;
    if (fromStatus === 'CLOSED') {
      throw new ConflictError('工单已关闭');
    }

    const allowed = user.role === 'ADMIN'
      ? true
      : (fromStatus === 'REPAIR' && ['RELEASER', 'ADMIN'].includes(user.role));

    if (!allowed) {
      throw new ForbiddenError(`当前角色 ${user.role} 无权关闭状态为 ${fromStatus} 的工单`);
    }

    const { rows: [updated] } = await client.query(
      `UPDATE inspection_case
       SET status = 'CLOSED', closed_at = NOW(),
           releaser_id = $1, conclusion = COALESCE(conclusion, $2)
       WHERE id = $3 RETURNING *`,
      [user.id, comment, caseId]
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment, client_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [caseId, 'CLOSE', fromStatus, 'CLOSED', user.id, comment || '关闭工单', new Date()]
    );

    logger.info(`Case closed: ${updated.case_number} (${fromStatus} -> CLOSED) by ${user.username}`);
    return formatCase(updated);
  });
}

async function reopenForReview(caseId, user, comment) {
  return performTransition(caseId, user, {
    action: 'SUBMIT',
    fromStatus: 'REPAIR',
    toStatus: 'REVIEWING',
    allowedRoles: ['INSPECTOR', 'ADMIN'],
    comment: `修复后重新提交复核: ${comment || ''}`
  });
}

async function addComment(caseId, user, comment) {
  const { rows: [row] } = await query(
    `INSERT INTO workflow_record
     (case_id, action, from_status, to_status, actor_id, comment, client_timestamp)
     VALUES ($1, $2, NULL, NULL, $3, $4, $5)
     RETURNING *`,
    [caseId, 'COMMENT', user.id, comment, new Date()]
  );
  return formatWorkflow(row);
}

async function performTransition(caseId, user, opts) {
  return transaction(async (client) => {
    const { rows: [caseRow] } = await client.query(
      'SELECT * FROM inspection_case WHERE id = $1 FOR UPDATE',
      [caseId]
    );

    if (!caseRow) throw new NotFoundError('工单不存在');

    if (caseRow.status !== opts.fromStatus) {
      throw new ConflictError(
        `状态不匹配: 当前=${caseRow.status}, 期望=${opts.fromStatus}`
      );
    }

    const transitions = STATUS_TRANSITIONS[opts.fromStatus];
    if (!transitions.allowed.includes(opts.toStatus)) {
      throw new ValidationError(
        `非法状态流转: ${opts.fromStatus} -> ${opts.toStatus}`
      );
    }

    if (!opts.allowedRoles.includes(user.role)) {
      throw new ForbiddenError(
        `角色 ${user.role} 无权执行 ${opts.fromStatus} -> ${opts.toStatus}`
      );
    }

    const updates = opts.updates || {};
    const setClauses = [`status = '${opts.toStatus}'`];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        const dbKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
        setClauses.push(`${dbKey} = $${idx++}`);
        params.push(value);
      }
    }

    params.push(caseId);
    const { rows: [updated] } = await client.query(
      `UPDATE inspection_case SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment, client_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [caseId, opts.action, opts.fromStatus, opts.toStatus, user.id, opts.comment, new Date()]
    );

    logger.info(
      `Case transition: ${updated.case_number} ${opts.fromStatus} -> ${opts.toStatus} by ${user.username}`
    );
    return formatCase(updated);
  });
}

function generateCaseNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const seq = Math.floor(Math.random() * 9000 + 1000);
  return `BS-${year}-${seq}`;
}

function formatCase(row) {
  return {
    id: row.id,
    caseNumber: row.case_number,
    engineId: row.engine_id,
    engineSerial: row.engine_serial,
    engineModel: row.engine_model,
    engineManufacturer: row.manufacturer,
    aircraftRegistration: row.aircraft_registration,
    tsn: row.tsn,
    csn: row.csn,
    inspectionDate: row.inspection_date,
    inspectionType: row.inspection_type,
    borescopeModel: row.borescope_model,
    section: row.section,
    stage: row.stage,
    location: row.location,
    status: row.status,
    statusLabel: STATUS_TRANSITIONS[row.status]?.label || row.status,
    inspectorId: row.inspector_id,
    inspectorName: row.inspector_name,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    releaserId: row.releaser_id,
    releaserName: row.releaser_name,
    summary: row.summary,
    conclusion: row.conclusion,
    releaseCertificateNo: row.release_certificate_no,
    releasedAt: row.released_at,
    closedAt: row.closed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    defectCount: row.defect_count,
    imageCount: row.image_count,
    allowedTransitions: STATUS_TRANSITIONS[row.status]?.allowed || []
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

function formatAnnotation(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    imageId: row.image_id,
    defectType: row.defect_type,
    severity: row.severity,
    description: row.description,
    x1: row.x1,
    y1: row.y1,
    x2: row.x2,
    y2: row.y2,
    polygon: row.polygon,
    measurement: row.measurement,
    measurementUnit: row.measurement_unit,
    createdBy: row.created_by,
    creatorName: row.creator_name,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updaterName: row.updater_name,
    updatedAt: row.updated_at,
    version: row.version,
    conflictToken: row.conflict_token
  };
}

function formatWorkflow(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    comment: row.comment,
    annotationId: row.annotation_id,
    metadata: row.metadata,
    clientTimestamp: row.client_timestamp,
    createdAt: row.created_at
  };
}

module.exports = {
  listCases,
  getCaseById,
  createCase,
  submitForReview,
  reviewCase,
  rejectReview,
  releaseCase,
  closeCase,
  reopenForReview,
  addComment,
  formatCase,
  STATUS_TRANSITIONS
};
