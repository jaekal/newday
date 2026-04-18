/**
 * public/cf/inventory/inventory.js
 * Command Floor — Inventory page module.
 * Fetches live data from the existing /inventory API endpoint.
 */
'use strict';

import {
  startLiveClock, countUp, buildSparkline,
  buildStockCell, statusPill, esc
} from '/cf/cf-shell.js';

/* ── State ─────────────────────────────────────────────────────── */
let allItems      = [];
let filteredItems = [];
let activeFilter  = 'all';
let activeCat     = '';
let searchQ       = '';
let activeBuilding = (() => { try { return localStorage.getItem('suite.building.v1') || 'Bldg-350'; } catch { return 'Bldg-350'; } })();
let sortCol       = 'ItemCode';
let sortAsc       = true;
let page          = 1;
const PAGE_LEN    = 15;

/* Generate a deterministic mock 30-day trend from live qty data */
function mockTrend(item) {
  const start  = Math.max(0, Number(item.OnHandQty) + 80);
  const points = 10;
  const data   = [];
  for (let i = 0; i < points; i++) {
    const noise = Math.round((Math.random() - 0.5) * 10);
    data.push(Math.max(0, Math.round(start - (i / points) * (start - Number(item.OnHandQty))) + noise));
  }
  return data;
}

function stockStatus(item) {
  const qty  = Number(item.OnHandQty    || 0);
  const safe = Number(item.SafetyLevelQty || 0);
  if (item.OrderStatus === 'Ordered') return 'ord';
  if (qty <= 0)                       return 'crit';
  if (safe > 0 && qty < safe)         return 'warn';
  return 'ok';
}

/* ── DOM helpers ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function syncKpiState() {
  ['cf-kpi-total-card', 'cf-kpi-low-card', 'cf-kpi-crit-card', 'cf-kpi-ord-card'].forEach((id) => {
    $(id)?.classList.remove('is-active');
  });
  const activeId = activeFilter === 'warn' ? 'cf-kpi-low-card'
    : activeFilter === 'crit' ? 'cf-kpi-crit-card'
    : activeFilter === 'ord' ? 'cf-kpi-ord-card'
    : 'cf-kpi-total-card';
  $(activeId)?.classList.add('is-active');
}

/* ── Fetch ──────────────────────────────────────────────────────── */
async function loadInventory() {
  try {
    const qs = activeBuilding && activeBuilding !== 'all' ? `?building=${encodeURIComponent(activeBuilding)}` : '';
    const r = await fetch(`/inventory/${qs}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    allItems = Array.isArray(data) ? data : (data?.items || []);
  } catch (e) {
    console.error('[CF Inventory] fetch failed:', e);
    allItems = [];
  }
  applyFilters();
  renderKpis();
  renderReorderQueue();
  updateCategoryPills();
  updateUserAvatar();
}

/* ── KPI bar ────────────────────────────────────────────────────── */
function renderKpis() {
  const total = allItems.length;
  const low   = allItems.filter(i => stockStatus(i) === 'warn').length;
  const crit  = allItems.filter(i => stockStatus(i) === 'crit').length;
  const ord   = allItems.filter(i => stockStatus(i) === 'ord').length;

  countUp('kv-total', total, { barId: 'bar-total', barPct: 100,                                         delay: 100 });
  countUp('kv-low',   low,   { barId: 'bar-low',   barPct: total ? Math.round(low  / total * 100) : 0,  delay: 200 });
  countUp('kv-crit',  crit,  { barId: 'bar-crit',  barPct: total ? Math.round(crit / total * 100) : 0,  delay: 300 });
  countUp('kv-ord',   ord,   { barId: 'bar-ord',   barPct: total ? Math.round(ord  / total * 100) : 0,  delay: 400 });

  const ks = $('ks-total');
  if (ks) {
    const cats = new Set(allItems.map(i => i.Category || i.category || '')).size;
    ks.textContent = `across ${cats} categories`;
  }

  const crumb = $('topbarCrumb');
  if (crumb) crumb.textContent = `/ Stock management · ${total.toLocaleString()} SKUs`;

  const rail = $('railLowCount');
  if (rail) { rail.textContent = low + crit; }
  syncKpiState();
}

/* ── Filters ────────────────────────────────────────────────────── */
function applyFilters() {
  const q = searchQ.toLowerCase().trim();
  filteredItems = allItems.filter(item => {
    const st  = stockStatus(item);
    const cat = (item.Category || item.category || '').trim();

    if (activeCat && cat !== activeCat)               return false;
    if (activeFilter === 'warn' && st !== 'warn')     return false;
    if (activeFilter === 'crit' && st !== 'crit')     return false;
    if (activeFilter === 'ord'  && st !== 'ord')      return false;

    if (q) {
      const hay = [item.ItemCode, item.Description, item.Vendor, cat, item.PartNumber]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filteredItems.sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (sortCol === 'OnHandQty' || sortCol === 'SafetyLevelQty') {
      av = Number(av); bv = Number(bv);
      return sortAsc ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortAsc ? cmp : -cmp;
  });

  page = 1;
  syncKpiState();
  renderTable();
}

/* ── Table render ───────────────────────────────────────────────── */
function renderTable() {
  const tbody  = $('skuBody');
  const pgInfo = $('pgInfo');
  const count  = $('skuCount');
  if (!tbody) return;

  const total = filteredItems.length;
  const start = (page - 1) * PAGE_LEN;
  const slice = filteredItems.slice(start, start + PAGE_LEN);

  if (count) count.textContent = `showing ${total.toLocaleString()}`;
  if (pgInfo) pgInfo.textContent = total === 0
    ? 'No results'
    : `${start + 1}–${Math.min(start + PAGE_LEN, total)} of ${total.toLocaleString()}`;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:#94A3B8;font-family:'IBM Plex Sans',sans-serif">No items match the current filters.</td></tr>`;
    renderPagination(total);
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  slice.forEach((item, rowIdx) => {
    const st     = stockStatus(item);
    const qty    = Number(item.OnHandQty    || 0);
    const safe   = Number(item.SafetyLevelQty || 0);
    const pct    = safe > 0 ? Math.min(100, Math.round(qty / safe * 100)) : 100;
    const barCls = pct <= 0 ? 'crit' : pct < 60 ? 'warn' : 'ok';
    const trend  = mockTrend(item);
    const rowCls = st === 'crit' ? 'row-crit' : st === 'warn' ? 'row-warn' : '';
    const isNew  = rowIdx === 0 && page === 1;

    const actionBtn = (st === 'crit' || st === 'warn')
      ? `<button class="cf-chip" style="background:rgba(227,100,20,.1);color:#9A3412;border-color:rgba(227,100,20,.2);font-size:11px;padding:2px 8px" data-reorder="${esc(item.ItemCode)}">Reorder</button>`
      : `<span style="font-size:11px;color:#CBD5E1;font-family:'IBM Plex Mono',monospace">—</span>`;

    const tr = document.createElement('tr');
    tr.className    = rowCls + (isNew ? ' row-sweep' : '');
    tr.dataset.code = item.ItemCode || '';
    tr.innerHTML = `
      <td class="mono">${esc(item.ItemCode || '—')}</td>
      <td style="font-family:'IBM Plex Sans',sans-serif">${esc(item.Description || '—')}</td>
      <td class="muted" style="font-size:12px">${esc(item.Category || item.category || '—')}</td>
      <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:12px">${qty.toLocaleString()}</td>
      <td style="text-align:right;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#94A3B8">${safe || '—'}</td>
      <td>${buildStockCell(qty, safe)}</td>
      <td>${statusPill(st)}</td>
      <td style="padding:9px 8px">${buildSparkline(trend, st)}</td>
      <td>${actionBtn}</td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  renderPagination(total);

  tbody.querySelectorAll('[data-reorder]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addToReorderQueue(btn.dataset.reorder);
    });
  });
}

/* ── Pagination ─────────────────────────────────────────────────── */
function renderPagination(total) {
  const container = $('pgBtns');
  if (!container) return;
  const pages = Math.max(1, Math.ceil(total / PAGE_LEN));
  container.innerHTML = '';

  const mkBtn = (label, p, active, disabled, isSvg) => {
    const btn = document.createElement('button');
    btn.className = 'cf-pg-btn' + (active ? ' active' : '');
    btn.disabled  = disabled;
    btn.innerHTML = label;
    btn.dataset.page = p;
    return btn;
  };

  const frag    = document.createDocumentFragment();
  const prevSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
  const nextSvg = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

  frag.appendChild(mkBtn(prevSvg, page - 1, false, page === 1, true));
  const lo = Math.max(1, page - 2), hi = Math.min(pages, page + 2);
  if (lo > 1) frag.appendChild(mkBtn('1', 1, false, false, false));
  if (lo > 2) { const el = document.createElement('button'); el.className = 'cf-pg-btn'; el.textContent = '…'; el.disabled = true; frag.appendChild(el); }
  for (let p = lo; p <= hi; p++) frag.appendChild(mkBtn(p, p, p === page, false, false));
  if (hi < pages - 1) { const el = document.createElement('button'); el.className = 'cf-pg-btn'; el.textContent = '…'; el.disabled = true; frag.appendChild(el); }
  if (hi < pages) frag.appendChild(mkBtn(pages, pages, false, false, false));
  frag.appendChild(mkBtn(nextSvg, page + 1, false, page >= pages, true));

  container.appendChild(frag);
  container.addEventListener('click', e => {
    const btn = e.target.closest('.cf-pg-btn[data-page]');
    if (!btn || btn.disabled) return;
    page = parseInt(btn.dataset.page, 10);
    renderTable();
  });
}

/* ── Reorder queue ──────────────────────────────────────────────── */
let reorderQueue = new Set();

function buildReorderQueue() {
  allItems.forEach(item => {
    const st = stockStatus(item);
    if (st === 'crit' || st === 'warn') reorderQueue.add(item.ItemCode);
  });
}

function addToReorderQueue(code) {
  reorderQueue.add(code);
  renderReorderQueue();
}

function renderReorderQueue() {
  const list  = $('reorderList');
  const count = $('reorderCount');
  if (!list) return;

  const items = allItems.filter(i => reorderQueue.has(i.ItemCode));
  if (count) count.textContent = `${items.length} pending`;

  const rail = $('railLowCount');
  if (rail) rail.textContent = items.length;

  if (!items.length) {
    list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94A3B8;font-size:12px;font-family:'IBM Plex Sans',sans-serif">No items in queue.<br>Reorder buttons will add items here.</div>`;
    return;
  }

  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  items.forEach(item => {
    const st      = stockStatus(item);
    const qty     = Number(item.OnHandQty    || 0);
    const safe    = Number(item.SafetyLevelQty || 0);
    const pct     = safe > 0 ? Math.min(100, Math.round(qty / safe * 100)) : 0;
    const isCrit  = st === 'crit';
    const suggest = Math.max(10, safe > 0 ? safe * 3 : 20);

    const div = document.createElement('div');
    div.className = 'cf-rq-item';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="cf-rq-top">
        <span class="cf-rq-sku">${esc(item.ItemCode)}</span>
        <span class="cf-pill ${isCrit ? 'crit' : 'warn'}" style="font-size:10px">
          <span class="cf-pill-dot"></span>${isCrit ? 'Critical' : 'Low'}
        </span>
      </div>
      <div class="cf-rq-name">${esc(item.Description || item.ItemCode)}</div>
      <div class="cf-rq-meta">
        <span class="cf-rq-qty">
          On hand: <span>${qty}</span> · Suggest: <span class="suggest">${Math.round(suggest)}</span>
        </span>
        <button class="cf-rq-action" data-order="${esc(item.ItemCode)}" data-qty="${Math.round(suggest)}">
          Order ${Math.round(suggest)}
        </button>
      </div>
      <div class="cf-rq-bar-wrap">
        <div class="cf-rq-bar ${isCrit ? 'crit' : 'warn'}" style="width:${pct}%"></div>
      </div>`;
    frag.appendChild(div);
  });

  list.appendChild(frag);
}

/* ── Category pills — warn/crit decorators ─────────────────────── */
function updateCategoryPills() {
  const catStatus = {};
  allItems.forEach(item => {
    const cat = (item.Category || item.category || '').trim();
    const st  = stockStatus(item);
    if (!catStatus[cat] || st === 'crit') catStatus[cat] = st;
    else if (catStatus[cat] !== 'crit' && st === 'warn') catStatus[cat] = st;
  });

  document.querySelectorAll('[data-cat]:not([data-cat=""])').forEach(pill => {
    const cat = pill.dataset.cat;
    pill.classList.remove('warn', 'crit');
    if (catStatus[cat] === 'crit')      pill.classList.add('crit');
    else if (catStatus[cat] === 'warn') pill.classList.add('warn');
  });
}

/* ── User avatar ────────────────────────────────────────────────── */
async function updateUserAvatar() {
  try {
    const r    = await fetch('/auth/whoami', { credentials: 'include' });
    if (!r.ok) return;
    const data = await r.json();
    const name = data?.user?.name || data?.user?.id || data?.name || data?.id || '';
    const el   = $('cfAvatar');
    if (el && name) el.textContent = name.slice(0, 2).toUpperCase();
  } catch { /* non-critical */ }
}

/* ── Sort headers ───────────────────────────────────────────────── */
function initSortHeaders() {
  document.querySelectorAll('.cf-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) { sortAsc = !sortAsc; }
      else { sortCol = col; sortAsc = true; }
      document.querySelectorAll('.cf-table thead th').forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      applyFilters();
    });
  });
}

/* ── Tab filter strip ───────────────────────────────────────────── */
function initTabStrip() {
  $('skuTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('[data-filter]');
    if (!tab) return;
    $('skuTabs').querySelectorAll('[data-filter]').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
    activeFilter = tab.dataset.filter;
    applyFilters();
  });
}

function initKpiCards() {
  const cardMap = {
    'cf-kpi-total-card': 'all',
    'cf-kpi-low-card': 'warn',
    'cf-kpi-crit-card': 'crit',
    'cf-kpi-ord-card': 'ord',
  };
  Object.entries(cardMap).forEach(([id, filter]) => {
    const el = $(id);
    if (!el) return;
    const apply = () => {
      activeFilter = filter;
      applyFilters();
    };
    el.addEventListener('click', apply);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        apply();
      }
    });
  });
}

/* ── Category strip ─────────────────────────────────────────────── */
function initCatStrip() {
  $('catStrip')?.addEventListener('click', e => {
    const pill = e.target.closest('[data-cat]');
    if (!pill) return;
    $('catStrip').querySelectorAll('[data-cat]').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeCat = pill.dataset.cat;
    applyFilters();
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

/* ── Export CSV ─────────────────────────────────────────────────── */
function initExport() {
  $('exportBtn')?.addEventListener('click', () => {
    const headers = ['SKU', 'Description', 'Category', 'On Hand', 'Safety Stock', 'Status', 'Vendor'];
    const rows    = filteredItems.map(i => [
      i.ItemCode, i.Description, i.Category || i.category || '',
      i.OnHandQty, i.SafetyLevelQty, stockStatus(i), i.Vendor || '',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a   = Object.assign(document.createElement('a'), {
      href: url,
      download: `inventory_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
}

/* ── Reorder queue buttons ──────────────────────────────────────── */
function initReorderButtons() {
  $('clearQueueBtn')?.addEventListener('click', () => {
    reorderQueue.clear();
    renderReorderQueue();
  });

  $('submitOrdersBtn')?.addEventListener('click', () => {
    if (!reorderQueue.size) return;
    window.location.href = '/inventory/Inventory.html';
  });
}

/* ── Building context (read-only — set on home page) ────────────────────────
   activeBuilding reads suite.building.v1; badge injected by /js/building.js */

function connectSocket() {
  try {
    const socket = window.io?.('/', { withCredentials: true });
    if (!socket) return;
    ['inventoryUpdated'].forEach((evt) => {
      socket.on(evt, () => {
        loadInventory();
      });
    });
  } catch (err) {
    console.warn('[CF Inventory] socket unavailable:', err);
  }
}

async function initPage() {
  startLiveClock();
  initSortHeaders();
  initTabStrip();
  initKpiCards();
  initCatStrip();
  initSearch();
  initExport();
  initReorderButtons();
  await loadInventory();
  buildReorderQueue();
  renderReorderQueue();
  connectSocket();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadInventory();
    }
  });
}

initPage();
