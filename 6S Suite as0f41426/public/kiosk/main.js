/* Kiosk main.js — touch friendly; queues offline; reuses theme tokens */

/* ---------- Notyf (safe) ---------- */
const NotyfCtor = window.Notyf || function () {
  return { success(){}, error(){}, open(){}, dismissAll(){} };
};
const notyf = window.notyf || new NotyfCtor({
  duration: 3500,
  position: { x: 'right', y: 'bottom' }
});

/* ---------- CSRF & helpers ---------- */
function getCsrf() {
  const el = document.querySelector('meta[name="csrf-token"]');
  const meta = el?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function isSameOrigin(url) {
  try { return new URL(url, location.href).origin === location.origin; }
  catch { return false; }
}
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
const live = (msg) => {
  const r = qs('#liveRegion');
  if (r) r.textContent = msg;
};

function setInvalid(input, msgEl, message) {
  if (input) input.setAttribute('aria-invalid', 'true');
  if (msgEl) {
    msgEl.textContent = message || '';
    msgEl.hidden = !message;
  }
}
function clearInvalid(input, msgEl) {
  if (input) input.removeAttribute('aria-invalid');
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.hidden = true;
  }
}
function showPreview(imgEl, textEl, code) {
  if (!imgEl || !textEl) return;
  imgEl.src = `/inventory/${encodeURIComponent(code)}/image`;
  imgEl.onerror = () => { imgEl.src = ''; };
  textEl.textContent = `Code: ${code}`;
  imgEl.parentElement.hidden = false;
}

/* ---------- Current user (whoami) ---------- */
let currentUser = null;
let currentUserShift = null;

function updateUserBanner() {
  const banner = qs('#userBanner');
  if (!banner) return;

  if (!currentUser) {
    banner.textContent = 'User not detected – please log out and back in.';
    return;
  }

  const techId = currentUser.techId && String(currentUser.techId).trim();
  const name = currentUser.name || currentUser.id || 'Unknown user';

  if (techId) {
    banner.textContent = `${name} • Tech ID: ${techId}`;
  } else {
    banner.textContent = `${name}`;
  }
}

async function fetchCurrentUser() {
  try {
    // NOTE: allow /api/* to go through without kiosk prefix (see request() below)
    const res = await request('/api/whoami', { method: 'GET' });
    currentUser = res?.user || null;
    currentUserShift = null;

    const techId = currentUser?.techId || currentUser?.id || '';
    if (techId) {
      try {
        const employees = await request('/employees', { method: 'GET' });
        const items = Array.isArray(employees) ? employees : (employees?.items || []);
        const match = items.find((e) => String(e.id || e.techId || '').trim() === String(techId).trim());
        if (match?.shift) currentUserShift = Number(match.shift) || null;
      } catch (shiftErr) {
        console.warn('shift lookup failed:', shiftErr?.message || shiftErr);
      }
    }
  } catch (e) {
    console.warn('whoami failed:', e?.message || e);
    currentUser = null;
    currentUserShift = null;
  }
  updateUserBanner();
}

function isQueueAdmin() {
  const r = (currentUser?.role || '').toLowerCase();
  return r === 'admin' || r === 'lead' || r === 'management';
}

/**
 * Derive the operator ID for kiosk actions.
 * Primary: user.techId (bound to employee registry)
 * Fallback: user.id (username)
 */
function getCurrentOperatorId() {
  if (currentUser?.techId) return String(currentUser.techId).trim();
  if (currentUser?.id)     return String(currentUser.id).trim();
  return '';
}

/* ---------- Minimal request + requestFirst ---------- */
const DEFAULT_TIMEOUT = 12000;

async function request(path, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    raw = false,
    _csrfRetry = false,
  } = options;

  const url = path.startsWith('http')
    ? path
    : (
        path.startsWith('/kiosk')      ||
        path.startsWith('/inventory')  ||
        path.startsWith('/tools')      ||
        path.startsWith('/esd-carts')  ||
        path.startsWith('/asset-catalog') ||
        path.startsWith('/employees')  ||
        path.startsWith('/api')        ||  // 👈 allow /api/whoami etc
        path.startsWith('/auth')
      )
      ? path
      : `/kiosk${path.startsWith('/') ? '' : '/'}${path}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);

  const opts = {
    method,
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...headers },
    signal: ctrl.signal
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

  const needsCsrf = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
  if (needsCsrf && isSameOrigin(url)) {
    const csrf = getCsrf();
    if (csrf) {
      opts.headers['X-CSRF-Token'] = csrf;
      opts.headers['X-XSRF-TOKEN'] = csrf;
    }
  }

  if (!raw && !opts.headers['Accept']) {
    opts.headers['Accept'] = 'application/json, text/plain;q=0.9,*/*;q=0.8';
  }

  try {
    const res = await fetch(url, opts);

    // CSRF token mismatch recovery.
    //
    // The server's CSRF middleware refreshes the non-HttpOnly XSRF-TOKEN
    // cookie on EVERY response — including the 403 that rejected us. After
    // a server restart, a session regenerate on login, or any other drift
    // between the browser's cached cookie and req.session.csrfToken, the
    // first unsafe request will 403 but the response carries a Set-Cookie
    // with the current token. Retrying once with the refreshed cookie
    // succeeds without forcing the operator to reload the page.
    if (res.status === 403 && needsCsrf && !_csrfRetry && isSameOrigin(url)) {
      let msg = '';
      try {
        const ct = res.headers.get('content-type') || '';
        msg = ct.includes('application/json')
          ? (await res.clone().json())?.message || ''
          : await res.clone().text();
      } catch { /* ignore body read errors */ }
      if (/csrf/i.test(msg || '')) {
        clearTimeout(t);
        // Kick a GET at whoami to guarantee the new cookie is applied by the
        // browser before we retry. Same-origin, safe method, no-op on auth.
        try {
          await fetch('/api/whoami', {
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
        } catch { /* ignore */ }
        return request(path, { ...options, _csrfRetry: true });
      }
    }

    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      const msg = ct.includes('application/json')
        ? (await res.json())?.message
        : await res.text();
      const err = new Error(msg || `HTTP ${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (raw) return res;
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Request timed out.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function requestFirst(paths, options) {
  let last404 = null;
  for (const p of paths) {
    try {
      return await request(p, options);
    } catch (e) {
      if (e.status === 404) {
        last404 = e;
        continue;
      }
      throw e;
    }
  }
  if (last404) throw last404;
  throw new Error('Not found');
}

/* ---------- Validation endpoints ---------- */
async function validateKnownTool(code) {
  if (!code) return { known: false };
  try {
    const res = await request(`/kiosk/validate/tool/${encodeURIComponent(code)}`);
    return res || { known: false };
  } catch {
    return { known: false };
  }
}

/* ---------- Offline queue + active tracking ---------- */
const QKEY          = 'kiosk:queue.v2';    // bumped from v1; old jobs are abandoned on first load
const ACTIVE_PREFIX = 'kiosk:active.v1:';
const LAST_OP_KEY   = 'kiosk:lastOperatorId';

// Jobs older than this are dropped during drain (avoids replaying week-old checkouts)
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function readQueue() {
  try {
    const raw = localStorage.getItem(QKEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeQueue(arr) {
  try { localStorage.setItem(QKEY, JSON.stringify(arr)); } catch (e) {
    // localStorage full (quota exceeded) — trim oldest half and retry once
    try {
      const trimmed = arr.slice(-Math.floor(arr.length / 2));
      localStorage.setItem(QKEY, JSON.stringify(trimmed));
      console.warn('localStorage quota hit; queue trimmed to', trimmed.length, 'items');
    } catch { /* storage completely unavailable; queue lives in memory only */ }
  }
  updateQueueBadge();
}

/**
 * Deduplicate key: jobs of the same type operating on the same resource
 * within a short window are considered the same operation.
 * Returns a string used to detect near-duplicate enqueues.
 */
function jobDedupeKey(job) {
  const { type, payload } = job;
  if (!type || !payload) return null;
  const resource =
    payload.borrowId ||
    (type === 'partBorrow'
      ? `${payload.partSn || ''}:${payload.targetServerSn || ''}:${payload.purpose || ''}`
      : '') ||
    payload.code    ||
    payload.cartId  ||
    payload.text    ||   // suggestion text
    payload.description || // ticket description
    '';
  return `${type}:${String(resource).slice(0, 120)}`;
}

function enqueue(job) {
  const enriched = {
    ...job,
    enqueuedAt: job.enqueuedAt || Date.now(),
    // Strip File objects — they cannot be serialized; dispatchJob already
    // handles the imageFile-absent case by falling back to JSON.
    payload: job.payload ? { ...job.payload, imageFile: undefined } : job.payload,
  };

  const q = readQueue();

  // Deduplicate: if the same logical operation is already pending, don't add again.
  const key = jobDedupeKey(enriched);
  if (key) {
    const alreadyQueued = q.some(existing => jobDedupeKey(existing) === key);
    if (alreadyQueued) {
      console.warn('[kiosk queue] Duplicate job skipped:', key);
      return;
    }
  }

  q.push(enriched);
  writeQueue(q);
  updateQueueBadge();
}

function updateQueueBadge() {
  const q = readQueue();
  const badge = qs('#queueBadge');
  const n = qs('#queueCount');
  if (!badge || !n) return;
  if (q.length) {
    badge.hidden = false;
    n.textContent = String(q.length);
  } else {
    badge.hidden = true;
    n.textContent = '0';
  }
}

function setLastOperator(operatorId) {
  try { localStorage.setItem(LAST_OP_KEY, operatorId || ''); } catch {}
}
function getLastOperator() {
  try { return localStorage.getItem(LAST_OP_KEY) || ''; } catch { return ''; }
}

function activeKeyFor(operatorId) {
  return `${ACTIVE_PREFIX}${operatorId || 'unknown'}`;
}
function readActive(operatorId) {
  const key = activeKeyFor(operatorId);
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}
function writeActive(operatorId, arr) {
  const key = activeKeyFor(operatorId);
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
}

function updateActiveOnCheckout({ operatorId, code, cartId, kind, borrowId, partSn, targetServerSn }) {
  if (!operatorId) return;
  const key = operatorId;
  const current = readActive(key);
  const idValue = cartId || code;
  if (kind === 'partBorrow') {
    if (!borrowId) return;
  } else if (!idValue) return;

  const existingIdx = current.findIndex((x) => {
    if (kind === 'partBorrow') {
      return x.kind === 'partBorrow' && String(x.borrowId) === String(borrowId);
    }
    return x.kind === kind && (x.code === idValue || x.cartId === idValue);
  });
  const nowIso = new Date().toISOString();
  const rec =
    kind === 'partBorrow'
      ? {
          kind: 'partBorrow',
          borrowId,
          partSn: partSn || '',
          targetServerSn: targetServerSn || '',
          status: 'out',
          since: nowIso,
        }
      : {
          kind,
          code: kind === 'cart' ? undefined : idValue,
          cartId: kind === 'cart' ? idValue : undefined,
          status: 'out',
          since: nowIso,
        };

  if (existingIdx >= 0) current[existingIdx] = rec;
  else current.push(rec);
  writeActive(key, current);
}

function updateActiveOnReturn({ operatorId, code, cartId, kind, borrowId }) {
  if (!operatorId) return;
  const key = operatorId;
  const current = readActive(key);
  const idValue = cartId || code;
  const filtered = current.filter((x) => {
    if (kind === 'partBorrow') {
      return !(x.kind === 'partBorrow' && String(x.borrowId) === String(borrowId));
    }
    return !(x.kind === kind && (x.code === idValue || x.cartId === idValue));
  });
  writeActive(key, filtered);
}

let _draining = false; // concurrency guard — prevents double-dispatch on rapid online events

async function drainQueue() {
  if (_draining) return;            // already running; don't stack a second drain
  if (!navigator.onLine) return;
  const q = readQueue();
  if (!q.length) return;

  _draining = true;
  const remain = [];
  const now = Date.now();

  try {
    for (const job of q) {
      const t   = job?.type;
      const op  = job?.payload?.operatorId;
      const age = now - (job?.enqueuedAt || 0);

      // Drop jobs older than the max age — they're almost certainly stale
      if (age > QUEUE_MAX_AGE_MS) {
        console.warn('[kiosk queue] Dropping expired job (age', Math.round(age/3600000), 'h):', t);
        continue;
      }

      // Drop checkout/return jobs with no operatorId — they'll always 400
       if (
     (t === 'toolCheckout'      || t === 'toolReturn'       ||
      t === 'cartCheckout'      || t === 'cartReturn'       ||
      t === 'equipmentCheckout' || t === 'equipmentReturn'  ||
      t === 'partBorrow'        || t === 'partBorrowReturn') &&
     !op
   ) {
        console.warn('[kiosk queue] Dropping invalid job with no operatorId:', job);
        continue;
      }

      try {
        await dispatchJob(job);
        notyf.success(`Queued ${t} sent`);
      } catch (e) {
        // 4xx errors are permanent failures — don't retry
        if (e?.status >= 400 && e?.status < 500) {
          console.warn('[kiosk queue] Dropping job after', e.status, 'response:', t);
          notyf.error(`Queued ${t} failed (${e.status}) — removed`);
        } else {
          remain.push(job); // network/5xx error — keep for next retry
        }
      }
    }
  } finally {
    _draining = false;
  }

  writeQueue(remain);
}

/* ---------- Endpoints dispatcher (tools & carts) ---------- */
async function dispatchJob(job) {
  const { type, payload } = job;

  switch (type) {
    case 'toolCheckout': {
      const { code, operatorId } = payload;
      const qty = 1;              // simplified: always 1
      const sixSOperator = '';    // no longer captured from UI

      const serial = encodeURIComponent(code);

      // Inventory (best-effort)
      try {
        await request(`/inventory/${serial}/checkout`, {
          method: 'POST',
          body: { code, qty, operatorId, sixSOperator }
        });
      } catch (e) {
        console.warn('Inventory checkout failed (continuing to tools):', e?.message || e);
      }

      // Screwdriver tools
      const res = await request(`/tools/${serial}/checkout`, {
        method: 'POST',
        body: { operatorId }
      });

      updateActiveOnCheckout({ operatorId, code, kind: 'tool' });
      return res;
    }

    case 'toolReturn': {
      const { code, operatorId } = payload;
      const qty = 1; // symmetric with checkout
      const serial = encodeURIComponent(code);

      try {
        await request(`/inventory/${serial}/checkin`, {
          method: 'POST',
          body: { code, qty, operatorId }
        });
      } catch (e) {
        console.warn('Inventory return failed (continuing to tools):', e?.message || e);
      }

      const res = await request(`/tools/${serial}/return`, {
        method: 'POST',
        body: {}
      });

      updateActiveOnReturn({ operatorId, code, kind: 'tool' });
      return res;
    }

    case 'cartCheckout': {
      const { operatorId, cartId } = payload;

      const body = { operatorId }; // what /esd-carts/:cartId/checkout expects

      const res = await requestFirst(
        [
          `/esd-carts/${encodeURIComponent(cartId)}/checkout`,
          `/kiosk/esd-carts/checkout`,
          `/esd-carts/checkout`
        ],
        { method: 'POST', body }
      );

      updateActiveOnCheckout({ operatorId, cartId, kind: 'cart' });
      return res;
    }

    case 'cartReturn': {
      const { operatorId, cartId } = payload;

      const body = { operatorId };

      const res = await requestFirst(
        [
          `/esd-carts/${encodeURIComponent(cartId)}/checkin`,
          `/kiosk/esd-carts/checkin`,
          `/esd-carts/checkin`
        ],
        { method: 'POST', body }
      );

      updateActiveOnReturn({ operatorId, cartId, kind: 'cart' });
      return res;
    }
case 'equipmentCheckout': {
     const { operatorId, tagNumber } = payload;
     // Look up the asset id from its tagNumber first
     const lookup = await request(
       `/asset-catalog/api/equipment?status=Available`, { method: 'GET' }
     ).catch(() => []);
     const items = Array.isArray(lookup) ? lookup : [];
     const asset = items.find(a => a.tagNumber === tagNumber);
     if (!asset) throw Object.assign(new Error(`Equipment tag ${tagNumber} not found or not available.`), { status: 404 });
     const res = await request(`/asset-catalog/${asset.id}/checkout`, {
       method: 'POST',
       body: { operatorId },
     });
     updateActiveOnCheckout({ operatorId, code: tagNumber, kind: 'equipment' });
     return res;
   }

   case 'equipmentReturn': {
     const { operatorId, tagNumber, condition } = payload;
     const lookup = await request(
       `/asset-catalog/api/equipment?status=Checked+Out`, { method: 'GET' }
     ).catch(() => []);
     const items = Array.isArray(lookup) ? lookup : [];
     const asset = items.find(a => a.tagNumber === tagNumber);
     if (!asset) throw Object.assign(new Error(`Equipment tag ${tagNumber} not found or not checked out.`), { status: 404 });
     const res = await request(`/asset-catalog/${asset.id}/checkin`, {
       method: 'POST',
       body: { operatorId, condition: condition || 'Good' },
     });
     updateActiveOnReturn({ operatorId, code: tagNumber, kind: 'equipment' });
    return res;
   }






    case 'suggestion': {
      const { operatorId, category, text, wantsFeedback, imageFile } = payload || {};

      // If image is present, send as multipart/form-data
      if (imageFile) {
        const fd = new FormData();
        fd.append('operatorId', operatorId || '');
        fd.append('category', category || '');
        fd.append('text', text || '');
        fd.append('wantsFeedback', wantsFeedback ? '1' : '0');
        fd.append('image', imageFile, imageFile.name || 'attachment.jpg');

        return requestFirst(
          ['/kiosk/suggestions', '/suggestions'],
          { method: 'POST', body: payload }
        );
      }

      // JSON fallback (no attachment, or queued replay)
      const jsonPayload = {
        operatorId: operatorId || '',
        category:   category   || '',
        text:       text       || '',
        wantsFeedback: !!wantsFeedback,
      };

      return requestFirst(
        ['/kiosk/suggestions', '/suggestions'],
        { method: 'POST', body: jsonPayload }
      );
    }

    case 'ticket': {
      const detailKeys = ['whereArea', 'rowSlot', 'rackRef', 'orderRef', 'deviceLabel'];
      if (payload.imageFile) {
        const fd = new FormData();
        fd.append('operatorId', payload.operatorId);
        fd.append('category', payload.category);
        fd.append('priority', payload.priority);
        fd.append('description', payload.description);
        detailKeys.forEach((k) => {
          const v = payload[k];
          if (v != null && v !== '') fd.append(k, v);
        });
        fd.append('image', payload.imageFile, payload.imageFile.name || 'attachment.jpg');
        return requestFirst(['/kiosk/tickets', '/tickets'], { method: 'POST', body: fd });
      }
      const body = { ...payload };
      delete body.imageFile;
      return requestFirst(['/kiosk/tickets', '/tickets'], { method: 'POST', body });
    }

    case 'inspectionReport':
      return request('/kiosk/inspection-reports', { method: 'POST', body: payload });

    case 'partBorrow': {
      const { operatorId, ...body } = payload || {};
      const res = await request('/kiosk/part-borrows', { method: 'POST', body });
      const b = res?.borrow;
      if (b?.id && operatorId) {
        updateActiveOnCheckout({
          operatorId,
          kind: 'partBorrow',
          borrowId: b.id,
          partSn: b.partSn,
          targetServerSn: b.targetServerSn,
        });
      }
      return res;
    }

    case 'partBorrowReturn': {
      const { operatorId, borrowId, partSn, condition, notes } = payload || {};
      const res = await request('/kiosk/part-borrows/return', {
        method: 'POST',
        body: { borrowId: borrowId || '', partSn: partSn || '', condition, notes: notes || '' },
      });
      const closedId = res?.return?.borrowId || borrowId;
      if (operatorId && closedId) {
        updateActiveOnReturn({ operatorId, kind: 'partBorrow', borrowId: closedId });
      }
      return res;
    }

    default:
      throw new Error(`Unknown job type: ${type}`);
  }
}

/* ---------- Modals ---------- */
function getBackdrop(el) { return el?.closest?.('.modal-backdrop') || null; }
function isOpen(backdrop) {
  return backdrop &&
    backdrop.classList.contains('active') &&
    backdrop.getAttribute('aria-hidden') !== 'true';
}
function show(backdrop) {
  if (!backdrop) return;
  backdrop.classList.add('active');
  backdrop.removeAttribute('aria-hidden');
  backdrop.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const panel = backdrop.querySelector('.modal') || backdrop;
  setTimeout(() => panel.querySelector('input,select,textarea,button')?.focus?.(), 20);
}
function hide(backdrop) {
  if (!backdrop) return;
  backdrop.classList.remove('active');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.style.display = 'none';
  const anyOpen = Array.from(document.querySelectorAll('.modal-backdrop')).some(isOpen);
  if (!anyOpen) document.body.style.overflow = '';
}
function openModalById(id) {
  closeAllModals();
  const el = qs(`#${id}`);
  if (el) show(el);
}
function closeAllModals() {
  qsa('.modal-backdrop').forEach(hide);
}

/* ---------- Idle reset ---------- */
let idleTimer = null;
const IDLE_MS = 60_000;

function poke() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    closeAllModals();
    resetForms();
    notyf.open({ type: 'info', message: 'Session reset for next user' });
  }, IDLE_MS);
}
['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evt =>
  document.addEventListener(evt, poke, { passive: true })
);
poke();

/* ---------- UI wiring ---------- */
const INSPECTION_FOLLOWUP_IDS = [
  'cablesOrganizedFollowup',
  'cablesDamagedFollowup',
  'coversInstalledFollowup',
  'coversUndamagedFollowup',
  'thumbscrewsTightFollowup',
  'screwsInstalledFollowup',
];

function resetInspectionFollowupPanels() {
  INSPECTION_FOLLOWUP_IDS.forEach((id) => {
    const el = qs(`#${id}`);
    if (!el) return;
    el.hidden = true;
    el.classList.remove('is-active');
    qsa('textarea, input[type="text"]', el).forEach((x) => {
      x.value = '';
    });
    qsa('input[type="checkbox"], input[type="radio"]', el).forEach((x) => {
      x.checked = false;
    });
  });
}

function resetForms() {
  qsa('form').forEach((f) => f.reset());
  resetInspectionFollowupPanels();
  qs('#ticketForm')?.querySelectorAll('[data-ticket-key]').forEach((el) => {
    el.value = '';
  });
  qs('#ticketCategorySelect')?.dispatchEvent(new Event('change', { bubbles: true }));
}
function bindModalTriggers() {
  document.addEventListener('click', (e) => {
    const openAttr = e.target.closest?.('[data-modal-open]');
    if (openAttr) {
      e.preventDefault();
      const modalId = openAttr.getAttribute('data-modal-open');
      openModalById(modalId);
      if (modalId === 'inspectionModal') {
        populateInspectionHeader();
        setTimeout(() => qs('#inspectionRackSn')?.focus(), 40);
      }
      if (modalId === 'partBorrowModal') {
        refreshPartBorrowModal();
        setTimeout(() => qs('#pbPurpose')?.focus(), 40);
      }
      return;
    }
    const closeAttr = e.target.closest?.('[data-modal-close]');
    if (closeAttr) {
      e.preventDefault();
      closeAllModals();
      return;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

/* ---------- Queue + My Items MODAL RENDERING ---------- */
function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

async function loadPartBorrowReturnSelect() {
  const sel = qs('#pbReturnBorrowSelect');
  if (!sel) return;
  const op = getLastOperator() || getCurrentOperatorId();
  if (!op) {
    sel.replaceChildren();
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No operator ID in session';
    sel.appendChild(o);
    return;
  }

  sel.replaceChildren();
  const loading = document.createElement('option');
  loading.value = '';
  loading.textContent = 'Loading…';
  sel.appendChild(loading);

  try {
    const data = await request(`/kiosk/my-items?techId=${encodeURIComponent(op)}`, { method: 'GET' });
    const rows = Array.isArray(data?.partBorrows) ? data.partBorrows : [];
    sel.replaceChildren();
    const head = document.createElement('option');
    head.value = '';
    head.textContent = rows.length ? 'Select borrow…' : 'No open borrows';
    sel.appendChild(head);
    for (const b of rows) {
      const o = document.createElement('option');
      o.value = String(b.id || '').trim();
      const since = fmtTime(b.borrowedAt || b.at);
      o.textContent = `${b.partSn || ''} → ${b.targetServerSn || ''} · ${since}`.trim();
      sel.appendChild(o);
    }
  } catch {
    sel.replaceChildren();
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Unable to load — try again';
    sel.appendChild(o);
  }
}

async function refreshPartBorrowModal() {
  const blurb = qs('#partBorrowUserBlurb');
  if (blurb) {
    const tid = getCurrentOperatorId();
    const name = currentUser?.name || currentUser?.id || 'Unknown';
    blurb.textContent = tid
      ? `${name} · Tech ID ${tid} — stamped on borrow/return records.`
      : `${name} — no Tech ID on this login; contact a lead if attribution looks wrong.`;
  }
  await loadPartBorrowReturnSelect();
}

function renderQueueModal() {
  const tbody = qs('#queueTableBody');
  if (!tbody) return;
  const q = readQueue();

  if (!q.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-sm text-gray-500 py-2">
          No queued submissions.
        </td>
      </tr>`;
    return;
  }

  const admin = isQueueAdmin();

  tbody.innerHTML = q.map((job, idx) => {
    const { type, payload, enqueuedAt } = job;
    let code = '';
    let operatorId = payload?.operatorId || '';

    if (type === 'toolCheckout' || type === 'toolReturn') {
      code = payload?.code || '';
    }
    if (type === 'cartCheckout' || type === 'cartReturn') {
      code = payload?.cartId || '';
    }
    if (type === 'inspectionReport') {
      code = payload?.rackSn ? `Rack ${payload.rackSn}` : (payload?.area || '');
      operatorId = payload?.operatorId || '';
    }
    if (type === 'partBorrow') {
      code = payload?.partSn
        ? `${payload.partSn} → ${payload.targetServerSn || ''}`.trim()
        : '';
    }
    if (type === 'partBorrowReturn') {
      code = String(payload?.borrowId || payload?.partSn || '').trim();
    }

    return `
      <tr>
        <td class="py-1 pr-2">${type}</td>
        <td class="py-1 pr-2">${code}</td>
        <td class="py-1 pr-2">${operatorId}</td>
        <td class="py-1 pr-2">
          ${fmtTime(enqueuedAt)}
          ${
            admin
              ? `<button type="button"
                        class="btn btn-xs btn-danger"
                        style="margin-left:0.5rem"
                        data-queue-remove="${idx}">
                   ✕
                 </button>`
              : ''
          }
        </td>
      </tr>
    `;
  }).join('');
}

async function renderMyItemsModal() {
  const emptyEl = qs('#myItemsEmpty');
  const wrapEl = qs('#myItemsTableWrapper');
  const tbody = qs('#myItemsTableBody');
  if (!tbody || !emptyEl || !wrapEl) return;

  const op = getLastOperator() || getCurrentOperatorId();
  if (!op) {
    emptyEl.hidden = false;
    emptyEl.textContent = 'No operator ID recorded yet in this session.';
    wrapEl.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  const opLc = String(op).toLowerCase();
  const localItems = readActive(op).filter((x) => x.status === 'out').map((x) => {
    if (x.kind === 'partBorrow') {
      return {
        type: 'Part borrow',
        identifier: `${x.partSn || ''} → ${x.targetServerSn || ''}`.trim(),
        since: x.since || '',
        dedupe: `partborrow:${String(x.borrowId || '').toLowerCase()}`,
      };
    }
    return {
      type: x.kind === 'cart' ? 'ESD Cart' : (x.kind === 'equipment' ? 'Equipment' : 'Tool'),
      identifier: x.kind === 'cart' ? (x.cartId || '') : (x.code || ''),
      since: x.since || '',
      dedupe: `${x.kind}:${x.kind === 'cart' ? (x.cartId || '') : (x.code || '')}`.toLowerCase(),
    };
  });

  let liveItems = [];
  try {
    const [toolsRes, cartsRes, equipmentRes, myItemsRes] = await Promise.all([
      request(`/tools/api?operatorId=${encodeURIComponent(op)}&status=being+used`, { method: 'GET' }).catch(() => []),
      request('/esd-carts', { method: 'GET' }).catch(() => ({ carts: [] })),
      request('/asset-catalog/api/equipment?status=Checked+Out', { method: 'GET' }).catch(() => []),
      request(`/kiosk/my-items?techId=${encodeURIComponent(op)}`, { method: 'GET' }).catch(() => null),
    ]);

    const tools = (toolsRes?.tools || toolsRes?.items || toolsRes || []).filter((t) =>
      String(t.operatorId || '').toLowerCase() === opLc && String(t.status || '').toLowerCase() === 'being used'
    ).map((t) => ({
      type: 'Tool',
      identifier: t.serialNumber || t.code || '',
      since: t.timestamp || t.updatedAt || '',
      dedupe: `tool:${String(t.serialNumber || t.code || '')}`.toLowerCase(),
    }));

    const carts = (cartsRes?.carts || []).filter((c) =>
      String(c.holder || '').toLowerCase() === opLc && String(c.status || '').toLowerCase() === 'checked_out'
    ).map((c) => ({
      type: 'ESD Cart',
      identifier: c.id || '',
      since: c.updatedAt || '',
      dedupe: `cart:${String(c.id || '')}`.toLowerCase(),
    }));

    const equipment = (Array.isArray(equipmentRes) ? equipmentRes : []).filter((asset) =>
      String(asset.checkedOutBy || '').toLowerCase() === opLc && String(asset.status || '').toLowerCase() === 'checked out'
    ).map((asset) => ({
      type: 'Equipment',
      identifier: asset.tagNumber || asset.name || '',
      since: asset.checkedOutAt || asset.updatedAt || '',
      dedupe: `equipment:${String(asset.tagNumber || asset.name || '')}`.toLowerCase(),
    }));

    const serverPartBorrows = (myItemsRes?.partBorrows || []).map((b) => ({
      type: 'Part borrow',
      identifier: `${b.partSn || ''} → ${b.targetServerSn || ''}`.trim(),
      since: b.borrowedAt || b.at || '',
      dedupe: `partborrow:${String(b.id || '').toLowerCase()}`,
    }));

    liveItems = [...tools, ...carts, ...equipment, ...serverPartBorrows];
  } catch {
    liveItems = [];
  }

  const itemMap = new Map();
  [...liveItems, ...localItems].forEach((item) => {
    if (!item?.dedupe) return;
    if (!itemMap.has(item.dedupe)) itemMap.set(item.dedupe, item);
  });
  const items = [...itemMap.values()];

  if (!items.length) {
    emptyEl.hidden = false;
    emptyEl.textContent = `No active checkouts recorded for Tech ID ${op}.`;
    wrapEl.style.display = 'none';
    tbody.innerHTML = '';
    return;
  }

  emptyEl.hidden = true;
  wrapEl.style.display = 'block';
  tbody.innerHTML = items.map(x => `
    <tr>
      <td class="py-1 pr-2">${x.type || 'Item'}</td>
      <td class="py-1 pr-2">${x.identifier || ''}</td>
      <td class="py-1 pr-2">${fmtTime(x.since)}</td>
    </tr>
  `).join('');
}
function wireQueueModal() {
  const badge   = qs('#queueBadge');
  const tbody   = qs('#queueTableBody');
  const clearBtn = qs('#clearQueueBtn');

  // Row-level delete (event delegation)
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-queue-remove]');
      if (!btn) return;

      const idx = Number(btn.getAttribute('data-queue-remove'));
      const q = readQueue();

      if (!Number.isNaN(idx) && q[idx]) {
        q.splice(idx, 1);
        writeQueue(q);
        renderQueueModal();
        notyf.success('Queued item removed.');
      }
    });
  }

  // Clear-all button (admin only)
  if (clearBtn) {
    if (!isQueueAdmin()) {
      // Hide button for non-admin users
      clearBtn.style.display = 'none';
    } else {
      clearBtn.addEventListener('click', () => {
        writeQueue([]);
        renderQueueModal();
        notyf.success('Queue cleared.');
      });
    }
  }

  // Open modal from badge
  if (!badge) return;
  const open = () => {
    renderQueueModal();
    openModalById('queueModal');
  };
  badge.addEventListener('click', open);
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
}


function wireMyItemsModal() {
  const btn = qs('#myItemsBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await renderMyItemsModal();
    openModalById('myItemsModal');
  });
}

/* ---------- Tool Checkout ---------- */
function bindToolCheckout() {
  const form = qs('#toolCheckoutForm');
  if (!form) return;

  const codeInput = form.code;
  const errEl = qs('#coError');
  const imgEl = qs('#coPreviewImg');
  const textEl = qs('#coPreviewText');
  const prevWrap = qs('#coPreview');

  async function onBlur() {
    const code = codeInput.value.trim();
    clearInvalid(codeInput, errEl);
    prevWrap.hidden = true;
    if (!code) return;
    const { known } = await validateKnownTool(code);
    if (!known) {
      setInvalid(codeInput, errEl, 'Unknown tool/serial — must exist in Asset Catalog or tools.json');
      return;
    }
    showPreview(imgEl, textEl, code);
  }
  codeInput.addEventListener('blur', onBlur);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const operatorId = getCurrentOperatorId();
    const code = codeInput.value.trim();
    const qty = 1;
    const sixSOperator = '';

    if (!operatorId || !code) {
      notyf.error('Unable to determine Tech ID or Code.');
      return;
    }

    setLastOperator(operatorId);

    const { known } = await validateKnownTool(code);
    if (!known) {
      setInvalid(codeInput, errEl, 'Unknown tool/serial — cannot checkout');
      return;
    }

    const job = { type: 'toolCheckout', payload: { operatorId, code, qty, sixSOperator } };
    try {
      await dispatchJob(job);
      notyf.success(`Checked out ${qty} • ${code}`);
      closeAllModals();
      resetForms();
    } catch (err) {
      if (err && err.status === 409) {
        notyf.error(err.message || 'Tool is already checked out / in use.');
        return;
      }
      if (err && err.status === 403) {
        notyf.error('You do not have permission to checkout this tool.');
        return;
      }
      enqueue(job);
      notyf.error('Offline or error — queued.');
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

/* ---------- Tool Return ---------- */
function bindToolReturn() {
  const form = qs('#toolReturnForm');
  if (!form) return;

  const codeInput = form.code;
  const errEl = qs('#riError');
  const imgEl = qs('#riPreviewImg');
  const textEl = qs('#riPreviewText');
  const prevWrap = qs('#riPreview');

  async function onBlur() {
    const code = codeInput.value.trim();
    clearInvalid(codeInput, errEl);
    prevWrap.hidden = true;
    if (!code) return;
    const { known } = await validateKnownTool(code);
    if (!known) {
      setInvalid(codeInput, errEl, 'Unknown tool/serial — must exist in Asset Catalog or tools.json');
      return;
    }
    showPreview(imgEl, textEl, code);
  }
  codeInput.addEventListener('blur', onBlur);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const operatorId = getCurrentOperatorId();
    const code = codeInput.value.trim();
    const qty = 1;

    if (!operatorId || !code) {
      notyf.error('Unable to determine Tech ID or Code.');
      return;
    }

    setLastOperator(operatorId);

    const { known } = await validateKnownTool(code);
    if (!known) {
      setInvalid(codeInput, errEl, 'Unknown tool/serial — cannot return');
      return;
    }

    const job = { type: 'toolReturn', payload: { operatorId, code, qty } };
    try {
      await dispatchJob(job);
      notyf.success(`Returned ${qty} • ${code}`);
      closeAllModals();
      resetForms();
    } catch (err) {
      if (err && err.status === 409) {
        notyf.error(err.message || 'Tool does not appear to be checked out.');
        return;
      }
      if (err && err.status === 403) {
        notyf.error('You do not have permission to return this tool.');
        return;
      }
      enqueue(job);
      notyf.error('Offline or error — queued.');
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

/* ---------- Cart Checkout/Return ---------- */
function bindCartCheckout() {
  const form = qs('#cartCheckoutForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cartId = form.cartId.value.trim();
    const operatorId = getCurrentOperatorId();

    if (!operatorId || !cartId) {
      notyf.error('Unable to determine Tech ID or Cart ID.');
      return;
    }

    setLastOperator(operatorId);

    const job = { type: 'cartCheckout', payload: { operatorId, cartId } };
    try {
      await dispatchJob(job);
      notyf.success(`Cart ${cartId} checked out`);
      closeAllModals();
      resetForms();
    } catch (err) {
      if (err && err.status === 409) {
        notyf.error(err.message || 'Cart is already checked out.');
        return;
      }
      if (err && err.status === 400) {
        notyf.error(err.message || 'Unable to checkout cart (invalid input).');
        return;
      }
      enqueue(job);
      notyf.error('Offline or error — queued.');
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

function bindCartReturn() {
  const form = qs('#cartReturnForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cartId = form.cartId.value.trim();
    const operatorId = getCurrentOperatorId();

    if (!operatorId || !cartId) {
      notyf.error('Unable to determine Tech ID or Cart ID.');
      return;
    }

    setLastOperator(operatorId);

    const job = { type: 'cartReturn', payload: { operatorId, cartId } };
    try {
      await dispatchJob(job);
      notyf.success(`Cart ${cartId} returned`);
      closeAllModals();
      resetForms();
    } catch (err) {
      if (err && err.status === 400) {
        notyf.error(err.message || 'Unable to return cart (invalid input).');
        return;
      }
      enqueue(job);
      notyf.error('Offline or error — queued.');
    }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}

function bindEquipmentCheckout() {
     // Tab switching
     document.querySelectorAll('.eq-tab').forEach(btn => {
       btn.addEventListener('click', () => {
         document.querySelectorAll('.eq-tab').forEach(b => b.classList.remove('active'));
         btn.classList.add('active');
         const tab = btn.dataset.eqTab;
         const co = document.getElementById('eqCheckoutPane');
         const ret = document.getElementById('eqReturnPane');
         if (co) co.style.display = tab === 'checkout' ? '' : 'none';
         if (ret) ret.style.display = tab === 'return' ? '' : 'none';
       });
     });

     // Checkout form
     const coForm = document.getElementById('equipmentCheckoutForm');
     if (coForm) {
       coForm.addEventListener('submit', async (e) => {
         e.preventDefault();
         const tagNumber = document.getElementById('eqCheckoutTag')?.value?.trim();
         const operatorId = getCurrentOperatorId();
         if (!operatorId || !tagNumber) {
           notyf.error('Tech ID and equipment tag are required.');
           return;
         }
         setLastOperator(operatorId);
         const job = { type: 'equipmentCheckout', payload: { operatorId, tagNumber } };
         try {
           await dispatchJob(job);
           notyf.success(`${tagNumber} checked out`);
           closeAllModals();
           resetForms();
         } catch (err) {
           if (err?.status === 409) { notyf.error(err.message || 'Equipment already checked out.'); return; }
           if (err?.status === 404) { notyf.error(err.message || 'Equipment tag not found.'); return; }
           enqueue(job);
           notyf.error('Offline or error — queued.');
         }
       });
     }

     // Return form
     const retForm = document.getElementById('equipmentReturnForm');
     if (retForm) {
       retForm.addEventListener('submit', async (e) => {
         e.preventDefault();
         const tagNumber  = document.getElementById('eqReturnTag')?.value?.trim();
         const condition  = document.getElementById('eqReturnCondition')?.value || 'Good';
         const operatorId = getCurrentOperatorId();
         if (!operatorId || !tagNumber) {
           notyf.error('Tech ID and equipment tag are required.');
           return;
         }
         setLastOperator(operatorId);
         const job = { type: 'equipmentReturn', payload: { operatorId, tagNumber, condition } };
         try {
           await dispatchJob(job);
           notyf.success(`${tagNumber} returned (${condition})`);
           closeAllModals();
           resetForms();
         } catch (err) {
         if (err?.status === 404) { notyf.error(err.message || 'Equipment tag not found or not checked out.'); return; }
           enqueue(job);
           notyf.error('Offline or error — queued.');
         }
       });
     }
   }

function bindPartBorrow() {
  document.querySelectorAll('.pb-tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.pb-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.pbTab;
      const borrowPane = qs('#pbBorrowPane');
      const retPane = qs('#pbReturnPane');
      if (borrowPane) borrowPane.style.display = tab === 'borrow' ? '' : 'none';
      if (retPane) retPane.style.display = tab === 'return' ? '' : 'none';
      if (tab === 'return') await loadPartBorrowReturnSelect();
    });
  });

  const bForm = qs('#partBorrowForm');
  if (bForm) {
    bForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const operatorId = getCurrentOperatorId();
      if (!operatorId) {
        notyf.error('No Tech ID — log in with an employee-linked account.');
        return;
      }
      setLastOperator(operatorId);
      const purpose = qs('#pbPurpose')?.value;
      const targetServerSn = qs('#pbTargetServer')?.value?.trim();
      const donorServerSn = qs('#pbDonorServer')?.value?.trim() || '';
      const partSn = qs('#pbPartSn')?.value?.trim();
      const notes = qs('#pbNotes')?.value?.trim() || '';
      const hoursRaw = qs('#pbExpectedHours')?.value;
      const expectedReturnHours = hoursRaw ? Number(hoursRaw) : null;

      if (!targetServerSn || !partSn) {
        notyf.error('Target server and part serial are required.');
        return;
      }

      const body = {
        targetServerSn,
        donorServerSn,
        partSn,
        purpose,
        notes,
        expectedReturnHours: Number.isFinite(expectedReturnHours) ? expectedReturnHours : null,
      };
      const job = { type: 'partBorrow', payload: { operatorId, ...body } };
      try {
        await dispatchJob(job);
        notyf.success(`Borrow logged · ${partSn}`);
        closeAllModals();
        resetForms();
      } catch (err) {
        if (err?.status === 409) {
          notyf.error(err.message || 'Part already borrowed.');
          return;
        }
        if (err?.status === 400) {
          notyf.error(err.message || 'Check required fields.');
          return;
        }
        enqueue(job);
        notyf.error('Offline or error — borrow queued.');
      }
    });
  }

  const rForm = qs('#partReturnForm');
  if (rForm) {
    rForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const operatorId = getCurrentOperatorId();
      if (!operatorId) {
        notyf.error('No Tech ID — log in with an employee-linked account.');
        return;
      }
      setLastOperator(operatorId);
      const borrowId = qs('#pbReturnBorrowSelect')?.value?.trim() || '';
      const partSn = qs('#pbReturnPartSn')?.value?.trim() || '';
      const condition = qs('#pbReturnCondition')?.value || 'Good';
      const notes = qs('#pbReturnNotes')?.value?.trim() || '';

      if (!borrowId && !partSn) {
        notyf.error('Pick your borrow from the list or type the part serial.');
        return;
      }

      const job = {
        type: 'partBorrowReturn',
        payload: { operatorId, borrowId, partSn, condition, notes },
      };
      try {
        await dispatchJob(job);
        notyf.success('Return logged.');
        closeAllModals();
        resetForms();
      } catch (err) {
        if (err?.status === 404 || err?.status === 403 || err?.status === 409) {
          notyf.error(err.message || 'Unable to complete return.');
          return;
        }
        enqueue(job);
        notyf.error('Offline or error — return queued.');
      }
    });
  }
}


function bindSuggestion() {
  const form = qs('#suggestForm');
  if (!form) return;

  // The kiosk suggestion form uses `title` (required) + `body` (optional details).
  // The server's suggestionSchema expects a single `text` field, so we combine
  // the two client-side. Fall back to legacy `text` input if the markup ever
  // reverts to the old single-field layout.
  const titleEl         = form.title || form.querySelector('[name="title"]');
  const bodyEl          = form.body  || form.querySelector('[name="body"]');
  const legacyTextEl    = form.text  || form.querySelector('[name="text"]');
  const categoryEl      = form.category;
  const severityEl      = form.severity || form.querySelector('[name="severity"]');
  const locationEl      = form.location || form.querySelector('[name="location"]');
  const wantFollowUpEl  = form.wantFollowUp || form.querySelector('[name="wantFollowUp"]');
  const contactMethodEl = form.contactMethod || form.querySelector('[name="contactMethod"]');
  const anonymousEl     = form.anonymous || form.querySelector('[name="anonymous"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = (titleEl?.value || '').trim();
    const body  = (bodyEl?.value  || '').trim();
    const legacy = (legacyTextEl?.value || '').trim();

    // Build the combined text payload. Prefer the new title+body layout; fall
    // back to the legacy single text field if that's all the markup has.
    const text = title
      ? (body ? `${title}\n\n${body}` : title)
      : legacy;

    if (!text) {
      notyf.error('Please enter a suggestion title.');
      titleEl?.focus();
      return;
    }

    const category      = (categoryEl?.value || '').trim();
    const severity      = (severityEl?.value || '').trim();
    const location      = (locationEl?.value || '').trim();
    const wantFollowUp  = !!(wantFollowUpEl && wantFollowUpEl.checked);
    const anonymous     = !!(anonymousEl && anonymousEl.checked);
    const contactMethod = (contactMethodEl?.value || '').trim();

    const job = {
      type: 'suggestion',
      payload: {
        // server expects these keys:
        text,
        category,
        severity,
        location,
        wantFollowUp,
        anonymous,
        contactMethod,
        // Sent for future-proofing / richer server-side storage. Current
        // server schema ignores them via allowUnknown:true, so this is a
        // no-op until the server opts in to structured title/body fields.
        title,
        body,
      },
    };

    try {
      await dispatchJob(job);
      notyf.success('Thanks! Suggestion received.');
      closeAllModals();
      resetForms();
    } catch (err) {
      enqueue(job);
      console.error('Suggestion submit failed; queued instead:', err);
      notyf.error('Offline or error — suggestion queued.');
    }
  });
}

/* Ticket */
const TICKET_CATEGORY_BLURBS = {
  Materials:
    'Request parts or consumables. Row/slot, rack, and order/WO help Materials fulfill without extra messages.',
  Equipment:
    'Request tools, fixtures, or equipment-related stock. Use row/slot and order # when they apply.',
  Facilities:
    'Leaks, lighting, HVAC, or power concerns — say where to send facilities (room, bay, panel).',
  IT: 'Workstation, laptop, dock, monitor, or accessory issues — not production rack hardware.',
  Safety: 'Unsafe condition or near-miss — include the exact location.',
  Other: 'Use when nothing else fits. Add any refs that help triage.',
};

function readTicketDetailField(form, key) {
  const panel = form.querySelector('.ticket-cat-panel:not([hidden])');
  const el = panel?.querySelector(`[data-ticket-key="${key}"]`);
  return (el?.value || '').trim();
}

function syncTicketCategoryPanels() {
  const form = qs('#ticketForm');
  const blurb = qs('#ticketCategoryBlurb');
  const sel = qs('#ticketCategorySelect');
  if (!form || !sel) return;
  const cat = (sel.value || '').trim();
  if (blurb) blurb.textContent = TICKET_CATEGORY_BLURBS[cat] || '';

  qsa('.ticket-cat-panel', form).forEach((panel) => {
    const cats = (panel.getAttribute('data-ticket-cats') || '')
      .split(/\s+/)
      .filter(Boolean);
    panel.hidden = !cats.includes(cat);
  });
}

function bindTicket() {
  const form = qs('#ticketForm');
  if (!form) return;

  const techLabel = qs('#ticketTechIdLabel');
  const techIdForBanner = (currentUser?.techId || currentUser?.id || '').trim();
  if (techLabel) {
    techLabel.textContent = techIdForBanner || 'Unknown';
  }

  const catSel = qs('#ticketCategorySelect');
  let lastTicketCategory = (catSel?.value || '').trim();

  catSel?.addEventListener('change', () => {
    const next = (catSel.value || '').trim();
    if (next !== lastTicketCategory) {
      form.querySelectorAll('[data-ticket-key]').forEach((el) => {
        el.value = '';
      });
      lastTicketCategory = next;
    }
    syncTicketCategoryPanels();
  });
  syncTicketCategoryPanels();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const operatorId = (currentUser?.techId || currentUser?.id || '').trim();
    const category = (form.category.value || '').trim();
    const priority = (form.priority.value || '').trim() || 'Normal';
    const title = (form.title?.value || form.querySelector('[name="title"]')?.value || '').trim();
    const descBody = (form.description.value || '').trim();
    const description = title ? (descBody ? `${title}\n\n${descBody}` : title) : descBody;

    const whereArea = readTicketDetailField(form, 'whereArea');
    const rowSlot = readTicketDetailField(form, 'rowSlot');
    const rackRef = readTicketDetailField(form, 'rackRef');
    const orderRef = readTicketDetailField(form, 'orderRef');
    const deviceLabel = readTicketDetailField(form, 'deviceLabel');

    const imageFile = form.image?.files?.[0] || null;

    if (!operatorId) {
      notyf.error('No Tech ID is linked to this login. Please contact your supervisor or admin.');
      return;
    }

    if (!description) {
      notyf.error('Title or details are required.');
      return;
    }

    setLastOperator(operatorId);

    const job = {
      type: 'ticket',
      payload: {
        operatorId,
        category,
        priority,
        description,
        whereArea,
        rowSlot,
        rackRef,
        orderRef,
        deviceLabel,
        imageFile,
      },
    };

    try {
      const res = await dispatchJob(job);

      const ref =
        res?.ticketNumber ||
        res?.ticketId ||
        res?.reference ||
        res?.ticket?.id;
      const taskId = res?.taskId || res?.task?.id;

      if (taskId) {
        notyf.success(`Ticket logged. Find the card on Projects (search: ${taskId})`);
      } else if (ref) {
        notyf.success(`Ticket submitted (Ref: ${ref})`);
      } else {
        notyf.success('Ticket submitted.');
      }

      closeAllModals();
      resetForms();
    } catch {
      const queuedPayload = {
        operatorId,
        category,
        priority,
        description,
        title,
        whereArea,
        rowSlot,
        rackRef,
        orderRef,
        deviceLabel,
      };
      enqueue({ type: 'ticket', payload: queuedPayload });
      notyf.error('Offline or error — ticket queued (without attachment).');
    }
  });
}

function checkedValues(name, root = document) {
  return qsa(`input[name="${name}"]:checked`, root).map((el) => el.value);
}

function toggleInspectionFollowup(name, followupId, shouldShow) {
  const followup = qs(`#${followupId}`);
  if (!followup) return;
  followup.hidden = !shouldShow;
  followup.classList.toggle('is-active', shouldShow);
  if (!shouldShow) {
    qsa('textarea, input[type="text"]', followup).forEach((el) => {
      el.value = '';
    });
    qsa('input[type="checkbox"], input[type="radio"]', followup).forEach((el) => {
      el.checked = false;
    });
  }
}

let inspectionRackLookupToken = 0;
let inspectionRackLookupTimer = null;

function populateInspectionHeader() {
  const techEl = qs('#inspectionTechId');
  const shiftEl = qs('#inspectionShift');
  const hintEl = qs('#inspectionHint');
  const rackHint = qs('#inspectionRackSnHint');
  const checklistStep = qs('#inspectionStepChecklist');
  const backBtn = qs('#inspectionBackBtn');
  const metaPane = qs('#inspectionPaneMeta');
  const checklistPane = qs('#inspectionPaneChecklist');
  const metaStep = qs('#inspectionStepMeta');
  const metaRest = qs('#inspectionMetaRest');
  const stageEl = qs('#inspectionStage');
  const rackInput = qs('#inspectionRackSn');

  inspectionRackLookupToken++;
  if (inspectionRackLookupTimer) clearTimeout(inspectionRackLookupTimer);
  if (metaRest) metaRest.disabled = true;
  if (stageEl) {
    stageEl.innerHTML = '<option value="">—</option>';
    stageEl.disabled = false;
  }
  if (rackInput) rackInput.value = '';
  if (rackHint) {
    rackHint.textContent =
      'Enter the 12-digit rack serial first. Remaining rack fields unlock after the SN is recognized.';
    rackHint.classList.remove('error');
  }

  resetInspectionFollowupPanels();
  if (metaPane) metaPane.hidden = false;
  if (checklistPane) checklistPane.hidden = true;
  if (metaStep) {
    metaStep.classList.add('active');
    metaStep.setAttribute('aria-selected', 'true');
  }
  if (checklistStep) {
    checklistStep.classList.remove('active');
    checklistStep.setAttribute('aria-selected', 'false');
    checklistStep.disabled = true;
  }
  if (backBtn) backBtn.hidden = true;
  const op = getCurrentOperatorId() || '';
  if (techEl) techEl.textContent = op || '—';
  if (shiftEl) shiftEl.textContent = currentUserShift ? `Shift ${currentUserShift}` : '—';
  if (hintEl) {
    hintEl.textContent = currentUserShift
      ? `Shift ${currentUserShift} captured from your technician profile.`
      : 'Shift could not be resolved from your technician profile yet. Please update your employee record before submitting.';
  }
}

function scheduleInspectionRackLookup() {
  if (inspectionRackLookupTimer) clearTimeout(inspectionRackLookupTimer);
  const scheduledToken = inspectionRackLookupToken;
  inspectionRackLookupTimer = setTimeout(() => {
    if (scheduledToken !== inspectionRackLookupToken) return;
    void runInspectionRackLookup(scheduledToken);
  }, 450);
}

async function runInspectionRackLookup(expectedToken) {
  const rackInput = qs('#inspectionRackSn');
  const metaRest = qs('#inspectionMetaRest');
  const hint = qs('#inspectionRackSnHint');
  const stageEl = qs('#inspectionStage');
  if (!rackInput || !metaRest) return;

  if (expectedToken !== inspectionRackLookupToken) return;

  const raw = rackInput.value.trim();
  if (!raw) {
    metaRest.disabled = true;
    if (stageEl) stageEl.innerHTML = '<option value="">—</option>';
    if (hint) {
      hint.textContent =
        'Enter the 12-digit rack serial first. Remaining rack fields unlock after the SN is recognized.';
      hint.classList.remove('error');
    }
    refreshInspectionStepGate();
    return;
  }

  if (!/^\d*$/.test(raw)) {
    metaRest.disabled = true;
    if (stageEl) stageEl.innerHTML = '<option value="">—</option>';
    if (hint) {
      hint.textContent = 'Rack SN must contain only digits (12 total).';
      hint.classList.add('error');
    }
    refreshInspectionStepGate();
    return;
  }

  if (raw.length < 12) {
    metaRest.disabled = true;
    if (stageEl) stageEl.innerHTML = '<option value="">—</option>';
    if (hint) {
      hint.textContent = `Enter 12 digits (${raw.length}/12).`;
      hint.classList.remove('error');
    }
    refreshInspectionStepGate();
    return;
  }

  if (hint) {
    hint.textContent = 'Checking rack history…';
    hint.classList.remove('error');
  }

  try {
    const data = await request(`/kiosk/inspection-rack/${encodeURIComponent(raw)}/initial-status`);
    if (expectedToken !== inspectionRackLookupToken) return;

    const hasInitial = !!data?.hasInitialInspection;
    if (!stageEl) return;

    stageEl.innerHTML = '';
    if (!hasInitial) {
      const o = document.createElement('option');
      o.value = 'Initial Inspection';
      o.textContent = 'Initial Inspection';
      stageEl.appendChild(o);
      stageEl.value = 'Initial Inspection';
      stageEl.disabled = true;
      if (hint) {
        hint.textContent = 'First inspection for this rack — stage is set to Initial Inspection.';
        hint.classList.remove('error');
      }
    } else {
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'Select stage';
      stageEl.appendChild(ph);
      ['New assignment', 'Start of shift', 'Completed rack'].forEach((t) => {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        stageEl.appendChild(o);
      });
      stageEl.disabled = false;
      stageEl.value = '';
      if (hint) {
        hint.textContent =
          'This rack already has an initial inspection — choose the inspection stage.';
        hint.classList.remove('error');
      }
    }

    metaRest.disabled = false;
    refreshInspectionStepGate();
  } catch (e) {
    if (expectedToken !== inspectionRackLookupToken) return;
    metaRest.disabled = true;
    if (stageEl) stageEl.innerHTML = '<option value="">—</option>';
    if (hint) {
      hint.textContent = e?.message || 'Could not verify rack status. Try again.';
      hint.classList.add('error');
    }
    refreshInspectionStepGate();
  }
}

function inspectionMetaValues() {
  return {
    operatorId: getCurrentOperatorId(),
    shift: currentUserShift,
    area: qs('#inspectionArea')?.value || '',
    stage: qs('#inspectionStage')?.value || '',
    index: (qs('#inspectionIndex')?.value || '').trim(),
    rackSn: (qs('#inspectionRackSn')?.value || '').trim(),
    rackModel: qs('#inspectionRackModel')?.value || '',
  };
}

function validateInspectionMeta({ notify = false } = {}) {
  const values = inspectionMetaValues();
  let message = '';
  const metaRest = qs('#inspectionMetaRest');

  if (!values.operatorId) message = 'No Tech ID is linked to this login.';
  else if (!values.shift) message = 'Shift is required and could not be captured from your technician profile.';
  else if (!values.rackSn || !/^\d{12}$/.test(values.rackSn)) message = 'Rack SN must be exactly 12 digits.';
  else if (metaRest?.disabled) message = 'Wait for rack details to unlock after entering the rack SN.';
  else if (!values.area || !values.stage || !values.index || !values.rackModel) message = 'Complete all rack detail fields first.';

  const metaHint = qs('#inspectionMetaHint');
  if (metaHint) {
    metaHint.textContent = message || 'Rack details complete. Continue to the checklist.';
    metaHint.classList.toggle('error', !!message);
  }

  if (notify && message) notyf.error(message);
  return { ok: !message, values };
}

function refreshInspectionStepGate() {
  const checklistStep = qs('#inspectionStepChecklist');
  if (!checklistStep) return false;
  const { ok } = validateInspectionMeta();
  checklistStep.disabled = !ok;
  return ok;
}

function setInspectionStep(step) {
  const metaPane = qs('#inspectionPaneMeta');
  const checklistPane = qs('#inspectionPaneChecklist');
  const metaStep = qs('#inspectionStepMeta');
  const checklistStep = qs('#inspectionStepChecklist');
  const backBtn = qs('#inspectionBackBtn');
  const submitBtn = qs('#inspectionSubmitBtn');

  const showChecklist = step === 'checklist';
  if (metaPane) metaPane.hidden = showChecklist;
  if (checklistPane) checklistPane.hidden = !showChecklist;
  if (backBtn) backBtn.hidden = !showChecklist;
  if (submitBtn) submitBtn.hidden = !showChecklist;
  if (metaStep) {
    metaStep.classList.toggle('active', !showChecklist);
    metaStep.setAttribute('aria-selected', showChecklist ? 'false' : 'true');
  }
  if (checklistStep) {
    checklistStep.classList.toggle('active', showChecklist);
    checklistStep.setAttribute('aria-selected', showChecklist ? 'true' : 'false');
  }
}

function bindInspectionReport() {
  const form = qs('#inspectionForm');
  if (!form) return;
  const nextBtn = qs('#inspectionNextBtn');
  const backBtn = qs('#inspectionBackBtn');
  const checklistStep = qs('#inspectionStepChecklist');
  const metaFields = ['#inspectionArea', '#inspectionStage', '#inspectionIndex', '#inspectionRackModel'];

  const followupRules = [
    { name: 'cablesOrganized', value: 'no', followupId: 'cablesOrganizedFollowup' },
    { name: 'cablesUndamaged', value: 'no', followupId: 'cablesDamagedFollowup' },
    { name: 'coversInstalled', value: 'no', followupId: 'coversInstalledFollowup' },
    { name: 'coversUndamaged', value: 'no', followupId: 'coversUndamagedFollowup' },
    { name: 'thumbscrewsTight', value: 'no', followupId: 'thumbscrewsTightFollowup' },
    { name: 'screwsInstalled', value: 'no', followupId: 'screwsInstalledFollowup' },
  ];

  followupRules.forEach(({ name, value, followupId, invert }) => {
    qsa(`input[name="${name}"]`, form).forEach((input) => {
      input.addEventListener('change', () => {
        const selected = form.querySelector(`input[name="${name}"]:checked`)?.value || '';
        const show = invert ? selected !== value : selected === value;
        toggleInspectionFollowup(name, followupId, show);
      });
    });
  });

  qs('#inspectionRackSn')?.addEventListener('input', () => {
    inspectionRackLookupToken++;
    const mr = qs('#inspectionMetaRest');
    if (mr) mr.disabled = true;
    scheduleInspectionRackLookup();
    refreshInspectionStepGate();
  });

  function refreshMetaState() {
    return refreshInspectionStepGate();
  }

  metaFields.forEach((selector) => {
    const el = qs(selector);
    if (!el) return;
    el.addEventListener('input', refreshMetaState);
    el.addEventListener('change', refreshMetaState);
  });

  nextBtn?.addEventListener('click', () => {
    const { ok } = validateInspectionMeta({ notify: true });
    if (!ok) return;
    if (checklistStep) checklistStep.disabled = false;
    setInspectionStep('checklist');
  });

  backBtn?.addEventListener('click', () => {
    setInspectionStep('meta');
  });

  qs('#inspectionStepMeta')?.addEventListener('click', () => {
    setInspectionStep('meta');
  });

  checklistStep?.addEventListener('click', () => {
    const { ok } = validateInspectionMeta({ notify: true });
    if (!ok) return;
    checklistStep.disabled = false;
    setInspectionStep('checklist');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const meta = validateInspectionMeta({ notify: true });
    if (!meta.ok) {
      setInspectionStep('meta');
      return;
    }
    const { operatorId, shift, area, stage, index, rackSn, rackModel } = meta.values;

    const cablesOrganized = form.querySelector('input[name="cablesOrganized"]:checked')?.value || '';
    const cablesUndamaged = form.querySelector('input[name="cablesUndamaged"]:checked')?.value || '';
    const coversInstalled = form.querySelector('input[name="coversInstalled"]:checked')?.value || '';
    const coversUndamaged = form.querySelector('input[name="coversUndamaged"]:checked')?.value || '';
    const thumbscrewsTight = form.querySelector('input[name="thumbscrewsTight"]:checked')?.value || '';
    const screwsInstalled = form.querySelector('input[name="screwsInstalled"]:checked')?.value || '';

    if (!cablesOrganized || !cablesUndamaged || !coversInstalled || !coversUndamaged || !thumbscrewsTight || !screwsInstalled) {
      notyf.error('Please complete the inspection checklist before submitting.');
      setInspectionStep('checklist');
      return;
    }

    const looseCablePositions = (qs('#looseCablePositions')?.value || '').trim();
    const looseCableTypes = checkedValues('looseCableTypes', form);
    const damagedCablePositions = (qs('#damagedCablePositions')?.value || '').trim();
    const damagedCableTypes = checkedValues('damagedCableTypes', form);
    const incorrectCoverPositions = (qs('#incorrectCoverPositions')?.value || '').trim();
    const damagedCoverPositions = (qs('#damagedCoverPositions')?.value || '').trim();
    const looseThumbscrewPositions = (qs('#looseThumbscrewPositions')?.value || '').trim();
    const missingScrewPositions = (qs('#missingScrewPositions')?.value || '').trim();
    const otherIssues = (qs('#inspectionOtherIssues')?.value || '').trim();

    if (cablesOrganized === 'no' && (!looseCablePositions || !looseCableTypes.length)) {
      notyf.error('Enter loose cable positions and select the cable types involved.');
      return;
    }
    if (cablesUndamaged === 'no' && (!damagedCablePositions || !damagedCableTypes.length)) {
      notyf.error('Enter damaged cable positions and select the cable types involved.');
      return;
    }
    if (coversInstalled === 'no' && !incorrectCoverPositions) {
      notyf.error('Enter the positions with incorrectly installed covers.');
      return;
    }
    if (coversUndamaged === 'no' && !damagedCoverPositions) {
      notyf.error('Enter the positions with damaged covers.');
      return;
    }
    if (thumbscrewsTight === 'no' && !looseThumbscrewPositions) {
      notyf.error('Enter the positions with loose thumb screws.');
      return;
    }
    if (screwsInstalled !== 'yes' && !missingScrewPositions) {
      notyf.error('Enter the positions with missing screws.');
      return;
    }

    setLastOperator(operatorId);

    const job = {
      type: 'inspectionReport',
      payload: {
        operatorId,
        shift,
        area,
        stage,
        index,
        rackSn,
        rackModel,
        responses: {
          cablesOrganized,
          looseCablePositions,
          looseCableTypes,
          cablesUndamaged,
          damagedCablePositions,
          damagedCableTypes,
          coversInstalled,
          incorrectCoverPositions,
          coversUndamaged,
          damagedCoverPositions,
          thumbscrewsTight,
          looseThumbscrewPositions,
          screwsInstalled,
          missingScrewPositions,
          otherIssues,
        },
      }
    };

    try {
      await dispatchJob(job);
      notyf.success('Inspection report submitted.');
      closeAllModals();
      resetForms();
      populateInspectionHeader();
      refreshMetaState();
    } catch (err) {
      enqueue(job);
      console.error('Inspection report submit failed; queued instead:', err);
      notyf.error('Offline or error ? inspection report queued.');
    }
  });

  refreshMetaState();
}

/* ---------- Clock + network ---------- */
function startClock() {
  const el = qs('#clock');
  if (!el) return;
  const tick = () => {
    const d = new Date();
    el.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10_000);
}
function wireNetStatus() {
  const el = qs('#netStatus');
  if (!el) return;
  const set = () => {
    const online = navigator.onLine;
    el.textContent = online ? 'Online' : 'Offline';
    el.classList.toggle('online', online);
    el.classList.toggle('offline', !online);
    if (online) drainQueue();
  };
  window.addEventListener('online', set);
  window.addEventListener('offline', set);
  set();

  // Periodic retry: attempt to drain every 90 seconds while the page is open.
  // Covers the case where the network recovers but no 'online' event fires
  // (common on flaky Wi-Fi or when the server briefly restarts).
  setInterval(() => {
    if (navigator.onLine) drainQueue().catch(() => {});
  }, 90_000);
}

/* ---------- End session button ---------- */
function wireEndSession() {
  const btn = qs('#endSessionBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    closeAllModals();
    resetForms();
    setLastOperator('');
    notyf.open({ type: 'info', message: 'Session cleared' });
  });
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  await fetchCurrentUser();       // get current user + update banner first

  bindModalTriggers();
  bindToolCheckout();
  bindToolReturn();
  bindCartCheckout();
  bindCartReturn();
  bindSuggestion();
  bindTicket();
  bindInspectionReport();
  populateInspectionHeader();

  wireEndSession();
  startClock();
  wireNetStatus();
  updateQueueBadge();
  drainQueue();
  wireQueueModal();
  wireMyItemsModal();
  bindCartReturn();
  bindEquipmentCheckout();
  bindPartBorrow();
  qs('.kiosk-card')?.focus?.();
});
