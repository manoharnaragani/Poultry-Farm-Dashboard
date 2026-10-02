import crypto from 'node:crypto';

export class ValidationError extends Error {}

// Column types: text | int | num | date (required) | datenull (optional, '' <-> NULL)
// Any field the app sends that is not listed here is kept in the "extra" JSON column, so nothing is lost.
export const RESOURCES = {
  sheds: { table: 'sheds', prefix: 'SH', idType: 'int', order: 'id ASC', cols: [['name', 'text'], ['hens', 'int'], ['notes', 'text']] },
  workers: {
    table: 'workers', prefix: 'WK',
    cols: [['name', 'text'], ['phone', 'text'], ['address', 'text'], ['joiningDate', 'datenull'], ['assignedShed', 'text'], ['role', 'text'], ['salaryType', 'text', 'Monthly'], ['salary', 'num'], ['status', 'text'], ['emergencyContact', 'text'], ['notes', 'text']],
  },
  attendance: {
    table: 'attendance', prefix: 'AT',
    cols: [['workerId', 'text'], ['worker', 'text'], ['date', 'date'], ['status', 'text', 'Present'], ['checkIn', 'text'], ['checkOut', 'text'], ['workingHours', 'num'], ['overtime', 'num'], ['notes', 'text']],
  },
  payments: {
    table: 'payments', prefix: 'PY',
    cols: [['workerId', 'textnull'], ['worker', 'text'], ['date', 'date'], ['amount', 'num'], ['type', 'text'], ['method', 'text', 'Cash'], ['paymentStatus', 'text', 'Paid'], ['reason', 'text'], ['recordedBy', 'text']],
  },
  assignments: { table: 'assignments', prefix: 'AS', cols: [['worker', 'text'], ['shed', 'text'], ['startDate', 'date'], ['endDate', 'datenull'], ['reason', 'text']] },
  dailyWages: {
    table: 'daily_wages', prefix: 'DW',
    cols: [['workerId', 'textnull'], ['worker', 'text'], ['date', 'date'], ['shed', 'text'], ['work', 'text'], ['wage', 'num'], ['paymentStatus', 'text', 'Pending']],
  },
  feedStock: { table: 'feed_stock', prefix: 'FD', cols: [['name', 'text'], ['type', 'text'], ['quantity', 'num'], ['minStock', 'num'], ['updated', 'datenull']] },
  feedUsage: { table: 'feed_usage', prefix: 'FU', cols: [['date', 'date'], ['shed', 'text'], ['feedType', 'text'], ['quantity', 'num'], ['enteredBy', 'text'], ['notes', 'text']] },
  feedPurchases: { table: 'feed_purchases', prefix: 'FP', cols: [['date', 'date'], ['feedType', 'text'], ['quantity', 'num'], ['rate', 'num'], ['totalAmount', 'num'], ['supplier', 'text'], ['notes', 'text']] },
  eggs: { table: 'eggs', prefix: 'EG', cols: [['date', 'date'], ['shed', 'text'], ['totalEggs', 'int'], ['goodEggs', 'int'], ['brokenEggs', 'int'], ['notes', 'text']] },
  mortality: { table: 'mortality', prefix: 'MO', cols: [['date', 'date'], ['shed', 'text'], ['count', 'int'], ['reason', 'text'], ['notes', 'text']] },
  sales: { table: 'sales', prefix: 'SL', cols: [['date', 'date'], ['trays', 'num'], ['pricePerTray', 'num'], ['totalAmount', 'num'], ['buyer', 'text'], ['paymentStatus', 'text', 'Paid'], ['notes', 'text']] },
  expenses: {
    table: 'expenses', prefix: 'EX',
    cols: [['date', 'date'], ['category', 'text', 'Other'], ['amount', 'num'], ['shed', 'text'], ['vendor', 'text'], ['paymentMethod', 'text', 'Cash'], ['description', 'text'], ['addedBy', 'text']],
  },
};

const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const makeId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

function toDbValue(key, type, value) {
  switch (type) {
    case 'text': return value == null ? '' : String(value);
    case 'textnull': return value == null || value === '' ? null : String(value);
    case 'int': { const n = Math.round(Number(value)); return Number.isFinite(n) ? n : 0; }
    case 'num': { const n = Number(value); return Number.isFinite(n) ? n : 0; }
    case 'date':
    case 'datenull': {
      if (value == null || value === '') {
        if (type === 'datenull') return null;
        throw new ValidationError('Please enter a valid date.');
      }
      const text = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) throw new ValidationError(`Invalid date: ${value}`);
      return text;
    }
    default: return value;
  }
}

function fromRow(def, row) {
  const record = { ...(row.extra || {}), id: row.id };
  for (const [key, type] of def.cols) {
    const value = row[snake(key)];
    record[key] = (type === 'date' || type === 'datenull' || type === 'textnull') ? (value ?? '') : value;
  }
  return record;
}

function splitRecord(def, record) {
  const known = new Set(['id', ...def.cols.map(([key]) => key)]);
  const values = def.cols.map(([key, type, fallback]) => toDbValue(key, type, record[key] === undefined && fallback !== undefined ? fallback : record[key]));
  const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));
  return { values, extra };
}

export async function listRows(db, name) {
  const def = RESOURCES[name];
  const { rows } = await db.query(`SELECT * FROM ${def.table} ORDER BY ${def.order || 'seq DESC'}`);
  return rows.map((row) => fromRow(def, row));
}

export async function getRow(db, name, id, { lock = false } = {}) {
  const def = RESOURCES[name];
  if (def.idType === 'int' && !/^\d+$/.test(String(id))) return null;
  const { rows } = await db.query(`SELECT * FROM ${def.table} WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ? fromRow(def, rows[0]) : null;
}

// upsert=true is used by the import script so it can be re-run safely.
export async function insertRow(db, name, record, { upsert = false } = {}) {
  const def = RESOURCES[name];
  const { values, extra } = splitRecord(def, record);
  const columns = ['id', ...def.cols.map(([key]) => snake(key)), 'extra'];
  const params = [def.idType === 'int' ? Number(record.id) : String(record.id), ...values, JSON.stringify(extra)];
  const placeholders = params.map((_, i) => `$${i + 1}`);
  const updates = columns.slice(1).map((c) => `${c} = EXCLUDED.${c}`).concat('updated_at = now()').join(', ');
  const sql = `INSERT INTO ${def.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})` +
    (upsert ? ` ON CONFLICT (id) DO UPDATE SET ${updates}` : '') + ' RETURNING *';
  const { rows } = await db.query(sql, params);
  return fromRow(def, rows[0]);
}

export async function updateRow(db, name, id, record) {
  const def = RESOURCES[name];
  const { values, extra } = splitRecord(def, record);
  const sets = def.cols.map(([key], i) => `${snake(key)} = $${i + 2}`).concat(`extra = $${values.length + 2}`, 'updated_at = now()');
  const { rows } = await db.query(`UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...values, JSON.stringify(extra)]);
  return rows[0] ? fromRow(def, rows[0]) : null;
}

export async function deleteRow(db, name, id) {
  const def = RESOURCES[name];
  await db.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
}

export async function adjustFeedStock(db, feedType, delta) {
  await db.query('UPDATE feed_stock SET quantity = GREATEST(0, quantity + $2), updated = CURRENT_DATE, updated_at = now() WHERE name = $1', [feedType, Number(delta) || 0]);
}

export async function getSettings(db) {
  const { rows } = await db.query('SELECT farm_name, owner, phone, address, currency, timezone, feed_capacity FROM farm_settings WHERE id = 1');
  const row = rows[0] || {};
  return {
    farmName: row.farm_name || '',
    owner: row.owner || '',
    phone: row.phone || '',
    address: row.address || '',
    currency: row.currency || 'INR',
    timezone: row.timezone || 'Asia/Kolkata',
    feedCapacity: row.feed_capacity != null && Number(row.feed_capacity) > 0 ? Number(row.feed_capacity) : 6000,
  };
}

export async function saveSettings(db, input) {
  const current = await getSettings(db);
  const next = {
    farmName: input?.farmName !== undefined ? String(input.farmName).trim() : current.farmName,
    owner: input?.owner !== undefined ? String(input.owner).trim() : current.owner,
    phone: input?.phone !== undefined ? String(input.phone).trim() : current.phone,
    address: input?.address !== undefined ? String(input.address).trim() : current.address,
    currency: input?.currency !== undefined ? String(input.currency).trim() : current.currency,
    timezone: input?.timezone !== undefined ? String(input.timezone).trim() : current.timezone,
    feedCapacity: input?.feedCapacity !== undefined && Number(input.feedCapacity) > 0 ? Number(input.feedCapacity) : current.feedCapacity,
  };
  await db.query(
    `INSERT INTO farm_settings (id, farm_name, owner, phone, address, currency, timezone, feed_capacity) VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET farm_name = $1, owner = $2, phone = $3, address = $4, currency = $5, timezone = $6, feed_capacity = $7`,
    [next.farmName, next.owner, next.phone, next.address, next.currency, next.timezone, next.feedCapacity],
  );
  return next;
}
