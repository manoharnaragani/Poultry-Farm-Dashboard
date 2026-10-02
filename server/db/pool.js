import 'dotenv/config';
import pg from 'pg';

const { Pool, types } = pg;

// Return DATE columns as plain 'YYYY-MM-DD' strings and numeric columns as JS numbers.
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => parseFloat(value));
types.setTypeParser(20, (value) => parseInt(value, 10));

let pool;

function normalizeConnection(rawUrl) {
  const noVerify = process.env.DATABASE_SSL === 'no-verify';
  let connectionString = rawUrl;
  const ssl = noVerify ? { rejectUnauthorized: false } : undefined;

  try {
    const parsed = new URL(rawUrl);
    const sslmode = parsed.searchParams.get('sslmode');
    if (noVerify) {
      if (sslmode) parsed.searchParams.delete('sslmode');
      connectionString = parsed.toString();
    } else if (sslmode && ['prefer', 'require', 'verify-ca'].includes(sslmode.toLowerCase())) {
      parsed.searchParams.set('sslmode', 'verify-full');
      connectionString = parsed.toString();
    }
  } catch {
    // In case of non-standard connection strings, fallback to raw.
  }

  return { connectionString, ssl };
}

export function getPool() {
  if (pool) return pool;
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a file named .env in the project folder with a line like:\n' +
      '  DATABASE_URL=postgresql://user:password@host:5432/dbname\n' +
      'See SETUP-DATABASE.md for how to get a free PostgreSQL database.',
    );
  }
  const { connectionString, ssl } = normalizeConnection(rawUrl);
  const config = {
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000, // free hosted databases can take a few seconds to wake up
  };
  if (ssl) config.ssl = ssl;
  pool = new Pool(config);
  pool.on('error', (error) => console.error('Unexpected PostgreSQL error:', error.message));
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function withTx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
