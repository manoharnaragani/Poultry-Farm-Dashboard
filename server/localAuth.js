import crypto from 'node:crypto';
import { query, withTx } from './db/pool.js';

const SESSION_COOKIE = 'nestledger_session';
const isProd = process.argv.includes('--production');
const SECURE = isProd ? '; Secure' : '';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// Simple login rate limit: 10 failed tries / 15 minutes / IP address.
const attempts = new Map();
function tooManyAttempts(req) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}
function recordFailure(req) { const ip = req.ip || 'unknown'; attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]); }

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${SECURE}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE}`);
}
const publicUser = (user) => (user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null);

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS)]);
  return token;
}

// Reuse existing administrator accounts and reject staff-email conflicts clearly.
export async function initializeAdmin(db, { email, password = '', name = 'Farm Admin', production = false, explicitEmail = true }) {
  const adminEmail = String(email || 'admin@nestledger.local').trim().toLowerCase();
  // Serialize startup on multiple application instances.
  await db.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
  const { rows } = await db.query("SELECT * FROM users WHERE id = 'USR-ADMIN' OR lower(email) = $1 FOR UPDATE", [adminEmail]);
  const matching = rows.find((user) => user.email.toLowerCase() === adminEmail);
  if (matching && matching.role !== 'admin') {
    throw new Error('ADMIN_EMAIL belongs to an existing staff account. In Render Environment, use the email of your existing administrator or an unused email, then redeploy.');
  }
  const admin = matching || rows.find((user) => user.id === 'USR-ADMIN');
  if (!admin) {
    if (production && (!explicitEmail || !password)) {
      throw new Error('First start: set ADMIN_EMAIL and ADMIN_PASSWORD environment variables to create the admin account.');
    }
    await db.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES ('USR-ADMIN', $1, $2, $3, 'admin')",
      [name, adminEmail, hashPassword(password || 'Admin@123')],
    );
    return;
  }
  if (password && !verifyPassword(password, admin.password_hash)) {
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), admin.id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [admin.id]);
  }
  if (explicitEmail && admin.email.toLowerCase() !== adminEmail) {
    await db.query('UPDATE users SET email = $1 WHERE id = $2', [adminEmail, admin.id]);
  }
}
export async function initAuth() {
  await withTx((db) => initializeAdmin(db, {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD || '',
    name: process.env.ADMIN_NAME || 'Farm Admin',
    production: isProd,
    explicitEmail: Boolean(process.env.ADMIN_EMAIL),
  }));
}

export function registerAuthRoutes(app) {
  // Update own profile (name, email, password) — any signed-in user.
  app.put('/api/auth/profile', ah(async (req, res) => {
    const user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ success: false, message: 'Sign in to change your profile.' });
    const { name, email, currentPassword, newPassword } = req.body || {};
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [user.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ success: false, message: 'Account not found.' });
    // If changing password, current password must be verified first.
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ success: false, message: 'Enter your current password to set a new one.' });
      if (!verifyPassword(currentPassword, existing.password_hash)) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }
    const newName = (name || '').trim() || existing.name;
    const newEmail = (email || '').trim().toLowerCase() || existing.email;
    if (!/^\S+@\S+\.\S+$/.test(newEmail)) return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    try {
      await query('UPDATE users SET name = $1, email = $2 WHERE id = $3', [newName, newEmail, user.id]);
      if (newPassword) {
        await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), user.id]);
        // Sign out all other sessions so the new password takes effect everywhere.
        await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      }
      return res.json({ success: true, data: { id: user.id, name: newName, email: newEmail, role: existing.role } });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, message: 'That email is already used by another account.' });
      throw error;
    }
  }));

  app.get('/api/session', ah(async (req, res) => {
    res.json({ success: true, data: publicUser(await getAuthenticatedUser(req)) });
  }));

  app.post('/api/auth/login', ah(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });
    if (tooManyAttempts(req)) return res.status(429).json({ success: false, message: 'Too many failed attempts. Try again in 15 minutes.' });
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFailure(req);
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    const token = await createSession({ query }, user.id);
    setSessionCookie(res, token);
    return res.json({ success: true, data: publicUser(user) });
  }));

  app.post('/api/auth/register', ah(async (req, res) => {
    if (isProd && process.env.ALLOW_REGISTRATION !== 'true') return res.status(403).json({ success: false, message: 'Registration is disabled. Ask the farm admin to create your account.' });
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (name.length < 2) return res.status(400).json({ success: false, message: 'Please enter your full name.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email.' });
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    try {
      const user = { id: `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, name, email, role: 'staff' };
      await query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [user.id, name, email, hashPassword(password), user.role]);
      const token = await createSession({ query }, user.id);
      setSessionCookie(res, token);
      return res.status(201).json({ success: true, data: publicUser(user) });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
      throw error;
    }
  }));

  app.post('/api/logout', ah(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    clearSessionCookie(res);
    res.json({ success: true, data: { loggedOut: true } });
  }));
}

export async function getAuthenticatedUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await query(
    'SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()',
    [hashToken(token)],
  );
  return rows[0] || null;
}
