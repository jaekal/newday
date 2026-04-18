/**
 * public/cf/cf-shell.js
 * Shared runtime for every Command Floor page.
 * Handles: nav activation · live clock · count-up KPIs · sparklines · category pills
 */
'use strict';

/* ── Live clock ──────────────────────────────────────────────────── */
export function startLiveClock(id = 'cfLiveClock') {
  const el = document.getElementById(id);
  if (!el) return;
  const tick = () => { el.textContent = new Date().toTimeString().slice(0, 8); };
  tick();
  setInterval(tick, 1000);
}

/* ── KPI count-up ────────────────────────────────────────────────── */
export function countUp(id, target, { barId, barPct, delay = 0, format = 'number' } = {}) {
  const el  = document.getElementById(id);
  const bar = barId ? document.getElementById(barId) : null;
  if (!el) return;

  const dur = 700;
  let start = null;

  setTimeout(() => {
    requestAnimationFrame(function step(ts) {
      if (!start) start = ts;
      const p    = Math.min((ts - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const val  = Math.round(ease * target);
      el.textContent = format === 'money'
        ? '$' + val.toLocaleString()
        : val.toLocaleString();
      if (bar && barPct != null) bar.style.width = (ease * barPct) + '%';
      if (p < 1) requestAnimationFrame(step);
    });
  }, delay);
}

/* ── Sparkline builder ───────────────────────────────────────────── */
export function buildSparkline(data, status) {
  const W = 64, H = 24, pad = 2;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = pad + i * (W - 2 * pad) / (data.length - 1);
    const y = H - pad - (v - min) / range * (H - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const color = status === 'crit' ? '#EF4444' : status === 'warn' ? '#F59E0B' : '#00B4D8';
  const lastPt = pts.split(' ').at(-1).split(',');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" class="cf-spark-line"/>
    <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="2" fill="${color}"
      style="opacity:0;animation:cf-count-up .3s ease 1.3s forwards"/>
  </svg>`;
}

/* ── Stock bar cell ──────────────────────────────────────────────── */
export function buildStockCell(qty, safe) {
  const pct = safe > 0 ? Math.min(100, Math.round(qty / safe * 100)) : 100;
  const cls = pct <= 0 ? 'crit' : pct < 60 ? 'warn' : 'ok';
  return `<div class="cf-stock-cell">
    <div class="cf-stock-bar-wrap">
      <div class="cf-stock-bar ${cls}" style="width:${pct}%"></div>
    </div>
    <span class="cf-stock-num ${cls}">${qty.toLocaleString()}</span>
  </div>`;
}

/* ── Status pill ─────────────────────────────────────────────────── */
export function statusPill(status, label) {
  const map = {
    ok:   ['ok',   label || 'In stock'],
    warn: ['warn', label || 'Low stock'],
    crit: ['crit', label || 'Critical'],
    ord:  ['ord',  label || 'Ordered'],
    out:  ['out',  label || 'Checked out'],
    available: ['ok', 'Available'],
    'being used': ['out', 'Checked out'],
  };
  const [cls, lbl] = map[status] || ['ok', label || status];
  return `<span class="cf-pill ${cls}"><span class="cf-pill-dot"></span>${esc(lbl)}</span>`;
}

/* ── Category filter pills ───────────────────────────────────────── */
export function initCategoryFilter(stripId, tableRenderFn) {
  const strip = document.getElementById(stripId);
  if (!strip) return;
  strip.addEventListener('click', e => {
    const pill = e.target.closest('[data-cat]');
    if (!pill) return;
    strip.querySelectorAll('[data-cat]').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    tableRenderFn(pill.dataset.cat);
  });
}

/* ── Pagination ──────────────────────────────────────────────────── */
export function initPagination(btnContainerId, onPage) {
  const container = document.getElementById(btnContainerId);
  if (!container) return;
  container.addEventListener('click', e => {
    const btn = e.target.closest('.cf-pg-btn[data-page]');
    if (!btn) return;
    container.querySelectorAll('.cf-pg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onPage(parseInt(btn.dataset.page, 10));
  });
}

/* ── Rail nav activation ─────────────────────────────────────────── */
export function initRailNav() {
  const items = document.querySelectorAll('.cf-nav-item');
  items.forEach(item => {
    item.addEventListener('click', () => {
      items.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
    // Activate current page by href match
    const href = item.getAttribute('href') || item.dataset.href;
    if (href && window.location.pathname.startsWith(href)) {
      item.classList.add('active');
    }
  });
}

/* ── Row sweep micro-interaction ────────────────────────────────── */
export function sweepRow(trEl) {
  if (!trEl) return;
  trEl.classList.add('row-sweep');
  setTimeout(() => trEl.classList.remove('row-sweep'), 1200);
}

/* ── Socket live update hook ─────────────────────────────────────── */
export function connectCFSocket(handlers = {}) {
  try {
    const socket = window.io?.({ withCredentials: true });
    if (!socket) return;
    Object.entries(handlers).forEach(([evt, fn]) => socket.on(evt, fn));
    return socket;
  } catch { /* socket not available */ }
}

/* ── Escape HTML ─────────────────────────────────────────────────── */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

/* ── Format time ─────────────────────────────────────────────────── */
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}
