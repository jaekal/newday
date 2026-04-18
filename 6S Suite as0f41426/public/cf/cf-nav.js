/**
 * public/cf/cf-nav.js
 * Shared Command Floor rail navigation.
 *
 * Usage — add ONE data attribute to your <nav> placeholder and import this module:
 *
 *   HTML:   <nav id="cfRailNav" data-active="/cf/inventory"></nav>
 *   Script: <script type="module" src="/cf/cf-nav.js"></script>
 *
 * The module reads data-active (or falls back to window.location.pathname),
 * renders the full rail HTML, then starts the live clock.
 * Badge counts (rail counts) are updated by each page's own JS via the
 * exported setRailBadge() helper.
 */
'use strict';

/* ── SVG icon snippets ──────────────────────────────────────────── */
const ICONS = {
  grid:     `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  box:      `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
  tool:     `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  asset:    `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
  clock:    `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  home:     `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  trend:    `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  edit:     `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  screwdriver: `<svg class="cf-ni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};

/* ── Nav config — single source of truth ───────────────────────── */
const NAV_SECTIONS = [
  {
    label: 'Command Floor',
    items: [
      { href: '/cf/inventory', icon: 'box',   label: 'Inventory',     badgeId: 'railLowCount' },
      { href: '/cf/tools',     icon: 'tool',  label: 'Tool tracking', badgeId: 'railOutCount' },
      { href: '/cf/assets',    icon: 'asset', label: 'Assets',        badgeId: 'railDueCount' },
      { href: '/cf/management', icon: 'clock', label: 'Management' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/inventory/Inventory.html',     icon: 'trend', label: 'Full inventory' },
      { href: '/asset-catalog',                icon: 'edit',  label: 'Asset catalog' },
      { href: '/screwdriver/screwdriver.html', icon: 'screwdriver', label: 'Screwdriver tool' },
    ],
  },
  {
    label: 'Suite',
    items: [
      { href: '/home', icon: 'home', label: 'Suite home' },
    ],
  },
];

/* ── Render ─────────────────────────────────────────────────────── */
function renderRail(activePath) {
  const brandSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="#0F1923" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

  let html = `
    <div class="cf-rail-brand">
      <div class="cf-brand-icon">${brandSvg}</div>
      <div>
        <div class="cf-brand-name">Command Floor</div>
        <div class="cf-brand-sub">Ops Intelligence Suite</div>
      </div>
    </div>`;

  for (const section of NAV_SECTIONS) {
    html += `<div class="cf-rail-section">
      <div class="cf-rail-section-label">${section.label}</div>`;

    for (const item of section.items) {
      const isActive = activePath.startsWith(item.href) && item.href !== '/home';
      const activeClass = isActive ? ' active' : '';
      const badge = item.badgeId
        ? `<span class="cf-nav-count alert" id="${item.badgeId}" style="display:none">—</span>`
        : '';
      html += `
        <a class="cf-nav-item${activeClass}" href="${item.href}">
          ${ICONS[item.icon] || ''}
          <span class="cf-ni-label">${item.label}</span>
          ${badge}
        </a>`;
    }
    html += `</div>`;
  }

  html += `
    <div class="cf-rail-footer">
      <div class="cf-live-dot" aria-hidden="true"></div>
      <span class="cf-live-label">Live sync</span>
      <span class="cf-live-time" id="cfLiveClock">—</span>
    </div>`;

  return html;
}

/* ── Mount & start clock ────────────────────────────────────────── */
function mount() {
  const nav = document.getElementById('cfRailNav');
  if (!nav) return;
  const activePath = nav.dataset.active || window.location.pathname;
  nav.innerHTML = renderRail(activePath);

  // Live clock
  const clockEl = document.getElementById('cfLiveClock');
  if (clockEl) {
    const tick = () => { clockEl.textContent = new Date().toTimeString().slice(0, 8); };
    tick();
    setInterval(tick, 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}

/* ── Public helper — pages call this to update badge counts ─────── */
export function setRailBadge(id, count, visible) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent   = count;
  el.style.display = visible ? '' : 'none';
}
