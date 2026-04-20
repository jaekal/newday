/**
 * public/cf/tools/tools.js
 * Command Floor — Tool Tracking page.
 * Data:  GET /tools · GET /employees
 * Write: POST /tools/:serialNumber/checkout  { operatorId }
 *        POST /tools/:serialNumber/return     {}
 */
'use strict';

import { startLiveClock, countUp, esc, fmtTime } from '/cf/cf-shell.js';

/* ── State ─────────────────────────────────────────────────────── */
let allTools     = [];
let employees    = {};
let filtered     = [];
let activeFilter = '';
let activeCls    = '';
let searchQ      = '';
let activeBuilding = (() => { try { return localStorage.getItem('suite.building.v1') || 'Bldg-350'; } catch { return 'Bldg-350'; } })();
let sortCol      = 'serialNumber';
let sortAsc      = true;
let page         = 1;
const PAGE_LEN   = 15;
let durTimer     = null;

const $ = id => document.getElementById(id);

let cfMainView = 'tools';
let cfGoldenRows = [];

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function fetchJsonWithCsrf(url, opts = {}, _csrfRetry = false) {
  const method = String(opts.method || 'GET').toUpperCase();
  const isUnsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (isUnsafe) {
    const t = getCsrfToken();
    if (t) {
      headers['X-CSRF-Token'] = t;
      headers['X-XSRF-TOKEN'] = t;
    }
  }
  const body =
    opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)
      ? JSON.stringify(opts.body)
      : opts.body;
  const r = await fetch(url, { credentials: 'include', ...opts, headers, body });
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
      return fetchJsonWithCsrf(url, opts, true);
    }
  }
  return r;
}

/* ── Duration helpers ───────────────────────────────────────────── */
function durMs(tool) {
  if (tool.status !== 'being used' || !tool.timestamp) return 0;
  return Math.max(0, Date.now() - Date.parse(tool.timestamp));
}
function durLabel(ms) {
  if (!ms) return '—';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
function durClass(ms) {
  const h = ms / 3_600_000;
  return h >= 5 ? 'cf-dur-crit' : h >= 2 ? 'cf-dur-warn' : 'cf-dur-ok';
}

/* ── Calibration status ─────────────────────────────────────────── */
function calStatus(tool) {
  if (!tool.nextCalibrationDue) return { val: 'none', label: '—', cls: 'cf-dur-ok' };
  const days = Math.ceil((new Date(tool.nextCalibrationDue) - Date.now()) / 86_400_000);
  if (days < 0)   return { val: 'expired', label: `Expired ${Math.abs(days)}d`, cls: 'cf-dur-crit' };
  if (days <= 14) return { val: 'soon',    label: `${days}d`,                   cls: 'cf-dur-warn' };
  return { val: 'ok', label: new Date(tool.nextCalibrationDue).toLocaleDateString(undefined, { dateStyle: 'short' }), cls: 'cf-dur-ok' };
}

/* ── Torque pill ────────────────────────────────────────────────── */
function torquePill(torque) {
  if (!torque) return '—';
  const n = parseFloat(torque);
  const cls = !isFinite(n) ? '' : n === 0.6 ? 'tq-target' : n === 1.2 ? 'tq-alert' : n < 0.6 ? 'tq-low' : 'tq-high';
  return `<span class="cf-torque-pill ${cls}">${esc(torque)}</span>`;
}

function classIcon(cls) {
  try {
    if (typeof window !== 'undefined' && window.suiteIcons?.classification) {
      const html = window.suiteIcons.classification(cls, 13);
      if (html) return `<span class="cf-cls-ic" style="display:inline-flex;vertical-align:middle;margin-right:4px">${html}</span>`;
    }
  } catch { /* noop */ }
  const map = { manual: '🪛', wired: '🔌', wireless: '🔋' };
  return map[(cls || '').toLowerCase()] || '';
}

/* ── Fetch ──────────────────────────────────────────────────────── */
async function loadData() {
  try {
    const bldgQs = activeBuilding && activeBuilding !== 'all' ? `?building=${encodeURIComponent(activeBuilding)}` : '';
    const [toolsRes, empRes] = await Promise.all([
      fetch(`/tools${bldgQs}`, { credentials: 'include' }),
      fetch('/employees',      { credentials: 'include' }),
    ]);
    const toolData = toolsRes.ok ? await toolsRes.json() : [];
    allTools = Array.isArray(toolData) ? toolData : (toolData?.tools || []);

    if (empRes.ok) {
      const empData = await empRes.json();
      const list = Array.isArray(empData) ? empData : (empData?.items || empData?.employees || []);
      employees = {};
      list.forEach(e => {
        const id = (e.id || e.employeeId || e.techId || '').toLowerCase();
        if (id) employees[id] = { name: e.name || e.displayName || id, shift: e.shift || 1 };
      });
    }
  } catch (e) {
    console.error('[CF Tools] load failed:', e);
  }

  allTools.forEach(t => { t._durMs = durMs(t); });
  applyFilters();
  renderKpis();
  renderOverduePanel();
}

/* ── KPIs ───────────────────────────────────────────────────────── */
function renderKpis() {
  const total   = allTools.length;
  const out     = allTools.filter(t => t.status === 'being used').length;
  const avail   = total - out;
  const cal     = allTools.filter(t => { const cs = calStatus(t); return cs.val === 'expired' || cs.val === 'soon'; }).length;
  const overdue = allTools.filter(t => t._durMs >= 5 * 3_600_000).length;

  countUp('kv-total',   total,   { barId: 'bar-total',   barPct: 100,                                       delay: 100 });
  countUp('kv-out',     out,     { barId: 'bar-out',     barPct: total ? Math.round(out     / total * 100) : 0, delay: 200 });
  countUp('kv-cal',     cal,     { barId: 'bar-cal',     barPct: total ? Math.round(cal     / total * 100) : 0, delay: 300 });
  countUp('kv-overdue', overdue, { barId: 'bar-overdue', barPct: total ? Math.round(overdue / total * 100) : 0, delay: 400 });

  const sub = $('ks-total');
  if (sub) {
    const manual   = allTools.filter(t => (t.classification || '').toLowerCase() === 'manual').length;
    const wired    = allTools.filter(t => (t.classification || '').toLowerCase() === 'wired').length;
    const wireless = allTools.filter(t => (t.classification || '').toLowerCase() === 'wireless').length;
    sub.textContent = `${manual} manual · ${wired} wired · ${wireless} wireless`;
  }
  const ksOut = $('ks-out');
  if (ksOut) ksOut.textContent = out > 0 ? `${avail} available` : 'all available';

  const crumb = $('topbarCrumb');
  if (crumb) crumb.textContent = `/ Checkout · Return · Calibration · ${total} tools`;

  const rail = $('railOutCount');
  if (rail) { rail.textContent = out; rail.style.display = out ? '' : 'none'; }
}

/* ── Filters ────────────────────────────────────────────────────── */
function applyFilters() {
  const q = searchQ.toLowerCase().trim();
  filtered = allTools.filter(t => {
    const isOut     = t.status === 'being used';
    const isOverdue = t._durMs >= 5 * 3_600_000;
    const cs        = calStatus(t);

    if (activeFilter === 'available' && isOut)                                return false;
    if (activeFilter === 'out'       && !isOut)                               return false;
    if (activeFilter === 'overdue'   && !isOverdue)                           return false;
    if (activeFilter === 'cal' && cs.val !== 'soon' && cs.val !== 'expired')  return false;
    if (activeCls && (t.classification || '').toLowerCase() !== activeCls.toLowerCase()) return false;

    if (q) {
      const opId   = (t.operatorId || '').toLowerCase();
      const opName = (employees[opId]?.name || '').toLowerCase();
      const hay = [t.serialNumber, t.torque, t.slot, t.classification, t.model, t.description, t.operatorId, opName]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (sortCol === '_durMs') {
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    }
    if (sortCol === 'nextCalibrationDue') {
      const ta = av ? new Date(av).getTime() : Infinity;
      const tb = bv ? new Date(bv).getTime() : Infinity;
      return sortAsc ? ta - tb : tb - ta;
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortAsc ? cmp : -cmp;
  });

  page = 1;
  renderTable();
}

/* ── Table ──────────────────────────────────────────────────────── */
function renderTable() {
  const tbody = $('toolBody');
  const info  = $('pgInfo');
  const count = $('toolCount');
  if (!tbody) return;

  const total = filtered.length;
  const start = (page - 1) * PAGE_LEN;
  const slice = filtered.slice(start, start + PAGE_LEN);

  if (count) count.textContent = `showing ${total.toLocaleString()}`;
  if (info)  info.textContent  = total === 0 ? 'No results' : `${start + 1}–${Math.min(start + PAGE_LEN, total)} of ${total.toLocaleString()}`;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#94A3B8;font-family:'IBM Plex Sans',sans-serif">No tools match the current filters.</td></tr>`;
    renderPagination(total);
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  slice.forEach(t => {
    const isOut  = t.status === 'being used';
    const ms     = t._durMs;
    const opId   = (t.operatorId || '').toLowerCase();
    const opName = employees[opId]?.name || t.operatorId || '—';
    const shift  = employees[opId]?.shift || 1;
    const cs     = calStatus(t);
    const rowCls = ms >= 8 * 3600000 ? 'row-crit' : ms >= 5 * 3600000 ? 'row-warn' : '';

    const statusPill = isOut
      ? `<span class="cf-pill out"><span class="cf-pill-dot"></span>Checked out</span>`
      : `<span class="cf-pill ok"><span class="cf-pill-dot"></span>Available</span>`;

    const actionBtn = isOut
      ? `<button class="cf-rq-action" data-action="return" data-serial="${esc(t.serialNumber)}" style="background:rgba(245,158,11,.1);color:#92400E;border-color:rgba(245,158,11,.3)">↩ Return</button>`
      : `<button class="cf-rq-action" data-action="checkout" data-serial="${esc(t.serialNumber)}" style="background:rgba(34,197,94,.1);color:#15803D;border-color:rgba(34,197,94,.3)">↗ Out</button>`;

    const tr = document.createElement('tr');
    tr.className    = rowCls;
    tr.dataset.serial = t.serialNumber;
    tr.innerHTML = `
      <td class="mono">${esc(t.serialNumber || '?')}</td>
      <td style="font-size:12px">${classIcon(t.classification)} ${esc(t.classification || '—')}</td>
      <td>${torquePill(t.torque)}</td>
      <td class="muted" style="font-size:12px;text-align:center">${esc(t.slot || '—')}</td>
      <td>${statusPill}</td>
      <td>
        ${isOut
          ? `<span style="display:inline-flex;align-items:center;font-size:12px;color:#1E293B;font-family:'IBM Plex Sans',sans-serif">
               <span class="cf-shift-dot shift-${shift}"></span>${esc(opName)}
             </span>`
          : `<span style="color:#94A3B8;font-size:12px">—</span>`}
      </td>
      <td>
        <span class="dur-cell ${durClass(ms)}"
              data-ts="${esc(t.timestamp || '')}"
              style="font-family:'IBM Plex Mono',monospace;font-size:12px">${durLabel(ms)}</span>
      </td>
      <td>
        <span class="${cs.cls}" style="font-family:'IBM Plex Mono',monospace;font-size:12px">${esc(cs.label)}</span>
      </td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  renderPagination(total);

  // Re-bind action delegation on each render (fresh tbody)
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, serial } = btn.dataset;
    if (action === 'checkout') openCheckoutModal(serial);
    if (action === 'return')   doReturn(serial);
  });

  clearInterval(durTimer);
  durTimer = setInterval(updateDurations, 30_000);
}

function updateDurations() {
  document.querySelectorAll('.dur-cell[data-ts]').forEach(el => {
    const ts = el.dataset.ts;
    if (!ts) return;
    const ms = Math.max(0, Date.now() - Date.parse(ts));
    el.textContent = durLabel(ms);
    el.className   = 'dur-cell ' + durClass(ms);
  });
}

/* ── Pagination ─────────────────────────────────────────────────── */
function renderPagination(total) {
  const c = $('pgBtns');
  if (!c) return;
  const pages = Math.max(1, Math.ceil(total / PAGE_LEN));
  c.innerHTML = '';
  if (pages <= 1) return;

  const mk = (label, p, active, disabled) => {
    const b = document.createElement('button');
    b.className = 'cf-pg-btn' + (active ? ' active' : '');
    b.innerHTML = label; b.disabled = disabled; b.dataset.page = p;
    return b;
  };
  const f    = document.createDocumentFragment();
  const prev = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
  const next = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
  f.appendChild(mk(prev, page - 1, false, page === 1));
  const lo = Math.max(1, page - 2), hi = Math.min(pages, page + 2);
  for (let p = lo; p <= hi; p++) f.appendChild(mk(p, p, p === page, false));
  f.appendChild(mk(next, page + 1, false, page >= pages));
  c.appendChild(f);
  c.onclick = e => {
    const b = e.target.closest('.cf-pg-btn[data-page]');
    if (!b || b.disabled) return;
    page = +b.dataset.page;
    renderTable();
  };
}

/* ── Overdue holds panel ────────────────────────────────────────── */
function renderOverduePanel() {
  const list  = $('overdueList');
  const count = $('overdueCount');
  if (!list) return;

  const overdue = allTools
    .filter(t => t._durMs >= 5 * 3_600_000)
    .sort((a, b) => a._durMs - b._durMs);

  if (count) count.textContent = `${overdue.length} tool${overdue.length !== 1 ? 's' : ''}`;

  if (!overdue.length) {
    list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94A3B8;font-size:12px;font-family:'IBM Plex Sans',sans-serif">No overdue holds right now.</div>`;
    return;
  }

  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  overdue.forEach(t => {
    const opId   = (t.operatorId || '').toLowerCase();
    const opName = employees[opId]?.name || t.operatorId || '—';
    const shift  = employees[opId]?.shift || 1;
    const ms     = t._durMs;
    const hours  = (ms / 3_600_000).toFixed(1);
    const isCrit = ms >= 8 * 3_600_000;

    const div = document.createElement('div');
    div.className = 'cf-overdue-row';
    div.style.background = isCrit ? 'rgba(239,68,68,.04)' : '';
    div.innerHTML = `
      <span style="font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:#1B3A4B;font-weight:500">${esc(t.serialNumber || '?')}</span>
      <span style="font-size:12px;color:#1E293B;font-family:'IBM Plex Sans',sans-serif;display:flex;align-items:center">
        <span class="cf-shift-dot shift-${shift}"></span>${esc(opName)}
      </span>
      <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;color:${isCrit ? '#991B1B' : '#92400E'};text-align:right">${hours}h</span>
      <span style="display:flex;justify-content:flex-end">
        <button class="cf-rq-action" data-action="return" data-serial="${esc(t.serialNumber)}"
                style="background:rgba(245,158,11,.1);color:#92400E;border-color:rgba(245,158,11,.3)">↩ Return</button>
      </span>`;
    frag.appendChild(div);
  });
  list.appendChild(frag);

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="return"]');
    if (!btn) return;
    doReturn(btn.dataset.serial);
  });
}

/* ── Checkout modal ─────────────────────────────────────────────── */
function openCheckoutModal(prefillSerial) {
  $('coSerial').value   = prefillSerial || '';
  $('coOperator').value = sessionStorage.getItem('cf-last-op') || '';
  $('checkoutModal').classList.add('open');
  setTimeout(() => (prefillSerial ? $('coOperator') : $('coSerial')).focus(), 50);
}
function closeCheckoutModal() { $('checkoutModal').classList.remove('open'); }

$('checkoutCancelBtn').addEventListener('click', closeCheckoutModal);
$('checkoutModal').addEventListener('click', e => { if (e.target === $('checkoutModal')) closeCheckoutModal(); });
$('checkoutBtn').addEventListener('click', () => openCheckoutModal(''));

$('checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  const serial   = $('coSerial').value.trim();
  const operator = $('coOperator').value.trim().toLowerCase();
  if (!serial || !operator) return;
  sessionStorage.setItem('cf-last-op', operator);

  // ── FIX: POST to /tools/:serialNumber/checkout with { operatorId } ──
  // The old code incorrectly called /tools/checkout with { serialNumber, operatorId },
  // which is the kiosk-inventory route expecting { code }. The correct tool
  // checkout endpoint is POST /tools/:serialNumber/checkout { operatorId }.
  try {
    const r = await fetch(`/tools/${encodeURIComponent(serial)}/checkout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId: operator }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
    closeCheckoutModal();
    await loadData();
  } catch (err) {
    alert(`Checkout failed: ${err.message}`);
  }
});

/* ── Return modal ───────────────────────────────────────────────── */
function openReturnModal(prefillSerial) {
  $('retSerial').value = prefillSerial || '';
  $('returnModal').classList.add('open');
  setTimeout(() => $('retSerial').focus(), 50);
}
function closeReturnModal() { $('returnModal').classList.remove('open'); }

$('returnCancelBtn').addEventListener('click', closeReturnModal);
$('returnModal').addEventListener('click', e => { if (e.target === $('returnModal')) closeReturnModal(); });
$('returnBtn').addEventListener('click', () => openReturnModal(''));

$('returnForm').addEventListener('submit', async e => {
  e.preventDefault();
  await doReturn($('retSerial').value.trim());
  closeReturnModal();
});

async function doReturn(serial) {
  if (!serial) return;

  // ── FIX: POST to /tools/:serialNumber/return with empty body ──
  // The old code called /tools/return { serialNumber }, which is the
  // inventory return endpoint — completely the wrong route for tools.
  // Correct endpoint: POST /tools/:serialNumber/return {}
  try {
    const r = await fetch(`/tools/${encodeURIComponent(serial)}/return`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
    await loadData();
  } catch (err) {
    alert(`Return failed: ${err.message}`);
  }
}

/* ── Filter strip ───────────────────────────────────────────────── */
function initFilterStrip() {
  $('filterStrip')?.addEventListener('click', e => {
    const pill = e.target.closest('[data-tf],[data-cls]');
    if (!pill) return;
    $('filterStrip').querySelectorAll('[data-tf],[data-cls]').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    if (pill.hasAttribute('data-tf'))  { activeFilter = pill.dataset.tf;  activeCls = ''; }
    if (pill.hasAttribute('data-cls')) { activeCls = pill.dataset.cls;    activeFilter = ''; }
    applyFilters();
  });
}

/* ── Tabs (preset sorts) ────────────────────────────────────────── */
function initTabStrip() {
  $('toolTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('[data-sort-preset]');
    if (!tab) return;
    $('toolTabs').querySelectorAll('[data-sort-preset]').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    const preset = tab.dataset.sortPreset;
    if (preset === 'duration') { sortCol = '_durMs'; sortAsc = false; }
    else if (preset === 'cal') { sortCol = 'nextCalibrationDue'; sortAsc = true; }
    else                       { sortCol = 'serialNumber'; sortAsc = true; }
    applyFilters();
  });
}

/* ── Sort headers ───────────────────────────────────────────────── */
function initSortHeaders() {
  document.querySelectorAll('.cf-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      sortCol === col ? (sortAsc = !sortAsc) : (sortCol = col, sortAsc = true);
      document.querySelectorAll('.cf-table thead th').forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      applyFilters();
    });
  });
}

/* ── Search ─────────────────────────────────────────────────────── */
function initSearch() {
  let timer;
  $('cfSearch')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQ = e.target.value; applyFilters(); }, 180);
  });
}

/* ── Export ─────────────────────────────────────────────────────── */
function initExport() {
  $('exportBtn')?.addEventListener('click', () => {
    const headers = ['Serial', 'Classification', 'Torque', 'Slot', 'Status', 'Operator', 'Duration', 'Cal Due'];
    const rows = filtered.map(t => {
      const opId = (t.operatorId || '').toLowerCase();
      return [
        t.serialNumber, t.classification || '', t.torque || '', t.slot || '', t.status,
        employees[opId]?.name || t.operatorId || '', durLabel(t._durMs), t.nextCalibrationDue || '',
      ];
    });
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' })),
      download: `tools_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); a.remove();
  });
}

/* ── Golden parts (Command Floor — same ledger as kiosk, golden_sample only) ─ */
function initRegisterViewStrip() {
  $('cfRegisterViewStrip')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cf-main]');
    if (!btn) return;
    const v = btn.dataset.cfMain;
    cfMainView = v;
    $('cfRegisterViewStrip')
      ?.querySelectorAll('[data-cf-main]')
      .forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.cf-tools-only').forEach((el) => {
      el.style.display = v === 'tools' ? '' : 'none';
    });
    const goldenBlock = $('cfGoldenRegisterBlock');
    const toolsBlock = $('cfToolsRegisterBlock');
    if (toolsBlock) toolsBlock.style.display = v === 'tools' ? '' : 'none';
    if (goldenBlock) goldenBlock.style.display = v === 'golden' ? 'block' : 'none';
    const title = $('cfRegisterTitle');
    if (title) title.textContent = v === 'golden' ? 'Golden parts' : 'Tool register';
    if (v === 'golden') loadCfGoldenParts();
    else applyFilters();
  });
}

function renderCfGoldenKpi() {
  const tc = $('toolCount');
  if (tc && cfMainView === 'golden') {
    tc.textContent = `${cfGoldenRows.length} open`;
    tc.style.visibility = '';
  } else if (tc && cfMainView === 'tools') {
    tc.style.visibility = '';
  }
}

async function loadCfGoldenParts() {
  const tbody = $('cfGpBody');
  if (!tbody) return;
  try {
    const r = await fetchJsonWithCsrf('/tools/golden-parts', { method: 'GET' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
    const data = await r.json();
    cfGoldenRows = Array.isArray(data.borrows) ? data.borrows : [];
    renderCfGoldenKpi();
    const sel = $('cfGpRetSel');
    if (sel) {
      sel.replaceChildren();
      const h = document.createElement('option');
      h.value = '';
      h.textContent = cfGoldenRows.length ? 'Select borrow…' : 'No open borrows';
      sel.appendChild(h);
      for (const b of cfGoldenRows) {
        const o = document.createElement('option');
        o.value = String(b.id || '').trim();
        o.textContent = `${b.partSn || ''} → ${b.targetServerSn || ''}`.trim();
        sel.appendChild(o);
      }
    }
    if (!cfGoldenRows.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:#94A3B8">No open golden sample borrows.</td></tr>';
      return;
    }
    const now = Date.now();
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    cfGoldenRows.forEach((b) => {
      const t0 = Date.parse(b.borrowedAt || '');
      const ms = Number.isNaN(t0) ? 0 : Math.max(0, now - t0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono" style="font-weight:600">${esc(b.partSn || '')}</td>
        <td>${esc(b.targetServerSn || '')}</td>
        <td>${esc(b.operatorName || b.operatorId || '—')}</td>
        <td>${esc(fmtTime(b.borrowedAt))}</td>
        <td style="font-family:'IBM Plex Mono',monospace;font-size:12px">${esc(durLabel(ms))}</td>
        <td><button type="button" class="cf-rq-action" data-cf-gp-ret="${esc(b.id)}"
          style="background:rgba(245,158,11,.1);color:#92400E;border-color:rgba(245,158,11,.3)">↩ Return</button></td>`;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    tbody.onclick = (e) => {
      const b = e.target.closest('[data-cf-gp-ret]');
      if (!b) return;
      const id = b.getAttribute('data-cf-gp-ret');
      const s = $('cfGpRetSel');
      if (s) s.value = id;
      $('cfGpRetPart').value = '';
    };
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:1rem;color:#B91C1C">${esc(
      err.message || 'Load failed'
    )}</td></tr>`;
  }
}

async function cfGoldenBorrow() {
  const msg = $('cfGpBorrowMsg');
  const partSn = $('cfGpPart')?.value?.trim();
  const targetServerSn = $('cfGpTarget')?.value?.trim();
  const notes = $('cfGpNotes')?.value?.trim() || '';
  if (!partSn || !targetServerSn) {
    if (msg) msg.innerHTML = '<span style="color:#B91C1C">Part serial and target server required.</span>';
    return;
  }
  try {
    const r = await fetchJsonWithCsrf('/tools/golden-parts/borrow', {
      method: 'POST',
      body: { partSn, targetServerSn, donorServerSn: '', notes, expectedReturnHours: null },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || r.statusText);
    if (msg) msg.innerHTML = '<span style="color:#15803D">Borrow logged.</span>';
    $('cfGpPart').value = '';
    $('cfGpTarget').value = '';
    $('cfGpNotes').value = '';
    await loadCfGoldenParts();
  } catch (e) {
    if (msg) msg.innerHTML = `<span style="color:#B91C1C">${esc(e.message)}</span>`;
  }
}

async function cfGoldenReturn() {
  const msg = $('cfGpReturnMsg');
  const borrowId = $('cfGpRetSel')?.value?.trim() || '';
  const partSn = $('cfGpRetPart')?.value?.trim() || '';
  const condition = $('cfGpRetCond')?.value || 'Good';
  const notes = '';
  if (!borrowId && !partSn) {
    if (msg) msg.innerHTML = '<span style="color:#B91C1C">Select a borrow or enter part serial.</span>';
    return;
  }
  try {
    const r = await fetchJsonWithCsrf('/tools/golden-parts/return', {
      method: 'POST',
      body: { borrowId, partSn, condition, notes },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || r.statusText);
    if (msg) msg.innerHTML = '<span style="color:#15803D">Return logged.</span>';
    $('cfGpRetPart').value = '';
    await loadCfGoldenParts();
  } catch (e) {
    if (msg) msg.innerHTML = `<span style="color:#B91C1C">${esc(e.message)}</span>`;
  }
}

function initCfGoldenActions() {
  $('cfGpBorrowBtn')?.addEventListener('click', () => cfGoldenBorrow());
  $('cfGpReturnBtn')?.addEventListener('click', () => cfGoldenReturn());
  $('cfGpRefreshBtn')?.addEventListener('click', () => loadCfGoldenParts());
}

/* ── Socket live ────────────────────────────────────────────────── */
function connectSocket() {
  try {
    const s = window.io?.({ withCredentials: true });
    if (!s) return;
    ['toolCheckedOut', 'toolReturned', 'toolUpdated'].forEach(evt => {
      s.on(evt, payload => {
        const t = payload?.tool || payload;
        if (!t?.serialNumber) { loadData(); return; }
        const idx = allTools.findIndex(x => x.serialNumber === t.serialNumber);
        if (idx !== -1) {
          allTools[idx] = { ...allTools[idx], ...t };
          allTools[idx]._durMs = durMs(allTools[idx]);
          applyFilters();
          renderKpis();
          renderOverduePanel();
        } else {
          loadData();
        }
      });
    });
    s.on('toolsUpdated', () => loadData());
    s.on('kiosk:part.borrow', () => {
      if (cfMainView === 'golden') loadCfGoldenParts();
    });
    s.on('kiosk:part.return', () => {
      if (cfMainView === 'golden') loadCfGoldenParts();
    });
    s.on('connect',      () => setTimeout(loadData, 600));
  } catch {}
}

/* ── Escape closes modals ───────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('checkoutModal').classList.contains('open')) closeCheckoutModal();
  if ($('returnModal').classList.contains('open'))   closeReturnModal();
});

/* ── Building context (read-only — set on home page) ─────────────────────
   activeBuilding reads suite.building.v1; badge injected by /js/building.js */
  initRegisterViewStrip();
  initCfGoldenActions();
  await loadData();
  connectSocket();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadData();
  });