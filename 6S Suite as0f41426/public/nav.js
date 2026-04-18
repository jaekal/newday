/**
 * nav.js  — 6S Tool Suite shared navigation script
 *
 * Responsibilities:
 *  1. Theme persistence  — reads/writes localStorage 'themeSelector' on EVERY page,
 *     including pages that have no <select id="themeSelector"> (kiosk, audits, etc.)
 *  2. Keyboard shortcut overlay  — press '?' anywhere (outside inputs) to reveal cheat-sheet
 *  3. Cmd-K / Ctrl-K global search palette stub
 *     (Wire to /search/api once you build the palette UI)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'themeSelector';
  const DEFAULT_THEME = 'theme-command';
  const LEGACY_THEME_MAP = {
    'theme-light': 'theme-atlas',
    'theme-dark': 'theme-carbon',
    'theme-mint': 'theme-grove',
    'theme-ocean': 'theme-harbor',
    'theme-sunset': 'theme-dusk',
    'theme-forest': 'theme-grove',
    'theme-charcoal': 'theme-slate',
    'theme-lavender': 'theme-orchid',
    'theme-neon': 'theme-pulse',
  };
  const ALL_THEMES = [
    'theme-command',
    'theme-beacon',
    'theme-atlas',
    'theme-carbon',
    'theme-grove',
    'theme-ember',
    'theme-harbor',
    'theme-slate',
    'theme-orchid',
    'theme-dusk',
    'theme-pulse',
    'theme-highcontrast',
  ];

  function normalizeTheme(theme) {
    return LEGACY_THEME_MAP[theme] || theme || DEFAULT_THEME;
  }

  /* ─── 1. THEME PERSISTENCE ─────────────────────────────────────────── */

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    const safe = ALL_THEMES.includes(normalized) ? normalized : DEFAULT_THEME;
    document.documentElement.className = safe;
    return safe;
  }

  function syncSelectEl(theme) {
    const sel = document.getElementById('themeSelector');
    if (sel) sel.value = theme;
  }

  // Apply saved theme immediately (before DOMContentLoaded) to avoid flash
  const savedTheme = applyTheme(localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME);
  localStorage.setItem(STORAGE_KEY, savedTheme);

  document.addEventListener('DOMContentLoaded', function () {
    syncSelectEl(savedTheme);

    const sel = document.getElementById('themeSelector');
    if (sel) {
      sel.addEventListener('change', function (e) {
        const theme = applyTheme(e.target.value);
        localStorage.setItem(STORAGE_KEY, theme);
        syncSelectEl(theme);
      });
    }

    /* ─── 2. KEYBOARD SHORTCUT OVERLAY ──────────────────────────────── */

    injectShortcutOverlay();
    document.addEventListener('keydown', function (e) {
      const typing = !!e.target.closest('input, textarea, select, [contenteditable]');

      // '?' → toggle shortcut overlay
      if (!typing && e.key === '?') {
        e.preventDefault();
        toggleShortcutOverlay();
      }

      // Escape → close overlay
      if (e.key === 'Escape') {
        closeShortcutOverlay();
      }

      // Cmd-K / Ctrl-K → global search (placeholder: focus #search if present)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openGlobalSearch();
      }
    });

    /* ─── 3. ROLE-CLASS ON BODY ──────────────────────────────────────── */
    // Fetch whoami once and stamp body[data-role=...] so CSS data-role selectors
    // can gate visibility without JS flicker.
    fetch('/auth/whoami', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.user) return;
        const role = (j.user.role || '').toLowerCase();
        document.body.dataset.role = role;
        // Also mark each [data-role] element immediately
        document.querySelectorAll('[data-role]').forEach(function (el) {
          const allowed = el.dataset.role.split(',').map(function (s) { return s.trim(); });
          if (!allowed.includes(role)) el.style.display = 'none';
        });
      })
      .catch(function () { /* not logged in or endpoint unavailable */ });

    ensureNotificationBell();
  });

  /* ─── SHORTCUT OVERLAY HELPERS ─────────────────────────────────────── */

  function injectShortcutOverlay() {
    if (document.getElementById('suite-shortcut-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'suite-shortcut-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Keyboard shortcuts');
    overlay.style.cssText = [
      'display:none;position:fixed;inset:0;z-index:99999',
      'background:rgba(0,0,0,.55);align-items:center;justify-content:center',
    ].join(';');

    overlay.innerHTML = [
      '<div style="background:var(--surface-strong,#fff);color:var(--fg,#111);',
        'border:1px solid var(--border,#ddd);border-radius:.8rem;padding:1.5rem;',
        'max-width:440px;width:90%;box-shadow:0 24px 48px rgba(0,0,0,.3)">',
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">',
          '<strong style="font-size:1.1rem">⌨ Keyboard Shortcuts</strong>',
          '<button id="suite-shortcut-close" style="background:none;border:none;cursor:pointer;',
            'font-size:1.2rem;color:var(--fg-muted,#888);padding:.25rem .5rem">✕</button>',
        '</div>',
        '<table style="width:100%;border-collapse:collapse;font-size:.9rem">',
          '<thead><tr>',
            '<th style="text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--border,#ddd);color:var(--fg-muted,#888)">Key</th>',
            '<th style="text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--border,#ddd);color:var(--fg-muted,#888)">Action</th>',
          '</tr></thead>',
          '<tbody>',
            shortcutRow('?',         'Toggle this help panel'),
            shortcutRow('Esc',       'Close overlays / modals'),
            shortcutRow('⌘K / Ctrl K', 'Global search'),
            shortcutRow('/',         'Focus search (Screwdriver)'),
            shortcutRow('E',         'Export CSV (Screwdriver)'),
            shortcutRow('L',         'Toggle legend (Screwdriver)'),
            shortcutRow('S',         'Toggle summary (Screwdriver)'),
          '</tbody>',
        '</table>',
      '</div>',
    ].join('');

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeShortcutOverlay();
    });

    document.body.appendChild(overlay);

    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'suite-shortcut-close') closeShortcutOverlay();
    });
  }

  function shortcutRow(key, desc) {
    return [
      '<tr>',
        '<td style="padding:.3rem .5rem;font-family:monospace;background:var(--surface,#f8f8f8);',
          'border-radius:.3rem;white-space:nowrap;border-bottom:1px solid var(--border,#eee)">',
          key,
        '</td>',
        '<td style="padding:.3rem .5rem .3rem .75rem;border-bottom:1px solid var(--border,#eee)">',
          desc,
        '</td>',
      '</tr>',
    ].join('');
  }

  function toggleShortcutOverlay() {
    const el = document.getElementById('suite-shortcut-overlay');
    if (!el) return;
    const visible = el.style.display === 'flex';
    el.style.display = visible ? 'none' : 'flex';
  }

  function closeShortcutOverlay() {
    const el = document.getElementById('suite-shortcut-overlay');
    if (el) el.style.display = 'none';
  }

  /* ─── GLOBAL SEARCH STUB ────────────────────────────────────────────── */

  function openGlobalSearch() {
    // If a #search input exists on the current page, just focus it
    const localSearch = document.getElementById('search') ||
                        document.getElementById('filterSearch') ||
                        document.getElementById('searchInput');
    if (localSearch) {
      localSearch.focus();
      localSearch.select();
      return;
    }
    // Otherwise navigate to the search route (implement /search later)
    // window.location.href = '/search';
  }

  function shouldEnableNotificationBell() {
    const path = String(window.location.pathname || '');
    const disabledPrefixes = [
      '/home',
      '/cf',
      '/kiosk',
      '/projects',
      '/expiration',
      '/calibration-calendar',
    ];
    if (disabledPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix))) {
      return false;
    }

    const enabledPrefixes = [
      '/asset-catalog',
      '/inventory',
      '/screwdriver',
      '/transfers',
      '/admin',
      '/history',
      '/resources',
      '/audits',
      '/esd',
    ];
    return enabledPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix));
  }

  function ensureNotificationBell() {
    if (!shouldEnableNotificationBell()) return;
    if (document.getElementById('suite-notif-bell')) return;
    if (document.querySelector('script[data-bell-loader="true"]')) return;

    function loadBell() {
      if (document.querySelector('script[data-bell-loader="true"]')) return;
      const script = document.createElement('script');
      script.src = '/notifications/bell.js';
      script.defer = true;
      script.dataset.bellLoader = 'true';
      document.head.appendChild(script);
    }

    if (window.suiteIcons) {
      loadBell();
      return;
    }
    if (document.querySelector('script[data-suite-icons-loader="true"]')) return;
    const icons = document.createElement('script');
    icons.src = '/js/suite-icons.js';
    icons.defer = true;
    icons.dataset.suiteIconsLoader = 'true';
    icons.onload = loadBell;
    icons.onerror = loadBell;
    document.head.appendChild(icons);
  }
})();
