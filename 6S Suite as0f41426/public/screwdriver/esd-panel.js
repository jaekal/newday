'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const fmtTime = iso => iso ? new Date(iso).toLocaleString(undefined,{dateStyle:'short',timeStyle:'short'}) : '—';
const fmtDur = ms => {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return h ? `${h}h ${m}m` : `${m}m`;
};

// ── Tab switching with URL hash (#10) ─────────────────────────────────────
const panels = {
  toolPanel: document.getElementById('toolPanel'),
  esdPanel:  document.getElementById('esdPanel')
};

function activateTab(panelId) {
  document.querySelectorAll('.sd-dtab').forEach(b => {
    const match = b.dataset.panel === panelId;
    b.classList.toggle('active', match);
    b.setAttribute('aria-selected', String(match));
  });
  Object.entries(panels).forEach(([id, el]) => el.classList.toggle('active', id === panelId));
  if (panelId === 'esdPanel') loadESD();
}

document.querySelectorAll('.sd-dtab').forEach(btn => {
  btn.addEventListener('click', () => {
    const panelId = btn.dataset.panel;
    const hash    = btn.dataset.hash;
    activateTab(panelId);
    history.replaceState(null, '', '#' + hash);
  });
});

// Restore from URL hash or localStorage
const hashMap = { tools: 'toolPanel', esd: 'esdPanel' };
const initHash = (location.hash.replace('#','') in hashMap)
  ? hashMap[location.hash.replace('#','')]
  : (localStorage.getItem('sd-panel') || 'toolPanel');
activateTab(initHash);
// Persist choice
document.querySelectorAll('.sd-dtab').forEach(btn =>
  btn.addEventListener('click', () => localStorage.setItem('sd-panel', btn.dataset.panel))
);

// ── ESD helpers ───────────────────────────────────────────────────────────
function setMsg(text, ok=true) {
  const el = $('#esdMsg'); el.textContent=text||''; el.className=`esd-msg ${ok?'ok':'err'}`;
  if (text) setTimeout(()=>{ el.textContent=''; el.className='esd-msg'; },4000);
}

function pillHtml(status) {
  const s=(status||'').toLowerCase().replace(/[_\s]/g,'');
  const cls = s==='checkedout'||s==='checked_out'?'checked_out':'available';
  const label = cls==='checked_out'?'Checked Out':'Available';
  return `<span class="esd-pill ${cls}">${label}</span>`;
}

// Read CSRF token from the server-rendered <meta name="csrf-token"> tag
// (populated for EJS views) and fall back to the non-HttpOnly XSRF-TOKEN
// cookie that middleware/csrf.js sets on every response. Unsafe verbs
// (POST/PUT/PATCH/DELETE) MUST carry this or the CSRF middleware returns
// 403 "Invalid or missing CSRF token".
function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function apiFetch(url, opts = {}, _csrfRetry = false) {
  const method = String(opts.method || 'GET').toUpperCase();
  const isUnsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  const baseHeaders = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (isUnsafe) {
    const token = getCsrfToken();
    if (token) {
      baseHeaders['X-CSRF-Token'] = token;
      baseHeaders['X-XSRF-TOKEN'] = token;
      baseHeaders['CSRF-Token']   = token;
    }
  }

  const r = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: baseHeaders,
  });

  // CSRF drift recovery: after a server restart, a login-triggered
  // session.regenerate(), or session expiry, the browser's cached
  // XSRF-TOKEN cookie is stale. The 403 response itself carries a fresh
  // Set-Cookie for XSRF-TOKEN, so we can just retry exactly once with the
  // refreshed token — no page reload required.
  if (r.status === 403 && isUnsafe && !_csrfRetry) {
    let msg = '';
    try {
      const ct = r.headers.get('content-type') || '';
      msg = ct.includes('application/json')
        ? (await r.clone().json())?.message || ''
        : await r.clone().text();
    } catch { /* ignore */ }
    if (/csrf/i.test(msg || '')) {
      try {
        await fetch('/auth/whoami', {
          method: 'GET',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
      } catch { /* ignore */ }
      return apiFetch(url, opts, true);
    }
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || `${r.status}`);
  return d;
}

// ── Profile operator (session / whoami) ─────────────────────────────────
let profileOperator = '';

function applyOperatorFieldState() {
  const ov = $('#esdOperatorOverride');
  const inp = $('#esdOperatorId');
  const warn = $('#esdProfileOpWarn');
  const mustOverride = !profileOperator;
  if (warn) warn.style.display = mustOverride ? '' : 'none';
  if (mustOverride && ov) ov.checked = true;
  const useOverride = mustOverride || (ov && ov.checked);
  if (inp) {
    inp.readOnly = !useOverride;
    if (!useOverride && profileOperator) inp.value = profileOperator;
  }
}

async function loadProfileOperator() {
  try {
    const w = await apiFetch('/auth/whoami');
    const u = w?.user;
    profileOperator = String(u?.techId || u?.id || '').trim();
    const disp = $('#esdProfileOpDisplay');
    if (disp) disp.textContent = profileOperator || 'Not set';
    const inp = $('#esdOperatorId');
    if (inp) inp.value = profileOperator || '';
    applyOperatorFieldState();
  } catch {
    profileOperator = '';
    const disp = $('#esdProfileOpDisplay');
    if (disp) disp.textContent = 'Not set';
    applyOperatorFieldState();
  }
}

$('#esdOperatorOverride')?.addEventListener('change', () => {
  const inp = $('#esdOperatorId');
  if ($('#esdOperatorOverride')?.checked && profileOperator && inp) {
    inp.value = profileOperator;
    inp.select?.();
  }
  applyOperatorFieldState();
});

// ── ESD checklist gate (#6) ───────────────────────────────────────────────
const chkIds = ['chk-wrist','chk-mat','chk-damage'];
function updateChecklistGate() {
  const allChecked = chkIds.every(id => document.getElementById(id)?.checked);
  const btn = $('#esdBtnCheckout');
  const hint = $('#esdChecklistHint');
  if (btn) { btn.disabled = !allChecked; btn.style.opacity = allChecked ? '1' : '.5'; }
  if (hint) hint.style.display = allChecked ? 'none' : '';
}
chkIds.forEach(id => document.getElementById(id)?.addEventListener('change', updateChecklistGate));

$('#esdCheckAll')?.addEventListener('click', () => {
  chkIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = true; });
  updateChecklistGate();
});
$('#esdCheckNone')?.addEventListener('click', () => {
  chkIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
  updateChecklistGate();
});

// Auto-reset checklist when Cart ID is cleared
$('#esdCartId')?.addEventListener('input', e => {
  if (!e.target.value.trim()) {
    chkIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    updateChecklistGate();
  }
});
updateChecklistGate();

function buildActionPayload() {
  const comment = ($('#esdComment')?.value || '').trim();
  const mustOverride = !profileOperator;
  const overrideOn = mustOverride || !!$('#esdOperatorOverride')?.checked;
  const opTyped = ($('#esdOperatorId')?.value || '').trim();
  const payload = {};
  if (comment) payload.comment = comment;
  if (overrideOn) payload.operatorId = opTyped;
  else payload.operatorId = '';
  return payload;
}

function validateOperatorForAction() {
  const mustOverride = !profileOperator;
  const overrideOn = mustOverride || !!$('#esdOperatorOverride')?.checked;
  const opTyped = ($('#esdOperatorId')?.value || '').trim();
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

// ── Load / render ESD data ────────────────────────────────────────────────
let allCartsCache = [];

async function loadESD() {
  await loadProfileOperator();
  await Promise.all([loadCarts(), loadAuditLog()]);
}

async function loadCarts() {
  try {
    const data = await apiFetch('/esd-carts');
    allCartsCache = Array.isArray(data?.carts) ? data.carts : (Array.isArray(data)?data:[]);
    renderCarts(allCartsCache);
    const checkedOut = allCartsCache.filter(c=>(c.status||'').toLowerCase().replace(/[_\s]/g,'')!=='available').length;
    const badge = $('#esdCheckedBadge');
    if (badge) { badge.textContent=checkedOut; badge.style.display=checkedOut>0?'':'none'; badge.style.background=checkedOut>0?'var(--warn-bg)':''; badge.style.color=checkedOut>0?'var(--warn)':''; badge.style.borderColor=checkedOut>0?'var(--warn)':''; }
    $('#esdCartCount').textContent = `(${allCartsCache.length} total, ${checkedOut} out)`;
  } catch(e) { setMsg(e.message, false); }
}

// ── Cart table with inline actions + row pre-fill (#8) + per-cart drawer (#13) ──
let openDrawerCartId = null;

function renderCarts(carts) {
  const tbody = $('#esdCartsBody'); tbody.innerHTML = '';
  if (!carts.length) { tbody.innerHTML=`<tr><td colspan="5" class="esd-empty">No carts registered yet.</td></tr>`; return; }
  for (const c of carts) {
    const cartId = c.id||c.cartId||'?';
    const isOut  = (c.status||'').toLowerCase().replace(/[_\s]/g,'') !== 'available';

    // Main row
    const tr = document.createElement('tr');
    tr.dataset.cartId = cartId;
    if (openDrawerCartId === cartId) tr.classList.add('esd-row-selected');
    tr.innerHTML = `
      <td><strong>${esc(cartId)}</strong></td>
      <td>${pillHtml(c.status)}</td>
      <td>${esc(c.holder||'—')}</td>
      <td style="white-space:nowrap;font-size:.78rem">${fmtTime(c.updatedAt)}</td>
      <td>
        <div style="display:flex;gap:3px">
          ${isOut
            ? `<button class="btn-return btn-sm esd-inline-action" data-action="checkin" data-cart="${esc(cartId)}" title="Return cart">↩</button>`
            : `<button class="btn-checkout btn-sm esd-inline-action" data-action="checkout" data-cart="${esc(cartId)}" title="Check out cart">↗</button>`
          }
          <button class="sd-icon-btn btn-sm esd-hist-toggle" data-cart="${esc(cartId)}" title="View cart history" style="width:24px;height:24px;font-size:.7rem">▶</button>
        </div>
      </td>`;
    tbody.appendChild(tr);

    // Per-cart history drawer (#13)
    const drawerRow = document.createElement('tr');
    drawerRow.className = 'esd-hist-drawer-row';
    drawerRow.innerHTML = `<td colspan="5" style="padding:0"><div class="esd-hist-drawer" id="hist-${esc(cartId)}"></div></td>`;
    tbody.appendChild(drawerRow);
  }

  // Row click — pre-fill form (#8)
  tbody.querySelectorAll('tr[data-cart-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('button')) return; // button handles itself
      const cartId = tr.dataset.cartId;
      $('#esdCartId').value = cartId;
      $('#esdCartId').dispatchEvent(new Event('input'));
      tbody.querySelectorAll('tr[data-cart-id]').forEach(r => r.classList.remove('esd-row-selected'));
      tr.classList.add('esd-row-selected');
      $('#esdCartId')?.focus();
    });
  });

  // Inline action buttons (#8)
  tbody.querySelectorAll('.esd-inline-action').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cartId = btn.dataset.cart;
      if (!validateOperatorForAction()) return;
      const payload = buildActionPayload();
      try {
        await apiFetch(`/esd-carts/${encodeURIComponent(cartId)}/${btn.dataset.action}`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMsg(`${btn.dataset.action === 'checkout' ? 'Checked out' : 'Returned'}: ${cartId}`, true);
        if (btn.dataset.action === 'checkout') {
          chkIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
          updateChecklistGate();
        }
        $('#esdComment').value = '';
        applyOperatorFieldState();
        await loadESD();
      } catch(err) { setMsg(err.message, false); }
    });
  });

  // History drawer toggles (#13)
  tbody.querySelectorAll('.esd-hist-toggle').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cartId = btn.dataset.cart;
      const drawer = document.getElementById(`hist-${cartId}`);
      if (!drawer) return;
      const isOpen = drawer.classList.toggle('open');
      btn.textContent = isOpen ? '▼' : '▶';
      openDrawerCartId = isOpen ? cartId : null;
      if (!isOpen || drawer.dataset.loaded) return;
      drawer.innerHTML = '<div class="esd-empty">Loading…</div>';
      try {
        const log  = await apiFetch('/esd-carts/audit');
        const all  = (Array.isArray(log)?log:(log?.items||[]));
        const cart = allCartsCache.find(c=>(c.id||c.cartId)===cartId);
        const hist = all.filter(ev=>(ev.cartId||ev.id)===cartId).slice(0,20);
        renderCartHistory(drawer, cartId, hist, cart);
        drawer.dataset.loaded = '1';
      } catch { drawer.innerHTML = '<div class="esd-empty">Could not load history.</div>'; }
    });
  });
}

function renderCartHistory(drawer, cartId, hist, cart) {
  if (!hist.length) { drawer.innerHTML=`<div class="esd-empty">No history for ${esc(cartId)}.</div>`; return; }
  // Compute stats (canonical actions: checkout, checkin, operator_override, …)
  const checkouts = hist.filter(ev => (ev.action || ev.event || '').toLowerCase() === 'checkout');
  const returns   = hist.filter(ev => (ev.action || ev.event || '').toLowerCase() === 'checkin');
  let avgDurMs = 0;
  if (returns.length) {
    const sorted = [...hist].sort((a,b)=>new Date(a.at||a.updatedAt)-new Date(b.at||b.updatedAt));
    const durations = [];
    let lastOut = null;
    for (const ev of sorted) {
      const a = (ev.action || ev.event || '').toLowerCase();
      if (a === 'checkout') lastOut = new Date(ev.at || ev.updatedAt);
      else if (a === 'checkin' && lastOut) {
        durations.push(new Date(ev.at || ev.updatedAt) - lastOut);
        lastOut = null;
      }
    }
    if (durations.length) avgDurMs = durations.reduce((a,b)=>a+b,0)/durations.length;
  }

  let html = `<div class="esd-hist-stat">
    <div>Checkouts this log: <strong>${checkouts.length}</strong></div>
    <div>Avg hold: <strong>${fmtDur(avgDurMs)}</strong></div>
    <div>Current: <strong>${esc(cart?.status||'Unknown')}</strong></div>
  </div><div>`;

  for (const ev of hist) {
    const actLow = (ev.action || ev.event || '').toLowerCase();
    if (actLow === 'operator_override') {
      html += `<div class="esd-hist-row">
      <div class="esd-hist-dot out"></div>
      <div style="flex:1">
        <span style="font-weight:500;color:var(--warn)">Operator override</span>
        ${ev.operatorId ? ` → <span style="color:var(--fg-muted)">${esc(ev.operatorId)}</span>` : ''}
        <span style="font-size:.76rem;color:var(--fg-muted)"> (profile ${esc(ev.profileOperatorId || '—')})</span>
        <span class="esd-audit-time" style="margin-left:.4rem">${fmtTime(ev.at || ev.updatedAt)}</span>
      </div>
    </div>`;
      continue;
    }
    const isOut = actLow === 'checkout';
    const cm = ev.comment ? `<div style="font-size:.76rem;color:var(--fg-muted);margin-top:.15rem">${esc(ev.comment)}</div>` : '';
    html += `<div class="esd-hist-row">
      <div class="esd-hist-dot ${isOut?'out':''}"></div>
      <div style="flex:1">
        <span style="font-weight:500">${isOut?'Checked out':'Returned'}</span>
        ${ev.operatorId||ev.holder ? ` → <span style="color:var(--fg-muted)">${esc(ev.operatorId||ev.holder)}</span>` : ''}
        <span class="esd-audit-time" style="margin-left:.4rem">${fmtTime(ev.at||ev.updatedAt)}</span>
        ${cm}
      </div>
    </div>`;
  }
  html += '</div>';
  drawer.innerHTML = html;
}

async function loadAuditLog() {
  try {
    const log = await apiFetch('/esd-carts/audit');
    const items = Array.isArray(log)?log:(log?.items||[]);
    renderAuditLog(items.slice(0,40));
  } catch { }
}

function renderAuditLog(items) {
  const container = $('#esdAuditLog'); container.innerHTML='';
  if (!items.length) { container.innerHTML=`<div class="esd-empty">No activity yet.</div>`; return; }
  for (const ev of items) {
    const row = document.createElement('div'); row.className='esd-audit-row';
    const action = (ev.action||ev.event||'').toLowerCase();
    if (action === 'operator_override') {
      row.innerHTML = `
        <div class="esd-audit-dot" style="background:var(--warn)"></div>
        <div class="esd-audit-row-body">
          <div><strong>Operator override</strong> · cart <strong>${esc(ev.cartId||'?')}</strong> · used <strong>${esc(ev.operatorId||'?')}</strong> (profile ${esc(ev.profileOperatorId||'—')})</div>
          <div class="esd-audit-time">${fmtTime(ev.at||ev.updatedAt)}</div>
        </div>`;
      container.appendChild(row);
      continue;
    }
    const isCo = action === 'checkout';
    const cm = ev.comment ? `<div style="font-size:.78rem;color:var(--fg-muted)">${esc(ev.comment)}</div>` : '';
    row.innerHTML = `
      <div class="esd-audit-dot ${isCo?'checkout':'checkin'}"></div>
      <div class="esd-audit-row-body">
        <div>${esc(isCo?'Checked out':'Returned')} &nbsp;<strong>${esc(ev.cartId||ev.id||'?')}</strong> &nbsp;→ ${esc(ev.operatorId||ev.holder||'?')}</div>
        <div class="esd-audit-time">${fmtTime(ev.at||ev.updatedAt)}</div>
        ${cm}
      </div>`;
    container.appendChild(row);
  }
}

// ── Checkout / Checkin from form ──────────────────────────────────────────
async function doAction(endpoint) {
  const cartId = $('#esdCartId').value.trim();
  if (!cartId) { setMsg('Cart ID is required.', false); return; }
  if (!validateOperatorForAction()) return;
  const payload = buildActionPayload();
  try {
    await apiFetch(`/esd-carts/${encodeURIComponent(cartId)}/${endpoint}`, { method: 'POST', body: JSON.stringify(payload) });
    setMsg(`${endpoint==='checkout'?'Checked out':'Returned'}: ${cartId}`, true);
    if (endpoint === 'checkout') {
      chkIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
      updateChecklistGate();
    }
    $('#esdComment').value = '';
    await loadProfileOperator();
    await loadESD();
  } catch(e) { setMsg(e.message, false); }
}

$('#esdBtnCheckout').addEventListener('click', ()=>doAction('checkout'));
$('#esdBtnCheckin').addEventListener('click',  ()=>doAction('checkin'));
$('#esdRefreshAudit').addEventListener('click', loadESD);

// Socket live updates
try {
  const socket = window.io?.();
  ['kiosk:cart.checkout','kiosk:cart.return','esdCarts:checkout','esdCarts:return'].forEach(ev=>
    socket?.on?.(ev, ()=>loadESD())
  );
}catch{}

if (initHash === 'esdPanel') loadESD();
