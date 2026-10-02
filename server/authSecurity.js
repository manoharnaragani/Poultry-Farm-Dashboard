import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
export const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!/^[a-f0-9]{32}$/i.test(salt || '') || !/^[a-f0-9]{128}$/i.test(expected || '') || typeof password !== 'string' || password.length > 256) return false;
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return cookies;
}
export const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const validPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 256 && /[a-zA-Z]/.test(value) && /[^a-zA-Z]/.test(value);
export const validName = (value) => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(value);
export function cookie(res, name, value, secure, maxAge = 604800, path = '/') {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
export function sameOrigin(req, origin) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.get('Sec-Fetch-Site') === 'cross-site') return false;
  const sent = req.get('Origin');
  if (!sent) return true; // non-browser clients do not send browser credentials automatically
  return sent === (origin || `${req.protocol}://${req.get('host')}`);
}
