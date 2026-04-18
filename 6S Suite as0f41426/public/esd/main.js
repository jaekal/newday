/* public/esd/main.js */

/* ESD Carts UI — reads/writes via /esd-carts API and auto-updates on socket events */
const $ = (sel) => document.querySelector(sel);

const msg = $('#msg');
const tableBody = $('#cartsTable tbody');

const cartIdEl = $('#cartId');
const operatorEl = $('#operatorId');
const operatorOverrideEl = $('#operatorOverride');
const profileOpDisplay = $('#profileOpDisplay');
const profileOpWarn = $('#profileOpWarn');
const checkoutCommentEl = $('#checkoutComment');
const checklistHint = $('#checklistHint');
const btnCheckout = $('#btnCheckout');
const btnCheckin = $('#btnCheckin');

const chkIds = ['chk-wrist', 'chk-mat', 'chk-damage'];
let profileOperator = '';

const editPanel = $('#editPanel');
const editOriginalIdEl = $('#editOriginalId');
const editCartIdEl = $('#editCartId');
const editStatusEl = $('#editStatus');
const editHolderEl = $('#editHolder');
const btnSaveEdit = $('#btnSaveEdit');
const btnCancelEdit = $('#btnCancelEdit');
const btnCancelEditBottom = $('#btnCancelEditBottom');

let cartsCache = [];
let canManage = false;

function setMsg(text, ok = true) {
  msg.textContent = text || '';
  const good = ok !== false && ok !== 'err';
  msg.style.color = good ? 'var(--fg-muted)' : 'tomato';
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pill(status) {
  const s = String(status || '').toLowerCase();
  const cls = s === 'checked_out' ? 'pill-checked' : 'pill-available';
  const label = s === 'checked_out' ? 'Checked Out' : 'Available';
  return `<span class="status-pill ${cls}">${label}</span>`;
}

async function fetchCarts() {
  const res = await fetch('/esd-carts');
  if (!res.ok) throw new Error('Failed to fetch carts');
  return res.json();
}

async function fetchWhoami() {
  try {
    const res = await fetch('/auth/whoami', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) return { user: null };
    return res.json();
  } catch {
    return { user: null };
  }
}

function applyOperatorFieldState() {
  const mustOverride = !profileOperator;
  if (profileOpWarn) profileOpWarn.style.display = mustOverride ? '' : 'none';
  if (mustOverride && operatorOverrideEl) operatorOverrideEl.checked = true;
  const useOverride = mustOverride || (operatorOverrideEl && operatorOverrideEl.checked);
  if (operatorEl) {
    operatorEl.readOnly = !useOverride;
    if (!useOverride && profileOperator) operatorEl.value = profileOperator;
  }
}

async function loadProfileOperator() {
  const w = await fetchWhoami();
  const u = w?.user;
  profileOperator = String(u?.techId || u?.id || '').trim();
  if (profileOpDisplay) profileOpDisplay.textContent = profileOperator || 'Not set';
  if (operatorEl) operatorEl.value = profileOperator || '';
  applyOperatorFieldState();
}

function updateChecklistGate() {
  const allChecked = chkIds.every((id) => document.getElementById(id)?.checked);
  if (btnCheckout) {
    btnCheckout.disabled = !allChecked;
    btnCheckout.style.opacity = allChecked ? '1' : '0.5';
  }
  if (checklistHint) checklistHint.style.display = allChecked ? 'none' : '';
}

function buildActionPayload() {
  const comment = (checkoutCommentEl?.value || '').trim();
  const mustOverride = !profileOperator;
  const overrideOn = mustOverride || !!operatorOverrideEl?.checked;
  const opTyped = (operatorEl?.value || '').trim();
  const payload = {};
  if (comment) payload.comment = comment;
  payload.operatorId = overrideOn ? opTyped : '';
  return payload;
}

function validateOperatorForAction() {
  const mustOverride = !profileOperator;
  const overrideOn = mustOverride || !!operatorOverrideEl?.checked;
  const opTyped = (operatorEl?.value || '').trim();
  if (overrideOn && !opTyped) {
    setMsg('Enter an operator ID (override is on or your profile has no tech ID).', false);
    return false;
  }
  if (!overrideOn && !profileOperator) {
    setMsg('Your profile has no operator ID. Enable override and enter one.', false);
    return false;
  }
  return true;
}

async function fetchCapabilities() {
  try {
    const res = await fetch('/esd-carts/admin/capabilities');
    if (!res.ok) return { canManage: false };
    return res.json();
  } catch {
    return { canManage: false };
  }
}

function openEdit(cartId) {
  const cart = cartsCache.find(c => String(c.id || c.cartId) === String(cartId));
  if (!cart) {
    setMsg('Could not find selected cart.', false);
    return;
  }

  editOriginalIdEl.value = cart.id || '';
  editCartIdEl.value = cart.id || '';
  editStatusEl.value = cart.status || 'available';
  editHolderEl.value = cart.holder || '';
  editPanel.classList.remove('hidden');
  editCartIdEl.focus();
  editPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEdit() {
  editOriginalIdEl.value = '';
  editCartIdEl.value = '';
  editStatusEl.value = 'available';
  editHolderEl.value = '';
  editPanel.classList.add('hidden');
}

function buildActions(cart) {
  if (!canManage) return `<span class="muted">—</span>`;

  const id = escapeHtml(cart.id || '');
  return `
    <div class="btn-row">
      <button type="button" class="btn-small js-edit-cart" data-cart-id="${id}">Edit</button>
      <button type="button" class="btn-small btn-danger js-remove-cart" data-cart-id="${id}">Remove</button>
    </div>
  `;
}

function renderCarts(data) {
  const carts = Array.isArray(data?.carts) ? data.carts : [];
  cartsCache = carts.slice();

  tableBody.innerHTML = carts.map((c) => `
    <tr>
      <td>${escapeHtml(c.id || c.cartId || '')}</td>
      <td>${pill(c.status)}</td>
      <td>${escapeHtml(c.holder || '')}</td>
      <td>${escapeHtml(fmtTime(c.updatedAt))}</td>
      <td class="actions-cell">${buildActions(c)}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="muted">No carts yet.</td></tr>`;
}

async function refresh() {
  try {
    const data = await fetchCarts();
    renderCarts(data);
  } catch (e) {
    setMsg(e.message || 'Error loading carts', false);
  }
}

// Read CSRF token from the shared helper (falls back to XSRF-TOKEN cookie
// set by middleware/csrf.js). Unsafe methods MUST send this or the server
// returns 403 "Invalid or missing CSRF token".
function csrfToken() {
  try {
    if (typeof window.__csrf === 'function') return window.__csrf() || '';
  } catch { /* ignore */ }
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function csrfHeaders(extra) {
  const token = csrfToken();
  return {
    'X-CSRF-Token': token,
    'X-XSRF-TOKEN': token,
    ...(extra || {}),
  };
}

// Perform a fetch; if we get a 403 that looks like a CSRF failure, refresh
// our view of the XSRF-TOKEN cookie and retry exactly once. The server sets
// a fresh Set-Cookie on the 403 response itself, so the retry uses the
// correct token automatically (no reload needed).
async function fetchWithCsrfRetry(url, init, attempt = 0) {
  const res = await fetch(url, init);
  if (res.status !== 403 || attempt > 0) return res;

  let msg = '';
  try {
    const ct = res.headers.get('content-type') || '';
    msg = ct.includes('application/json')
      ? (await res.clone().json())?.message || ''
      : await res.clone().text();
  } catch { /* ignore body read errors */ }
  if (!/csrf/i.test(msg || '')) return res;

  // Kick a GET so the browser commits the new XSRF-TOKEN cookie before we retry.
  try {
    await fetch('/auth/whoami', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
  } catch { /* ignore */ }

  const retryInit = {
    ...init,
    headers: csrfHeaders(init?.headers && init.headers['Content-Type']
      ? { 'Content-Type': init.headers['Content-Type'] }
      : undefined),
  };
  return fetchWithCsrfRetry(url, retryInit, attempt + 1);
}

async function postJSON(url, body) {
  const res = await fetchWithCsrfRetry(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

async function putJSON(url, body) {
  const res = await fetchWithCsrfRetry(url, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: csrfHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

async function deleteRequest(url) {
  const res = await fetchWithCsrfRetry(url, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: csrfHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

async function checkout() {
  const cartId = cartIdEl.value.trim();
  if (!cartId) return setMsg('Cart ID is required.', false);
  if (!validateOperatorForAction()) return;
  const chkOk = chkIds.every((id) => document.getElementById(id)?.checked);
  if (!chkOk) return setMsg('Complete the pre-checkout checklist before checking out.', false);

  try {
    await postJSON(`/esd-carts/${encodeURIComponent(cartId)}/checkout`, buildActionPayload());
    setMsg(`Cart ${cartId} checked out.`);
    chkIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    updateChecklistGate();
    checkoutCommentEl.value = '';
    await loadProfileOperator();
    await refresh();
  } catch (e) {
    setMsg(e.message, false);
  }
}

async function checkin() {
  const cartId = cartIdEl.value.trim();
  if (!cartId) return setMsg('Cart ID is required.', false);
  if (!validateOperatorForAction()) return;

  try {
    await postJSON(`/esd-carts/${encodeURIComponent(cartId)}/checkin`, buildActionPayload());
    setMsg(`Cart ${cartId} returned.`);
    checkoutCommentEl.value = '';
    await loadProfileOperator();
    await refresh();
  } catch (e) {
    setMsg(e.message, false);
  }
}

async function saveEdit() {
  const originalId = editOriginalIdEl.value.trim();
  const nextId = editCartIdEl.value.trim();
  const status = editStatusEl.value;
  let holder = editHolderEl.value.trim();

  if (!originalId) return setMsg('Missing original cart ID.', false);
  if (!nextId) return setMsg('New cart ID is required.', false);
  if (!status) return setMsg('Status is required.', false);

  if (status === 'available') {
    holder = '';
  } else if (status === 'checked_out' && !holder) {
    return setMsg('Holder is required when a cart is checked out.', false);
  }

  try {
    await putJSON(`/esd-carts/admin/${encodeURIComponent(originalId)}`, {
      id: nextId,
      status,
      holder
    });

    setMsg(`Cart ${originalId} updated successfully.`);
    closeEdit();
    await refresh();
  } catch (e) {
    setMsg(e.message, false);
  }
}

async function removeCart(cartId) {
  if (!cartId) return;
  const confirmed = window.confirm(`Remove cart ${cartId}?`);
  if (!confirmed) return;

  try {
    await deleteRequest(`/esd-carts/admin/${encodeURIComponent(cartId)}`);
    setMsg(`Cart ${cartId} removed.`);
    if (editOriginalIdEl.value.trim() === cartId) closeEdit();
    await refresh();
  } catch (e) {
    setMsg(e.message, false);
  }
}

operatorOverrideEl?.addEventListener('change', () => {
  if (operatorOverrideEl?.checked && profileOperator && operatorEl) {
    operatorEl.value = profileOperator;
    operatorEl.select?.();
  }
  applyOperatorFieldState();
});

chkIds.forEach((id) => document.getElementById(id)?.addEventListener('change', updateChecklistGate));
$('#btnCheckAll')?.addEventListener('click', () => {
  chkIds.forEach((i) => {
    const el = document.getElementById(i);
    if (el) el.checked = true;
  });
  updateChecklistGate();
});
$('#btnCheckNone')?.addEventListener('click', () => {
  chkIds.forEach((i) => {
    const el = document.getElementById(i);
    if (el) el.checked = false;
  });
  updateChecklistGate();
});

cartIdEl?.addEventListener('input', (e) => {
  if (!e.target.value.trim()) {
    chkIds.forEach((i) => {
      const el = document.getElementById(i);
      if (el) el.checked = false;
    });
    updateChecklistGate();
  }
});

btnCheckout.addEventListener('click', checkout);
btnCheckin.addEventListener('click', checkin);
updateChecklistGate();
btnSaveEdit.addEventListener('click', saveEdit);
btnCancelEdit.addEventListener('click', closeEdit);
btnCancelEditBottom.addEventListener('click', closeEdit);

tableBody.addEventListener('click', async (event) => {
  const editBtn = event.target.closest('.js-edit-cart');
  if (editBtn) {
    openEdit(editBtn.dataset.cartId);
    return;
  }

  const removeBtn = event.target.closest('.js-remove-cart');
  if (removeBtn) {
    await removeCart(removeBtn.dataset.cartId);
  }
});

// Socket-driven live updates from routes/esdCarts.js
try {
  const socket = io();

  socket.on('kiosk:cart.checkout', () => refresh());
  socket.on('kiosk:cart.return', () => refresh());

  socket.on('esdCarts:checkout', () => refresh());
  socket.on('esdCarts:return', () => refresh());
  socket.on('esdCarts:updated', () => refresh());
  socket.on('esdCarts:removed', () => refresh());
} catch {
  /* socket optional */
}

(async function init() {
  await loadProfileOperator();
  const caps = await fetchCapabilities();
  canManage = !!caps?.canManage;
  await refresh();
})();