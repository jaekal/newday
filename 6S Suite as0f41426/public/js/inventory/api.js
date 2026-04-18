// public/js/inventory/api.js



export const API_PREFIX =
  (typeof window !== 'undefined' && window.__API_PREFIX__) ||
  '/inventory';

// Origin (same-origin by default)
const PAGE_ORIGIN =
  (typeof window !== 'undefined' && window.location && window.location.origin) ||
  '';

// Resolve absolute base once, avoiding double-origins when API_PREFIX is absolute
const API_BASE = (() => {
  const p = String(API_PREFIX || '').trim() || '/inventory';
  const isAbs = /^https?:\/\//i.test(p) || p.startsWith('//');
  const base = isAbs ? p : `${PAGE_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`;
  return base.replace(/\/+$/, ''); // no trailing slash
})();

// Shared timeout (ms) for requests
const DEFAULT_TIMEOUT = 15000;

/* =========================
   Helpers
========================= */

// Read CSRF token from <meta name="csrf-token"> or the XSRF-TOKEN cookie.
function getCsrfToken() {
  if (typeof document === 'undefined') return '';
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// True when URL shares the same origin (so CSRF headers are meaningful)
function isSameOrigin(url) {
  if (typeof window === 'undefined') return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

// Attempt to extract a useful error message from a Response
async function extractErrorMessage(res) {
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await res.json();
      const details = Array.isArray(j?.error?.details) ? j.error.details : [];
      const detailText = details
        .map((d) => d?.message || `${d?.path || 'field'} is invalid`)
        .filter(Boolean)
        .join(' ');
      return {
        message: j?.message || j?.error?.message || JSON.stringify(j),
        details,
        detailText,
      };
    }
    const t = await res.text();
    return { message: t || `HTTP ${res.status} ${res.statusText}`, details: [] };
  } catch {
    return { message: `HTTP ${res.status} ${res.statusText}`, details: [] };
  }
}

// Parse filename from Content-Disposition header
function filenameFromDisposition(hdr, fallback = 'download') {
  if (!hdr) return fallback;
  const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(hdr);
  if (star && star[2]) {
    try { return decodeURIComponent(star[2]); } catch { return star[2]; }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(hdr) || /filename\s*=\s*([^;]+)/i.exec(hdr);
  return (plain && plain[1]) ? plain[1].trim() : fallback;
}

// Join path segments to the API base safely
function joinApi(path = '') {
  const seg = String(path || '');
  return `${API_BASE}${seg.startsWith('/') ? seg : `/${seg}`}`;
}

/* =========================
   Central request helper
========================= */
async function request(
  path,
  {
    method = 'GET',
    headers = {},
    body,
    credentials = 'include',
    timeout = DEFAULT_TIMEOUT,
    raw = false, // when true, return the Response directly (caller handles blobs, etc.)
  } = {}
) {
  const url = joinApi(path || '');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  const opts = {
    method,
    credentials,
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      ...headers,
    },
    signal: ctrl.signal,
  };

  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob) {
      opts.body = body;
    } else if (typeof body === 'object') {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.body = body;
    }
  }

  // Add CSRF only for mutating requests to same-origin URLs
  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
  if (needsCsrf && isSameOrigin(url)) {
    const csrf = getCsrfToken();
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
  }

  if (!raw && !opts.headers['Accept']) {
    opts.headers['Accept'] = 'application/json, text/plain;q=0.9, */*;q=0.8';
  }

  try {
    const res = await fetch(url, opts);

    // Handle auth redirects / unauthenticated states gracefully
    if (res.redirected && typeof window !== 'undefined' && res.url.includes('/auth/login')) {
      window.location.href = res.url;
      // never resolve
      return new Promise(() => {});
    }
    if ((res.status === 401 || res.status === 419) && typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.href);
      window.location.href = `/auth/login?next=${next}`;
      return new Promise(() => {});
    }

    if (!res.ok) {
      const parsed = await extractErrorMessage(res);
      const message = parsed?.detailText ? `${parsed.message} ${parsed.detailText}` : parsed?.message;
      const err = new Error(message);
      err.status = res.status;
      err.details = parsed?.details || [];
      throw err;
    }

    if (raw) return res;

    if (res.status === 204) return null;

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    if (!('status' in e)) e.message = e.message || 'Network error';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Try multiple candidate paths (useful for minor server route differences)
async function requestFirst(paths, options) {
  let last404 = null;
  for (const p of paths) {
    try {
      return await request(p, options);
    } catch (e) {
      if (e && e.status === 404) { last404 = e; continue; }
      throw e;
    }
  }
  if (last404) throw last404;
  throw new Error('Not found');
}

/* =========================
   URL helpers
========================= */
export function imageUrl(code) {
  return `${API_BASE}/${encodeURIComponent(code)}/image`;
}
export function auditLogUrl(params) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `${API_BASE}/audit-log${qs}`;
}

/* =========================
   API SURFACE
========================= */

export async function fetchInventory({ building } = {}) {
  // GET /inventory?building=Bldg-350 (or 'all' for no filter)
  const qs = building && building !== 'all' ? `?building=${encodeURIComponent(building)}` : '';
  return request(qs);
}

/** Checkout an item by code. body = { qty, operatorId, sixSOperator } */
export async function checkoutItem(code, body) {
  return request(`/${encodeURIComponent(code)}/checkout`, { method: 'POST', body });
}

/** Save (create or update) an inventory item. */
export async function saveItem(code, data, editing) {
  if (editing) {
    const target = data.originalItemCode || code;
    return request(`/${encodeURIComponent(target)}`, { method: 'PUT', body: data });
  } else {
    return request('', { method: 'POST', body: data });
  }
}

/** Delete an inventory item by code. */
export async function deleteItem(code) {
  return request(`/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

/** Fetch audit log for a specific item code (with optional filters). */
export async function fetchAuditLog(code, filters = {}) {
  if (!code) throw new Error('fetchAuditLog: missing code');
  const params = new URLSearchParams({ itemCode: code, ...filters }).toString();
  return request(`/audit-log?${params}`);
}

/** Import inventory from a CSV file (FormData). */
export async function importCsv(formData) {
  // POST /inventory/import
  return request('/import', {
    method: 'POST',
    body: formData,
    // Let browser set multipart boundary; request() won't add Content-Type for FormData
  });
}

/** Bulk delete inventory items by array of codes. */
export async function bulkDelete(codes) {
  return request('/bulk-delete', { method: 'POST', body: { codes } });
}

/** Bulk reorder export (download PO CSV). Returns { blob, filename }.
 *  Tries '/bulk-reorder/export' first, then legacy '/bulk-reorder-export'.
 */
export async function bulkReorderExport(codes, requester, justification = '') {
  const res = await (async () => {
    try {
      return await request('/bulk-reorder/export', {
        method: 'POST',
        body: { codes, requester, justification },
        raw: true,
      });
    } catch (e) {
      if (e.status === 404) {
        return request('/bulk-reorder-export', {
          method: 'POST',
          body: { codes, requester, justification },
          raw: true,
        });
      }
      throw e;
    }
  })();

  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const filename = filenameFromDisposition(
    cd,
    `PO_bulk_reorder_${new Date().toISOString().slice(0, 10)}.csv`
  );
  return { blob, filename };
}

/** (Legacy) Bulk reorder (non-export). */
export async function bulkReorder(codes) {
  // Keep for compatibility if your backend still exposes it
  return request('/bulk-reorder', { method: 'POST', body: { codes } });
}

/** -------- Image helpers (centralized) -------- */
export async function uploadImage(code, file) {
  const fd = new FormData();
  fd.append('image', file);
  // Use raw fetch via request(); it will attach CSRF for same-origin.
  return request(`/${encodeURIComponent(code)}/image`, { method: 'POST', body: fd });
}
export async function deleteImage(code) {
  return request(`/${encodeURIComponent(code)}/image`, { method: 'DELETE' });
}

export default {
  API_PREFIX,
  fetchInventory,
  checkoutItem,
  saveItem,
  deleteItem,
  fetchAuditLog,
  importCsv,
  bulkDelete,
  bulkReorderExport,
  bulkReorder,
  imageUrl,
  auditLogUrl,
  uploadImage,
  deleteImage,
};
