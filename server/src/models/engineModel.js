const { query, transaction } = require('../db/pool');
const { NotFoundError, ConflictError } = require('../utils/errors');
const logger = require('../utils/logger');

async function listEngines(filters = {}, pagination = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.search) {
    conditions.push(`(engine_serial ILIKE $${idx} OR model ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.manufacturer) {
    conditions.push(`manufacturer = $${idx++}`);
    params.push(filters.manufacturer);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = pagination.limit || 50;
  const offset = pagination.offset || 0;

  const { rows } = await query(
    `SELECT e.*,
            (SELECT COUNT(*) FROM inspection_case c WHERE c.engine_id = e.id) AS case_count
     FROM engine e ${where}
     ORDER BY e.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*) FROM engine e ${where}`,
    params
  );

  return { items: rows, total: parseInt(count, 10), limit, offset };
}

async function getEngineById(id) {
  const { rows: [engine] } = await query(
    `SELECT e.*,
            (SELECT COUNT(*) FROM inspection_case c WHERE c.engine_id = e.id) AS case_count
     FROM engine e WHERE e.id = $1`,
    [id]
  );

  if (!engine) {
    throw new NotFoundError('发动机不存在');
  }

  const { rows: cases } = await query(
    `SELECT id, case_number, inspection_date, status, section, created_at
     FROM inspection_case
     WHERE engine_id = $1
     ORDER BY inspection_date DESC
     LIMIT 20`,
    [id]
  );

  return { ...engine, recentCases: cases };
}

async function createEngine(data) {
  try {
    const { rows: [engine] } = await query(
      `INSERT INTO engine
       (engine_serial, model, manufacturer, operator, aircraft_registration,
        tsn, csn, tso, cso, status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [data.engineSerial, data.model, data.manufacturer,
       data.operator, data.aircraftRegistration,
       data.tsn || 0, data.csn || 0, data.tso || 0, data.cso || 0,
       data.status || 'ACTIVE', data.remarks]
    );
    logger.info(`Engine created: ${engine.engine_serial}`);
    return engine;
  } catch (err) {
    if (err.code === '23505') {
      throw new ConflictError('发动机序列号已存在');
    }
    throw err;
  }
}

async function updateEngine(id, data) {
  const updates = [];
  const params = [];
  let idx = 1;

  const fields = ['model', 'manufacturer', 'operator', 'aircraftRegistration',
    'tsn', 'csn', 'tso', 'cso', 'status', 'remarks'];

  fields.forEach((field) => {
    if (data[field] !== undefined) {
      const dbField = field.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      updates.push(`${dbField} = $${idx++}`);
      params.push(data[field]);
    }
  });

  if (!updates.length) return getEngineById(id);

  params.push(id);
  const { rows: [engine] } = await query(
    `UPDATE engine SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );

  if (!engine) throw new NotFoundError('发动机不存在');
  return engine;
}

module.exports = {
  listEngines,
  getEngineById,
  createEngine,
  updateEngine
};
