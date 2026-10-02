// One-time import of an old NestLedger data file (data/nestledger.json) into PostgreSQL.
// Usage:  node scripts/import-json.js path/to/nestledger.json
// Safe to run again: records are matched by ID and updated instead of duplicated.
// Sheds, feed stock and farm settings are REPLACED by the file's values.
import 'dotenv/config';
import fs from 'node:fs';
import { initSchema } from '../server/db/schema.js';
import { withTx, closePool } from '../server/db/pool.js';
import { insertRow, saveSettings, makeId } from '../server/db/repo.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('Usage: node scripts/import-json.js path/to/nestledger.json');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
await initSchema();

// Order matters: workers must exist before attendance/payments that point to them.
const order = ['workers', 'assignments', 'attendance', 'payments', 'dailyWages', 'feedUsage', 'feedPurchases', 'eggs', 'mortality', 'sales', 'expenses'];
const report = {};
const skipped = [];

await withTx(async (db) => {
  if (Array.isArray(data.sheds) && data.sheds.length) {
    await db.query('DELETE FROM sheds');
    for (const shed of data.sheds) await insertRow(db, 'sheds', { ...shed, id: Number(shed.id) });
    report.sheds = data.sheds.length;
  }
  if (Array.isArray(data.feedStock) && data.feedStock.length) {
    await db.query('DELETE FROM feed_stock');
    for (const item of data.feedStock) await insertRow(db, 'feedStock', { ...item, id: String(item.id || makeId('FD')) });
    report.feedStock = data.feedStock.length;
  }
  const workerRows = Array.isArray(data.workers) ? data.workers : [];
  for (const name of order) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    let ok = 0;
    for (const raw of [...rows].reverse()) { // keep newest-first order after import
      const row = { ...raw, id: String(raw.id || makeId('IM')) };
      if (['attendance', 'payments', 'dailyWages'].includes(name)) {
        const worker = workerRows.find((w) => String(w.id) === String(row.workerId)) || workerRows.find((w) => w.name === row.worker);
        if (worker) { row.workerId = worker.id; row.worker = worker.name; } else if (name === 'attendance') { skipped.push(`${name} ${row.id}: worker not found`); continue; }
      }
      await db.query('SAVEPOINT row');
      try { await insertRow(db, name, row, { upsert: true }); await db.query('RELEASE SAVEPOINT row'); ok += 1; }
      catch (error) { await db.query('ROLLBACK TO SAVEPOINT row'); skipped.push(`${name} ${row.id}: ${error.message}`); }
    }
    report[name] = `${ok}/${rows.length}`;
  }
  if (data.settings) { await saveSettings(db, data.settings); report.settings = 'updated'; }
  for (const user of Array.isArray(data.users) ? data.users : []) {
    if (!user?.email || !user.passwordHash) continue;
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [user.id, user.name || user.email, String(user.email).toLowerCase(), user.passwordHash, user.role === 'admin' ? 'staff' : (user.role || 'staff')],
    );
  }
});

console.log('Import finished:', report);
if (skipped.length) console.log(`Skipped ${skipped.length} record(s):\n - ${skipped.join('\n - ')}`);
await closePool();
