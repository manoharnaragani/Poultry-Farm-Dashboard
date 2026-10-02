import { getAuthenticatedUser } from './localAuth.js';
import { query, withTx } from './db/pool.js';
import {
  RESOURCES, ValidationError, archiveWorker, makeId, listRows, getRow, insertRow, updateRow, deleteRow, adjustFeedStock, getSettings, saveSettings,
} from './db/repo.js';

const resources = {
  '/workers': 'workers',
  '/attendance': 'attendance',
  '/worker-payments': 'payments',
  '/worker-assignments': 'assignments',
  '/daily-wages': 'dailyWages',
  '/feed/stock': 'feedStock',
  '/feed/usage': 'feedUsage',
  '/feed/purchases': 'feedPurchases',
  '/eggs': 'eggs',
  '/mortality': 'mortality',
  '/sales': 'sales',
  '/expenses': 'expenses',
  '/sheds': 'sheds',
};

const json = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, message, status = 400) => res.status(status).json({ success: false, message });
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const nowDate = () => new Date().toISOString().slice(0, 10);
const number = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

function normalizeRecord(path, body, existing = null) {
  const value = { ...(existing || {}), ...body };
  if (path === '/sales') value.totalAmount = number(value.trays) * number(value.pricePerTray);
  if (path === '/feed/purchases') value.totalAmount = number(value.quantity) * number(value.rate);
  if (path === '/eggs') {
    value.totalEggs = number(value.totalEggs); value.goodEggs = number(value.goodEggs); value.brokenEggs = number(value.brokenEggs);
    if (value.goodEggs + value.brokenEggs > value.totalEggs) throw new ValidationError('Good eggs plus broken eggs cannot exceed total eggs.');
  }
  if (path === '/attendance' && value.checkIn && value.checkOut) {
    const [ih, im] = String(value.checkIn).split(':').map(Number);
    const [oh, om] = String(value.checkOut).split(':').map(Number);
    let hours = (oh * 60 + om - (ih * 60 + im)) / 60;
    if (hours < 0) hours += 24;
    value.workingHours = Math.round(hours * 100) / 100;
  }
  return value;
}

async function findWorker(db, value) {
  const { rows } = await db.query("SELECT id, name FROM workers WHERE (id = $1 OR name = $1) AND extra->>'deleted' IS DISTINCT FROM 'true' ORDER BY (id = $1) DESC LIMIT 1", [String(value ?? '')]);
  return rows[0] || null;
}

function describeDbError(error) {
  if (error instanceof ValidationError) return { status: 400, message: error.message };
  if (error.code === '23505') {
    if (String(error.constraint).includes('attendance_worker_date')) return { status: 409, message: 'Attendance already exists for this worker on this date.' };
    if (String(error.constraint).includes('feed_stock')) return { status: 409, message: 'A feed type with that name already exists.' };
    return { status: 409, message: 'A record with that ID already exists.' };
  }
  if (error.code === '23514') return { status: 400, message: 'Some values are not valid (counts and amounts cannot be negative, good + broken eggs cannot exceed total).' };
  if (error.code === '23503') return { status: 400, message: 'The selected worker no longer exists.' };
  if (error.code === '22P02' || error.code === '22003' || error.code === '22007') return { status: 400, message: 'One of the values is not in a valid format.' };
  return null;
}

export function registerLocalFarmApi(app) {
  app.get('/api/health', ah(async (_req, res) => {
    try { await query('SELECT 1'); } catch { return fail(res, 'Database is not reachable.', 503); }
    return json(res, { api: true, database: true, databaseType: 'postgresql' });
  }));

  app.use('/api', ah(async (req, res, next) => {
    if (req.path === '/health' || req.path === '/session' || req.path.startsWith('/auth/')) return next();
    const user = await getAuthenticatedUser(req);
    if (!user) return fail(res, 'Sign in to access shared farm records.', 401);
    req.farmUser = user;
    return next();
  }));

  app.get('/api/settings', ah(async (_req, res) => json(res, await getSettings({ query }))));
  app.put('/api/settings', ah(async (req, res) => {
    try { return json(res, await withTx((db) => saveSettings(db, req.body))); } catch (error) { return handleError(res, error); }
  }));

  for (const [path, name] of Object.entries(resources)) {
    const def = RESOURCES[name];

    app.get(`/api${path}`, ah(async (_req, res) => json(res, await listRows({ query }, name))));

    app.post(`/api${path}`, ah(async (req, res) => {
      try {
        const created = await withTx(async (db) => {
          const body = req.body || {};
          const record = normalizeRecord(path, body);
          record.id = String(body.id || makeId(def.prefix));
          if (path === '/sheds') {
            await db.query('LOCK TABLE sheds IN EXCLUSIVE MODE');
            record.name = String(record.name || '').trim();
            if (!record.name || record.name.toLowerCase() === 'common') throw new ValidationError('Enter a shed name other than Common.');
            const duplicate = await db.query('SELECT 1 FROM sheds WHERE lower(name) = lower($1)', [record.name]);
            if (duplicate.rowCount) throw new ValidationError('A shed with this name already exists.');
            const next = await db.query('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM sheds');
            record.id = next.rows[0].id;
          }
          if (path === '/workers') {
            if (!record.assignedShed) throw new ValidationError('Please select a shed.');
            record.status = record.status || 'Active';
          }
          if (path === '/attendance' || path === '/worker-payments' || path === '/daily-wages') {
            const worker = await findWorker(db, record.workerId || record.worker);
            if (!worker) throw new ValidationError('Please select a valid worker.');
            record.workerId = worker.id;
            record.worker = worker.name;
          }
          if (path === '/feed/usage') await adjustFeedStock(db, record.feedType, -number(record.quantity));
          if (path === '/feed/purchases') await adjustFeedStock(db, record.feedType, number(record.quantity));
          const saved = await insertRow(db, name, record);
          if (path === '/workers') {
            await insertRow(db, 'assignments', { id: makeId('AS'), worker: saved.name, shed: saved.assignedShed, startDate: saved.joiningDate || nowDate(), endDate: '', reason: 'Initial assignment' });
          }
          return saved;
        });
        return json(res, created, 201);
      } catch (error) { return handleError(res, error, 'Could not create record.'); }
    }));

    app.put(`/api${path}/:id`, ah(async (req, res) => {
      try {
        const updated = await withTx(async (db) => {
          if (path === '/sheds') await db.query('LOCK TABLE sheds IN EXCLUSIVE MODE');
          const previous = await getRow(db, name, req.params.id, { lock: true });
          if (!previous) return null;
          const record = normalizeRecord(path, req.body || {}, previous);
          record.id = previous.id;
          if (path === '/sheds') {
            record.name = String(record.name || '').trim();
            if (!record.name || record.name.toLowerCase() === 'common') throw new ValidationError('Enter a shed name other than Common.');
            const duplicate = await db.query('SELECT 1 FROM sheds WHERE lower(name) = lower($1) AND id <> $2', [record.name, previous.id]);
            if (duplicate.rowCount) throw new ValidationError('A shed with this name already exists.');
            if (record.name !== previous.name) {
              for (const table of ['assignments', 'daily_wages', 'feed_usage', 'eggs', 'mortality', 'expenses']) {
                await db.query(`UPDATE ${table} SET shed = $1, updated_at = now() WHERE shed = $2`, [record.name, previous.name]);
              }
              await db.query('UPDATE workers SET assigned_shed = $1, updated_at = now() WHERE assigned_shed = $2', [record.name, previous.name]);
            }
          }
          if (path === '/attendance' || path === '/worker-payments' || path === '/daily-wages') {
            const worker = await findWorker(db, record.workerId || record.worker);
            if (!worker) throw new ValidationError('Please select a valid worker.');
            record.workerId = worker.id;
            record.worker = worker.name;
          }
          if (path === '/feed/usage' && (record.feedType !== previous.feedType || number(record.quantity) !== number(previous.quantity))) {
            await adjustFeedStock(db, previous.feedType, number(previous.quantity));
            await adjustFeedStock(db, record.feedType, -number(record.quantity));
          }
          if (path === '/feed/purchases' && (record.feedType !== previous.feedType || number(record.quantity) !== number(previous.quantity))) {
            await adjustFeedStock(db, previous.feedType, -number(previous.quantity));
            await adjustFeedStock(db, record.feedType, number(record.quantity));
          }
          return updateRow(db, name, previous.id, record);
        });
        if (!updated) return fail(res, 'Record not found.', 404);
        return json(res, updated);
      } catch (error) { return handleError(res, error, 'Could not update record.'); }
    }));

    app.delete(`/api${path}/:id`, ah(async (req, res) => {
      try {
        const result = await withTx(async (db) => {
          if (path === '/sheds') {
            // Serialize deletion with writes to name-linked farm records.
            await db.query('LOCK TABLE sheds, workers, assignments, daily_wages, feed_usage, eggs, mortality, expenses IN SHARE ROW EXCLUSIVE MODE');
          }
          const row = await getRow(db, name, req.params.id, { lock: true });
          if (!row) return null;
          if (path === '/sheds') {
            const linked = await db.query(`SELECT EXISTS (
              SELECT 1 FROM workers WHERE assigned_shed = $1
              UNION ALL SELECT 1 FROM assignments WHERE shed = $1
              UNION ALL SELECT 1 FROM daily_wages WHERE shed = $1
              UNION ALL SELECT 1 FROM feed_usage WHERE shed = $1
              UNION ALL SELECT 1 FROM eggs WHERE shed = $1
              UNION ALL SELECT 1 FROM mortality WHERE shed = $1
              UNION ALL SELECT 1 FROM expenses WHERE shed = $1
            ) AS linked`, [row.name]);
            if (linked.rows[0].linked) throw new ValidationError('This shed has linked workers or farm records. Reassign workers and remove or move linked records before deleting it.');
          }
          if (path === '/feed/usage') await adjustFeedStock(db, row.feedType, number(row.quantity));
          if (path === '/feed/purchases') await adjustFeedStock(db, row.feedType, -number(row.quantity));
          if (path === '/workers') return archiveWorker(db, row);
          await deleteRow(db, name, row.id);
          return { id: row.id };
        });
        if (!result) return fail(res, 'Record not found.', 404);
        return json(res, result);
      } catch (error) { return handleError(res, error, 'Could not delete record.'); }
    }));
  }

  // Last-resort JSON error handler for anything unexpected.
  app.use('/api', (error, _req, res, _next) => { // eslint-disable-line no-unused-vars
    console.error('API error:', error);
    fail(res, 'Something went wrong on the server. Please try again.', 500);
  });
}

function handleError(res, error, fallback = 'Request failed.') {
  const known = describeDbError(error);
  if (known) return fail(res, known.message, known.status);
  console.error(fallback, error);
  return fail(res, 'Database error. Please try again.', 500);
}
