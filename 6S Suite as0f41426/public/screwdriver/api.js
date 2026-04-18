/* public/screwdriver/api.js — same-origin client with auth redirect handling */

const BASE_URL = ''; // relative to current origin
const DEFAULT_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function withQuery(path, params) {
  if (!params || !Object.keys(params).length) return path;
  const url = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).length) url.searchParams.set(k, v);
  });

  // Preserve exactly the caller's path prefix plus query
  const isAbs = path.startsWith('http');
  const isRoot = path.startsWith('/');
  const basePath = isAbs ? url.pathname : (isRoot ? url.pathname : path.split('?')[0]);
  return basePath + url.search;
}

async function toJsonSafe(res) { try { return await res.json(); } catch { return null; } }

async function request(path, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const method = (opts.method || 'GET').toUpperCase();
  // Align CSRF header with kiosk & common middleware
  const csrfHeaders = MUTATING.has(method) ? { 'X-CSRF-Token': getCsrfToken() } : {};
  let body = opts.body;
  const isFD = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && !isFD && typeof body !== 'string') body = JSON.stringify(body);

  const headers = { ...DEFAULT_HEADERS, ...csrfHeaders, ...(opts.headers || {}) };
  if (isFD) delete headers['Content-Type'];

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers,
      method,
      body
    });

    // If we’re bounced to the login page, go there
    if (res.redirected && res.url.includes('/auth/login')) {
      window.location.href = res.url; return;
    }
    if (res.status === 401) {
      window.location.href = '/auth/login'; return;
    }

    const payload = res.status === 204 ? null : await toJsonSafe(res);
    if (!res.ok) {
      const msg = payload?.message || payload?.error?.message || res.statusText || `Status ${res.status}`;
      const err = new Error(`API Error [${method} ${path}]: ${msg}`);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(t);
  }
}

/* Public endpoints */
export function getEmployees(params) { return request(withQuery('/employees', params)); }
export function getTools(params)     { return request(withQuery('/tools', params)); }
export function getSession()         { return request('/auth/whoami'); }

/* Tool actions (unchanged) */
export function apiCheckout(serialNumber, operatorId) {
  if (!serialNumber) throw new Error('serialNumber required');
  if (!operatorId) throw new Error('operatorId required');
  return request(`/tools/${encodeURIComponent(serialNumber)}/checkout`, { method: 'POST', body: { operatorId } });
}
export function apiReturn(serialNumber) {
  if (!serialNumber) throw new Error('serialNumber required');
  return request(`/tools/${encodeURIComponent(serialNumber)}/return`, { method: 'POST', body: {} });
}
export function apiBulkAction(serialNumbers, action, operatorId) {
  if (!Array.isArray(serialNumbers) || !serialNumbers.length) throw new Error('serialNumbers array required');
  if (action === 'checkout' && !operatorId) throw new Error('operatorId required for bulk checkout');
  const endpoint = action === 'checkout' ? '/tools/bulk/checkout' : '/tools/bulk/return';
  const body = action === 'checkout' ? { serialNumbers, operatorId } : { serialNumbers };
  return request(endpoint, { method: 'POST', body });
}
export function returnInventoryItem(item) { return request('/tools/return', { method: 'POST', body: item }); }

/* CRUD + Admin */
export function addTool(toolData)                { return request('/tools', { method: 'POST', body: toolData }); }
export function editTool(serialNumber, update)   { return request(`/tools/${encodeURIComponent(serialNumber)}`, { method: 'PUT', body: update }); }
export function deleteTool(serialNumber)         { return request(`/tools/${encodeURIComponent(serialNumber)}`, { method: 'DELETE' }); }
export function getTool(serialNumber)            { return request(`/tools/${encodeURIComponent(serialNumber)}`); }

export function adminLogin(username, password)   { 
  // Returns JSON (server detects Accept: application/json)
  return request('/auth/login', { method: 'POST', body: { username, password } }); 
}
export function adminLogout()                    { return request('/auth/logout', { method: 'POST' }); }

export function updateEmployee(empData)          { return request('/employees/update', { method: 'POST', body: empData }); }
export function deleteEmployee(empId)            { return request(`/employees/delete/${encodeURIComponent(empId)}`, { method: 'DELETE' }); }
export function getAuditLog(params)              { return request(withQuery('/admin/audit-log', params)); }
export function submitWeeklyAudit(serials)       { return request('/admin/weeklyAudit', { method: 'POST', body: { serials, time: new Date().toISOString() } }); }
