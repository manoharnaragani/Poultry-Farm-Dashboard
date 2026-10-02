import { createEmptyData } from './data.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
// Remove legacy browser sample records on every load; they are never read again.
export function clearDemoStorage() {
  try { localStorage.removeItem('nestledger.demo.v1'); } catch {}
}
clearDemoStorage();
const cache = createEmptyData();
let remoteAvailable = false;

export const isRemoteConnected = () => remoteAvailable;
export const getLocalData = () => cache;
export function clearRemoteData() {
  remoteAvailable = false;
  for (const key of Object.keys(cache)) delete cache[key];
  Object.assign(cache, createEmptyData());
  return cache;
}
export function persistLocal(next) {
  if (remoteAvailable) return;
  const snapshot = clone(next);
  for (const key of Object.keys(cache)) delete cache[key];
  Object.assign(cache, snapshot);
}

export const apiRoot = () => (window.FARM_API_URL || localStorage.getItem('nestledger.apiUrl') || '').replace(/\/$/, '');
function apiHeaders() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  try {
    const token = sessionStorage.getItem('nestledger.apiToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* Storage may be disabled; same-origin session cookies still work. */ }
  return headers;
}
export async function request(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`${apiRoot()}/api${path}`, {
      method,
      headers: apiHeaders(),
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    const netErr = new Error('Database server is not reachable. Check your connection or server status.');
    netErr.status = 503;
    throw netErr;
  }

  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    try { payload = await response.json(); } catch {}
  }

  if (response.status === 401) {
    const err = new Error(payload?.message || 'Your session has expired. Please sign in again.');
    err.status = 401;
    throw err;
  }

  if (!response.ok || !payload || payload.success !== true) {
    const message = payload?.message || `Request failed (${response.status} ${response.statusText})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }

  remoteAvailable = true;
  return payload.data;
}

export async function loadResource(endpoint, key) {
  try {
    const rows = await request(endpoint);
    if (Array.isArray(rows)) {
      cache[key] = rows;
      return rows;
    }
  } catch (error) {
    if (error.status === 401) throw error;
    remoteAvailable = false;
    cache[key] = createEmptyData()[key] || [];
  }
  return cache[key] || [];
}

export async function loadRemoteSettings() {
  try {
    const settings = await request('/settings');
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : null;
  } catch (error) {
    if (error.status === 401) throw error;
    return null;
  }
}

export async function saveRemoteSettings(settings) {
  return request('/settings', 'PUT', settings);
}

export async function saveResource(endpoint, key, method, body, id) {
  return request(id ? `${endpoint}/${encodeURIComponent(id)}` : endpoint, method, body);
}

export async function tryRemoteDelete(endpoint, id) {
  return request(`${endpoint}/${encodeURIComponent(id)}`, 'DELETE');
}
