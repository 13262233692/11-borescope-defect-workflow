const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../db/pool');
const { NotFoundError, ValidationError, ConflictError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger');

async function listAnnotations(filters = {}) {
  const conditions = ['a.is_deleted = false'];
  const params = [];
  let idx = 1;

  if (filters.caseId) {
    conditions.push(`a.case_id = $${idx++}`);
    params.push(filters.caseId);
  }
  if (filters.imageId) {
    conditions.push(`a.image_id = $${idx++}`);
    params.push(filters.imageId);
  }
  if (filters.severity) {
    conditions.push(`a.severity = $${idx++}`);
    params.push(filters.severity);
  }
  if (filters.defectType) {
    conditions.push(`a.defect_type = $${idx++}`);
    params.push(filters.defectType);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
     FROM defect_annotation a
     LEFT JOIN app_user u ON a.created_by = u.id
     LEFT JOIN app_user u2 ON a.updated_by = u2.id
     WHERE ${where}
     ORDER BY a.created_at ASC`,
    params
  );

  return rows.map(formatAnnotation);
}

async function getAnnotation(id) {
  const { rows: [annotation] } = await query(
    `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
     FROM defect_annotation a
     LEFT JOIN app_user u ON a.created_by = u.id
     LEFT JOIN app_user u2 ON a.updated_by = u2.id
     WHERE a.id = $1 AND a.is_deleted = false`,
    [id]
  );
  if (!annotation) throw new NotFoundError('标注不存在');
  return formatAnnotation(annotation);
}

async function createAnnotation(data, user) {
  const { x1, y1, x2, y2 } = normalizeBox(data);

  const { rows: [image] } = await query(
    'SELECT case_id FROM inspection_image WHERE id = $1',
    [data.imageId]
  );
  if (!image) throw new NotFoundError('图片不存在');

  if (image.case_id !== data.caseId) {
    throw new ValidationError('图片与工单不匹配');
  }

  return transaction(async (client) => {
    const annotationId = uuidv4();
    const conflictToken = uuidv4();

    const { rows: [annotation] } = await client.query(
      `INSERT INTO defect_annotation
       (id, case_id, image_id, defect_type, severity, description,
        x1, y1, x2, y2, polygon,
        measurement, measurement_unit,
        created_by, conflict_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [annotationId, data.caseId, data.imageId,
       data.defectType, data.severity, data.description || '',
       x1, y1, x2, y2,
       data.polygon || null,
       data.measurement || null,
       data.measurementUnit || null,
       user.id, conflictToken]
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment,
        annotation_id, metadata, client_timestamp)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7)`,
      [data.caseId, 'EDIT_ANNOTATION', user.id,
       `创建${data.severity}级${data.defectType}标注`,
       annotationId,
       { box: { x1, y1, x2, y2 } },
       new Date()]
    );

    logger.info(`Annotation created: ${annotationId} (${data.defectType}/${data.severity}) by ${user.username}`);

    const { rows: [result] } = await client.query(
      `SELECT a.*, u.display_name AS creator_name
       FROM defect_annotation a
       LEFT JOIN app_user u ON a.created_by = u.id
       WHERE a.id = $1`,
      [annotationId]
    );

    return formatAnnotation(result);
  });
}

async function updateAnnotation(id, data, user, opts = {}) {
  const existing = await getAnnotationRaw(id);

  const providedToken = data.conflictToken ?? opts.conflictToken;
  const providedVersion = data.version ?? opts.expectedVersion;
  const providedUpdatedAt = data.updatedAt ?? opts.expectedUpdatedAt;

  const tokenMismatch = providedToken && providedToken !== existing.conflict_token;
  const versionMismatch = providedVersion && Number(providedVersion) !== existing.version;
  const updatedAtMismatch = providedUpdatedAt &&
    new Date(providedUpdatedAt).getTime() < new Date(existing.updated_at).getTime() - 50;

  if (tokenMismatch || versionMismatch || updatedAtMismatch) {
    const { rows: [detailed] } = await query(
      `SELECT a.*, u.display_name AS updater_name
       FROM defect_annotation a
       LEFT JOIN app_user u ON a.updated_by = u.id
       WHERE a.id = $1`,
      [id]
    );
    throw new ConflictError('标注已被其他人修改，请刷新后重试', {
      annotationId: id,
      expectedVersion: providedVersion,
      expectedToken: providedToken,
      currentVersion: existing.version,
      currentToken: existing.conflict_token,
      currentUpdatedAt: existing.updated_at,
      updatedByName: detailed?.updater_name,
      ours: formatAnnotation(existing)
    });
  }

  if (data.x1 !== undefined || data.x2 !== undefined ||
      data.y1 !== undefined || data.y2 !== undefined) {
    const box = normalizeBox({
      x1: data.x1 ?? existing.x1,
      y1: data.y1 ?? existing.y1,
      x2: data.x2 ?? existing.x2,
      y2: data.y2 ?? existing.y2
    });
    data.x1 = box.x1;
    data.y1 = box.y1;
    data.x2 = box.x2;
    data.y2 = box.y2;
  }

  const updates = [];
  const params = [];
  let idx = 1;

  const fields = ['defectType', 'severity', 'description', 'x1', 'y1', 'x2', 'y2', 'polygon', 'measurement', 'measurementUnit'];

  fields.forEach((field) => {
    if (data[field] !== undefined) {
      const dbField = field.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      updates.push(`${dbField} = $${idx++}`);
      params.push(field === 'polygon' && data[field]
        ? JSON.stringify(data[field])
        : data[field]);
    }
  });

  if (!updates.length) {
    return getAnnotation(id);
  }

  updates.push(`updated_by = $${idx++}`);
  params.push(user.id);
  params.push(id);
  const newToken = uuidv4();

  return transaction(async (client) => {
    const paramList = [...params, newToken];
    const setSql = [...updates, `conflict_token = $${paramList.length}`].join(', ');
    paramList.push(id);

    const { rows: [updated] } = await client.query(
      `UPDATE defect_annotation SET ${setSql} WHERE id = $${paramList.length - 1} RETURNING *`,
      paramList
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment, annotation_id, client_timestamp)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6)`,
      [updated.case_id, 'EDIT_ANNOTATION', user.id,
       `更新标注: ${updated.defect_type}/${updated.severity}`,
       id, new Date()]
    );

    logger.info(`Annotation updated: ${id} by ${user.username}`);

    const { rows: [result] } = await client.query(
      `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
       FROM defect_annotation a
       LEFT JOIN app_user u ON a.created_by = u.id
       LEFT JOIN app_user u2 ON a.updated_by = u2.id
       WHERE a.id = $1`,
      [id]
    );

    return formatAnnotation(result);
  });
}

async function deleteAnnotation(id, user) {
  const ann = await getAnnotationRaw(id);

  if (!['INSPECTOR', 'ADMIN'].includes(user.role)) {
    throw new ForbiddenError('无权删除标注');
  }
  if (user.role === 'INSPECTOR' && ann.created_by !== user.id) {
    throw new ForbiddenError('只能删除自己创建的标注');
  }

  return transaction(async (client) => {
    await client.query(
      'UPDATE defect_annotation SET is_deleted = true, updated_by = $1 WHERE id = $2',
      [user.id, id]
    );

    await client.query(
      `INSERT INTO workflow_record
       (case_id, action, from_status, to_status, actor_id, comment, annotation_id, client_timestamp)
       VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6)`,
      [ann.case_id, 'EDIT_ANNOTATION', user.id, '删除标注', id, new Date()]
    );

    logger.info(`Annotation deleted: ${id} by ${user.username}`);
    return { success: true, id };
  });
}

async function getAnnotationRaw(id) {
  const { rows: [annotation] } = await query(
    'SELECT * FROM defect_annotation WHERE id = $1 AND is_deleted = false',
    [id]
  );
  if (!annotation) throw new NotFoundError('标注不存在');
  return annotation;
}

function normalizeBox(data) {
  return {
    x1: Math.min(data.x1, data.x2),
    y1: Math.min(data.y1, data.y2),
    x2: Math.max(data.x1, data.x2),
    y2: Math.max(data.y1, data.y2)
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

module.exports = {
  listAnnotations,
  getAnnotation,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  syncAnnotations
};

async function syncAnnotations(caseId, user, payload = {}) {
  const { operations = [], autoMerge = true } = payload;
  const results = [];

  return transaction(async (client) => {
    for (const op of operations) {
      try {
        if (!op || !op.op) {
          results.push({ status: 'error', tempId: op?.tempId, id: op?.id,
            error: '缺少操作类型 op' });
          continue;
        }

        switch (op.op) {
          case 'create':
            results.push(await handleSyncCreate(client, caseId, op, user));
            break;
          case 'update':
            results.push(await handleSyncUpdate(client, caseId, op, user, autoMerge));
            break;
          case 'delete':
            results.push(await handleSyncDelete(client, caseId, op, user));
            break;
          default:
            results.push({ status: 'error', tempId: op.tempId, id: op.id,
              error: `未知操作类型: ${op.op}` });
        }
      } catch (err) {
        if (err instanceof ConflictError) {
          results.push({
            status: 'conflict',
            tempId: op.tempId,
            id: op.id,
            error: err.message,
            details: err.details,
            ours: err.details?.ours || null
          });
        } else if (err instanceof ForbiddenError || err instanceof ValidationError ||
                   err instanceof NotFoundError) {
          results.push({
            status: 'error',
            tempId: op.tempId,
            id: op.id,
            error: err.message,
            code: err.code
          });
        } else {
          logger.error('sync annotation unexpected error:', err);
          results.push({
            status: 'error',
            tempId: op.tempId,
            id: op.id,
            error: err.message || '服务器内部错误'
          });
        }
      }
    }

    const { rows: serverSide } = await client.query(
      `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
       FROM defect_annotation a
       LEFT JOIN app_user u ON a.created_by = u.id
       LEFT JOIN app_user u2 ON a.updated_by = u2.id
       WHERE a.case_id = $1 AND a.is_deleted = false`,
      [caseId]
    );

    return {
      results,
      serverAnnotations: serverSide.map(formatAnnotation)
    };
  });
}

async function handleSyncCreate(client, caseId, op, user) {
  if (op.caseId && op.caseId !== caseId) {
    throw new ValidationError('caseId 与工单不匹配');
  }
  const { x1, y1, x2, y2 } = normalizeBox(op);
  const annotationId = uuidv4();
  const conflictToken = uuidv4();

  await client.query(
    `INSERT INTO defect_annotation
     (id, case_id, image_id, defect_type, severity, description,
      x1, y1, x2, y2, polygon, measurement, measurement_unit,
      created_by, conflict_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [annotationId, caseId, op.imageId,
     op.defectType, op.severity, op.description || '',
     x1, y1, x2, y2,
     op.polygon ? JSON.stringify(op.polygon) : null,
     op.measurement ?? null,
     op.measurementUnit || null,
     user.id, conflictToken]
  );

  await client.query(
    `INSERT INTO workflow_record
     (case_id, action, from_status, to_status, actor_id, comment,
      annotation_id, metadata, client_timestamp)
     VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7)`,
    [caseId, 'EDIT_ANNOTATION', user.id,
     `协作创建${op.severity}级${op.defectType}标注`,
     annotationId, { box: { x1, y1, x2, y2 } },
     op.clientUpdatedAt ? new Date(op.clientUpdatedAt) : new Date()]
  );

  const { rows: [row] } = await client.query(
    `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
     FROM defect_annotation a
     LEFT JOIN app_user u ON a.created_by = u.id
     LEFT JOIN app_user u2 ON a.updated_by = u2.id
     WHERE a.id = $1`,
    [annotationId]
  );

  logger.info(`[sync] create annotation ${annotationId} by ${user.username}`);

  return {
    status: 'created',
    tempId: op.tempId,
    id: annotationId,
    data: formatAnnotation(row)
  };
}

async function handleSyncUpdate(client, caseId, op, user, autoMerge) {
  const { rows: [existing] } = await client.query(
    'SELECT * FROM defect_annotation WHERE id = $1 AND is_deleted = false FOR UPDATE',
    [op.id]
  );
  if (!existing) {
    throw new NotFoundError('标注不存在或已删除');
  }
  if (existing.case_id !== caseId) {
    throw new ValidationError('标注不属于当前工单');
  }

  const tokenMatch = !op.conflictToken || op.conflictToken === existing.conflict_token;
  const versionMatch = !op.version || Number(op.version) === existing.version;
  const updatedAtMatch = !op.updatedAt ||
    new Date(op.updatedAt).getTime() >= new Date(existing.updated_at).getTime() - 50;

  let mergeApplied = false;
  let mergedFields = [];
  let finalData = { ...op };

  if (!tokenMatch || !versionMatch || !updatedAtMatch) {
    if (autoMerge) {
      const merged = tryMergeFields(existing, op, user);
      if (merged.canMerge) {
        mergeApplied = true;
        mergedFields = merged.fields;
        finalData = { ...op, ...merged.mergedData };
        logger.info(`[sync] auto-merged annotation ${op.id}: ${merged.fields.join(', ')}`);
      } else {
        const { rows: [detailed] } = await client.query(
          `SELECT a.*, u.display_name AS updater_name
           FROM defect_annotation a
           LEFT JOIN app_user u ON a.updated_by = u.id WHERE a.id = $1`,
          [op.id]
        );
        throw new ConflictError('标注已被其他人修改，存在字段冲突', {
          annotationId: op.id,
          expectedVersion: op.version,
          expectedToken: op.conflictToken,
          currentVersion: existing.version,
          currentToken: existing.conflict_token,
          updatedByName: detailed?.updater_name,
          ourChanges: pickChangedFields(existing, op),
          theirs: formatAnnotation(detailed),
          ours: formatAnnotation(existing)
        });
      }
    } else {
      throw new ConflictError('标注已被其他人修改', {
        annotationId: op.id,
        currentVersion: existing.version,
        currentToken: existing.conflict_token
      });
    }
  }

  const updates = [];
  const params = [];
  let idx = 1;

  const fieldMap = {
    defectType: 'defect_type', severity: 'severity', description: 'description',
    x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2',
    polygon: 'polygon', measurement: 'measurement', measurementUnit: 'measurement_unit'
  };

  let hasBox = false;
  const boxAcc = { x1: existing.x1, y1: existing.y1, x2: existing.x2, y2: existing.y2 };

  Object.keys(fieldMap).forEach((field) => {
    if (finalData[field] !== undefined) {
      if (['x1', 'y1', 'x2', 'y2'].includes(field)) {
        boxAcc[field] = finalData[field];
        hasBox = true;
      } else {
        const dbField = fieldMap[field];
        updates.push(`${dbField} = $${idx++}`);
        params.push(field === 'polygon' && finalData[field]
          ? JSON.stringify(finalData[field])
          : finalData[field]);
      }
    }
  });

  if (hasBox) {
    const nb = normalizeBox(boxAcc);
    ['x1', 'y1', 'x2', 'y2'].forEach(f => {
      updates.push(`${f} = $${idx++}`);
      params.push(nb[f]);
    });
  }

  if (!updates.length) {
    const { rows: [unchanged] } = await client.query(
      `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
       FROM defect_annotation a LEFT JOIN app_user u ON a.created_by = u.id
       LEFT JOIN app_user u2 ON a.updated_by = u2.id WHERE a.id = $1`,
      [op.id]
    );
    return {
      status: 'skipped', tempId: op.tempId, id: op.id,
      data: formatAnnotation(unchanged), reason: '无实质变更'
    };
  }

  updates.push(`updated_by = $${idx++}`);
  params.push(user.id);
  const newToken = uuidv4();
  updates.push(`conflict_token = $${idx++}`);
  params.push(newToken);
  params.push(op.id);

  await client.query(`UPDATE defect_annotation SET ${updates.join(', ')} WHERE id = $${idx}`, params);

  await client.query(
    `INSERT INTO workflow_record
     (case_id, action, from_status, to_status, actor_id, comment, annotation_id,
      metadata, client_timestamp)
     VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7)`,
    [caseId, 'EDIT_ANNOTATION', user.id,
     mergeApplied ? `协作更新标注(自动合并:${mergedFields.join(',')})` : '协作更新标注',
     op.id, { mergeApplied, mergedFields, clientUpdatedAt: op.clientUpdatedAt },
     op.clientUpdatedAt ? new Date(op.clientUpdatedAt) : new Date()]
  );

  const { rows: [updated] } = await client.query(
    `SELECT a.*, u.display_name AS creator_name, u2.display_name AS updater_name
     FROM defect_annotation a LEFT JOIN app_user u ON a.created_by = u.id
     LEFT JOIN app_user u2 ON a.updated_by = u2.id WHERE a.id = $1`,
    [op.id]
  );

  logger.info(`[sync] update annotation ${op.id} by ${user.username}`);

  return {
    status: mergeApplied ? 'merged' : 'updated',
    tempId: op.tempId,
    id: op.id,
    mergeApplied,
    mergedFields,
    data: formatAnnotation(updated)
  };
}

async function handleSyncDelete(client, caseId, op, user) {
  const { rows: [existing] } = await client.query(
    'SELECT * FROM defect_annotation WHERE id = $1 AND is_deleted = false FOR UPDATE',
    [op.id]
  );
  if (!existing) {
    return { status: 'skipped', tempId: op.tempId, id: op.id, reason: '标注不存在或已删除' };
  }
  if (existing.case_id !== caseId) {
    throw new ValidationError('标注不属于当前工单');
  }

  if (user.role !== 'ADMIN' &&
      (user.role !== 'INSPECTOR' || existing.created_by !== user.id)) {
    throw new ForbiddenError('无权删除此标注');
  }

  if (op.conflictToken && op.conflictToken !== existing.conflict_token) {
    throw new ConflictError('标注已被修改，无法删除', {
      annotationId: op.id,
      currentVersion: existing.version,
      currentToken: existing.conflict_token
    });
  }

  await client.query(
    'UPDATE defect_annotation SET is_deleted = true, updated_by = $1 WHERE id = $2',
    [user.id, op.id]
  );

  await client.query(
    `INSERT INTO workflow_record
     (case_id, action, from_status, to_status, actor_id, comment, annotation_id, client_timestamp)
     VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6)`,
    [caseId, 'EDIT_ANNOTATION', user.id, '协作删除标注', op.id, new Date()]
  );

  logger.info(`[sync] delete annotation ${op.id} by ${user.username}`);

  return { status: 'deleted', tempId: op.tempId, id: op.id };
}

function tryMergeFields(existing, clientOp, user) {
  const clientFields = pickChangedFields(existing, clientOp);
  const conflictingFields = [];
  const mergedData = {};
  const mergedFields = [];

  for (const f of Object.keys(clientFields)) {
    const clientVal = clientFields[f];
    const serverVal = existing[f];
    if (isValueEqual(clientVal, serverVal)) {
      continue;
    }

    const independent = [
      'description', 'measurement', 'measurement_unit', 'polygon'
    ].includes(f);

    const updaterDiff = existing.updated_by && existing.updated_by !== user.id;

    if (independent || !updaterDiff) {
      if (clientVal !== null && clientVal !== undefined && clientVal !== '') {
        mergedData[f === 'measurement_unit' ? 'measurementUnit' : f] = clientVal;
      }
      mergedFields.push(f);
    } else {
      conflictingFields.push(f);
    }
  }

  if (conflictingFields.length > 0) {
    return { canMerge: false, conflictingFields };
  }

  return { canMerge: true, fields: mergedFields, mergedData };
}

function pickChangedFields(existing, op) {
  const fields = {
    defect_type: op.defectType, severity: op.severity, description: op.description,
    x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2,
    polygon: op.polygon ? JSON.stringify(op.polygon) : undefined,
    measurement: op.measurement, measurement_unit: op.measurementUnit
  };
  const changed = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const compareVal = k === 'polygon'
      ? (existing[k] ? JSON.stringify(existing[k]) : null)
      : existing[k];
    if (!isValueEqual(v, compareVal)) {
      changed[k] = v;
    }
  }
  return changed;
}

function isValueEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
