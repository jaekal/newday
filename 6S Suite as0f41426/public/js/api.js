// public/js/api.js — relative paths + credentials to keep cookies attached

const DEFAULT_TIMEOUT = 15000;

function withTimeout(signal, ms = DEFAULT_TIMEOUT) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  const anySignal = signal;
  if (anySignal) anySignal.addEventListener('abort', () => ctrl.abort());
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

async function request(path, { method = 'GET', headers = {}, body, signal } = {}) {
  const url = path.startsWith('/') ? path : `/${path}`;
  const { signal: timeoutSignal, cancel } = withTimeout(signal);

  const opts = {
    method,
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...headers },
    signal: timeoutSignal
  };

  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob) {
      opts.body = body;
    } else if (typeof body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else {
      opts.body = body;
    }
  }

  try {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally {
    cancel();
  }
}

// Example exports you can adapt per feature area:

export const api = {
  getTools: () => request('/tools'),
  checkoutTool: (id, payload) => request(`/tools/${encodeURIComponent(id)}/checkout`, { method: 'POST', body: payload }),
  getAdminSession: () => request('/admin/session'),
  getInventory: () => request('/inventory'),
  // ...etc
};
