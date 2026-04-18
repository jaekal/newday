import { renderTools }       from './render.js';
import { applyFilters }      from './filters.js';
import { state }             from './state.js';
import {
  getSession,
  adminLogout,
  apiBulkAction,
  adminLogin
}                            from './api.js';
import { debounce }          from './helpers.js';
import { fetchAndRenderAll } from './loader.js';

export function setupUI() {
  initThemeSwitcher();
  initFilters();
  initViewToggle();
  initSortDirection();
  initClearFilters();
  initBulkActions();
  initCSVExport();
  initSummaryToggle();
  initLegendToggle();
  initExpandAll();
  initCollapseAll();
  initAdminActions();
  initializeSession();
  initOverdueToggle();
  initInlineCheckoutReset();
  updateFilterTogglePill();

  // ── KPI bar click-to-filter ─────────────────────────────────────────────
  document.getElementById('kpi-avail-card')?.addEventListener('click', () => {
    const sel = document.getElementById('statusFilter');
    if (sel) {
      sel.value = 'in inventory';
      sel.dispatchEvent(new Event('change'));
    }
  });

  document.getElementById('kpi-out-card')?.addEventListener('click', () => {
    const sel = document.getElementById('statusFilter');
    if (sel) {
      sel.value = 'being used';
      sel.dispatchEvent(new Event('change'));
    }
  });

  document.getElementById('kpi-cal-card')?.addEventListener('click', () => {
    const sel = document.getElementById('calibrationFilter');
    if (sel) {
      sel.value = 'Expiring Soon';
      sel.dispatchEvent(new Event('change'));
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTyping = target instanceof HTMLElement &&
      !!target.closest('input, textarea, select, [contenteditable="true"]');

    if (isTyping) return;

    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('search')?.focus();
    }
    if (e.key.toLowerCase() === 'e') document.getElementById('exportFiltered')?.click();
    if (e.key.toLowerCase() === 'l') document.getElementById('legendToggle')?.click();
    if (e.key.toLowerCase() === 's') document.getElementById('toggleSummary')?.click();
  });
}

function initInlineCheckoutReset() {
  const toolTiers = document.getElementById('toolTiers');
  if (!toolTiers) return;

  const prepareInput = (input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.autocomplete = 'off';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    input.value = '';
    input.dataset.userEdited = 'false';
  };

  const resetVisibleInlineInputs = ({ focus = false } = {}) => {
    const inputs = Array.from(toolTiers.querySelectorAll('.inline-op-input'));
    inputs.forEach(prepareInput);

    if (!focus) return;
    const visibleInput = inputs.find((input) =>
      input instanceof HTMLElement && input.offsetParent !== null
    );
    if (visibleInput instanceof HTMLInputElement) {
      visibleInput.focus();
    }
  };

  toolTiers.addEventListener('click', () => {
    window.setTimeout(() => resetVisibleInlineInputs({ focus: true }), 0);
  });

  toolTiers.addEventListener('focusin', (e) => {
    const input = e.target instanceof Element ? e.target.closest('.inline-op-input') : null;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.userEdited === 'true') return;
    prepareInput(input);
  });

  toolTiers.addEventListener('input', (e) => {
    const input = e.target instanceof Element ? e.target.closest('.inline-op-input') : null;
    if (!(input instanceof HTMLInputElement)) return;
    input.dataset.userEdited = input.value ? 'true' : 'false';
  });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.matches?.('.inline-op-input')) {
          prepareInput(node);
        }
        node.querySelectorAll?.('.inline-op-input').forEach(prepareInput);
      });
    }
  });

  observer.observe(toolTiers, { childList: true, subtree: true });
}

/** THEME SWITCHER */
export function initThemeSwitcher() {
  const sel   = document.getElementById('themeSelector');
  const saved = localStorage.getItem('themeSelector') || 'theme-command';
  document.documentElement.className = saved;

  if (sel instanceof HTMLSelectElement) {
    sel.value = saved;
    sel.addEventListener('change', e => {
      const target = e.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const theme = target.value;
      document.documentElement.className = theme;
      localStorage.setItem('themeSelector', theme);
    });
  }
}

function normalizeSerial(sn) {
  return (sn || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

function parseSerials(raw) {
  if (!raw) return [];
  const parts = raw.split(/[\s,;]+/);
  const uniq = new Set();
  for (const p of parts) {
    const n = normalizeSerial(p);
    if (n) uniq.add(n);
  }
  return Array.from(uniq);
}

function resetSearchUI() {
  const searchEl = document.getElementById('search');
  const multiPill = document.getElementById('searchMultiPill');

  if (searchEl instanceof HTMLTextAreaElement) {
    searchEl.value = '';
    searchEl.style.height = '';
  }

  if (multiPill instanceof HTMLElement) {
    multiPill.textContent = '';
    multiPill.style.display = 'none';
  }
}

function resetDropdownFilters() {
  ['classificationFilter', 'calibrationFilter', 'statusFilter', 'torqueFilter', 'sortFilter']
    .forEach(id => {
      const el = document.getElementById(id);
      if (
        el instanceof HTMLSelectElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        el.value = '';
        if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.style.height = '';
        }
      }
      localStorage.removeItem(id);
    });
}

function resetFilterState() {
  state.filters = {
    ...state.filters,
    search: '',
    searchSerials: new Set(),
    torque: '',
    classification: '',
    calibration: '',
    status: '',
    sort: '',
  };
  state.sortAsc = true;
}

function resetSortDirectionUI() {
  const dirBtn = document.getElementById('sortDirectionToggle');
  if (!dirBtn) return;
  dirBtn.textContent = '▲';
  dirBtn.setAttribute('aria-label', 'Sort ascending');
  dirBtn.title = 'Sort ascending';
}

function clearAllActiveFilters() {
  resetSearchUI();
  resetDropdownFilters();
  resetFilterState();
  resetSortDirectionUI();
  updateFilterTogglePill();
  applyFilters();
}

/** FILTERS — adaptive search */
export function initFilters() {
  const searchEl  = document.getElementById('search');
  const multiPill = document.getElementById('searchMultiPill');

  function updateMultiPill(count) {
    if (!(multiPill instanceof HTMLElement)) return;

    if (count > 1) {
      multiPill.textContent = `${count} serials`;
      multiPill.style.display = '';
    } else {
      multiPill.textContent = '';
      multiPill.style.display = 'none';
    }
  }

  if (searchEl instanceof HTMLTextAreaElement) {
    state.filters = state.filters || {};
    if (typeof state.filters.search !== 'string') state.filters.search = '';
    if (!(state.filters.searchSerials instanceof Set)) state.filters.searchSerials = new Set();

    const runSearchUpdate = () => {
      const raw = searchEl.value;
      const arr = parseSerials(raw);
      state.filters.search = raw;
      state.filters.searchSerials = new Set(arr);
      applyFilters();
      updateMultiPill(arr.length);
      updateFilterTogglePill();
    };

    const deb = debounce(runSearchUpdate, 200);

    searchEl.addEventListener('input', () => {
      deb();
      if (!searchEl.value.trim()) searchEl.style.height = '';
    });

    searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        setTimeout(runSearchUpdate, 0);
      }
    });

    searchEl.addEventListener('paste', () => {
      setTimeout(() => {
        runSearchUpdate();
        const arr = parseSerials(searchEl.value);
        if (arr.length > 1) {
          searchEl.style.height = 'auto';
          searchEl.style.height = Math.min(searchEl.scrollHeight, 80) + 'px';
        }
      }, 0);
    });
  }

  // Clear button now clears search + dropdown filters + sort state
  document.getElementById('clearSearch')?.addEventListener('click', () => {
    clearAllActiveFilters();
  });

  [
    { id: 'classificationFilter', key: 'classification' },
    { id: 'calibrationFilter',   key: 'calibration' },
    { id: 'statusFilter',        key: 'status' },
    { id: 'torqueFilter',        key: 'torque' },
    { id: 'sortFilter',          key: 'sort' }
  ].forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLSelectElement)) return;

    const saved = localStorage.getItem(id);
    if (saved !== null) el.value = saved;

    el.addEventListener('change', () => {
      localStorage.setItem(id, el.value);
      state.filters[key] = el.value;
      applyFilters();
      updateFilterTogglePill();
    });

    state.filters[key] = el.value;
  });
}

/** VIEW MODE TOGGLE */
export function initViewToggle() {
  const el = document.getElementById('viewToggle');
  if (!(el instanceof HTMLSelectElement)) return;

  el.value = localStorage.getItem('viewToggle') || el.value || 'grid';
  el.addEventListener('change', () => {
    localStorage.setItem('viewToggle', el.value);
    renderTools();
  });
}

/** SORT DIRECTION TOGGLE */
export function initSortDirection() {
  const btn = document.getElementById('sortDirectionToggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    state.sortAsc = !state.sortAsc;
    applyFilters();
  });
}

/** CLEAR ALL FILTERS */
export function initClearFilters() {
  document.getElementById('clearFilters')?.addEventListener('click', () => {
    clearAllActiveFilters();
  });
}

/** BULK CHECKOUT / RETURN */
export function initBulkActions() {
  document.getElementById('bulkCheckout')?.addEventListener('click', () => bulkAction('checkout'));
  document.getElementById('bulkReturn')?.addEventListener('click', () => bulkAction('return'));
}

/** CSV EXPORT */
export function initCSVExport() {
  document.getElementById('exportFiltered')?.addEventListener('click', () =>
    import('./helpers.js').then(m => m.exportCSV(state.filteredTools))
  );
}

/** SUMMARY TOGGLE */
export function initSummaryToggle() {
  const btn = document.getElementById('toggleSummary');
  const p   = document.getElementById('summaryPanel');
  if (!btn || !p) return;

  btn.addEventListener('click', () => {
    const isHidden = p.style.display === 'none' || !p.style.display;
    p.style.display = isHidden ? 'block' : 'none';
    btn.setAttribute('aria-expanded', String(isHidden));
  });
}

/** LEGEND TOGGLE */
export function initLegendToggle() {
  const btn   = document.getElementById('legendToggle');
  const panel = document.getElementById('legendPanel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const isHidden = window.getComputedStyle(panel).display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    btn.setAttribute('aria-expanded', String(isHidden));
  });
}

/** EXPAND / COLLAPSE ALL TIERS */
export function initExpandAll() {
  document.getElementById('expandAllTiers')?.addEventListener('click', () => toggleAllTiers(true));
}

export function initCollapseAll() {
  document.getElementById('collapseAllTiers')?.addEventListener('click', () => toggleAllTiers(false));
}

/** OVERDUE PANEL TOGGLE */
export function initOverdueToggle() {
  document.getElementById('overdueToggleBtn')?.addEventListener('click', () => {
    const body = document.getElementById('overdueBody');
    const btn = document.getElementById('overdueToggleBtn');
    if (!body || !btn) return;

    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    btn.textContent = hidden ? '▲' : '▼';
  });
}

/** FILTER TOGGLE */
export function initAdminActions() {
  const toggleBtn  = document.getElementById('filterToggleBtn');
  const filtersRow = document.getElementById('sdFiltersRow');
  if (!toggleBtn || !filtersRow) return;

  const saved = localStorage.getItem('sd:filtersOpen');
  const open  = saved === null ? true : saved === '1';

  if (!open) {
    filtersRow.classList.add('collapsed');
    toggleBtn.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    const isOpen = !filtersRow.classList.contains('collapsed');
    filtersRow.classList.toggle('collapsed', isOpen);
    toggleBtn.classList.toggle('open', !isOpen);
    toggleBtn.setAttribute('aria-expanded', String(!isOpen));
    updateFilterTogglePill();
    localStorage.setItem('sd:filtersOpen', isOpen ? '0' : '1');
  });
}

/** Mark filter toggle pill blue when any filter or search is active */
export function updateFilterTogglePill() {
  const toggleBtn = document.getElementById('filterToggleBtn');
  if (!toggleBtn) return;

  const searchActive = !!document.getElementById('search')?.value.trim();
  const dropdownActive = [
    'classificationFilter',
    'statusFilter',
    'calibrationFilter',
    'torqueFilter',
    'sortFilter'
  ].some(id => {
    const el = document.getElementById(id);
    return (
      (el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.value !== ''
    );
  });

  toggleBtn.classList.toggle('filters-on', searchActive || dropdownActive);
}

async function initializeSession() {
  try {
    const sess = await getSession();
    const user = sess?.user || null;
    state.isAdmin = !!user && (user.role === 'admin');

    const panel = document.getElementById('adminPanel');
    if (panel) panel.style.display = state.isAdmin ? 'block' : 'none';

    if (state.isAdmin) document.body.classList.add('is-admin');
  } catch (err) {
    console.error('Session init error:', err);
  }
}

// loginModal removed
export function openModal() {}
export function closeModal() {}

function toggleAllTiers(open) {
  const contents = document.querySelectorAll('.tier-content');
  const arrows   = document.querySelectorAll('.tier-header .arrow');

  contents.forEach((c, i) => {
    if (!(c instanceof HTMLElement)) return;
    c.style.display = open ? 'block' : 'none';

    const arrow = arrows[i];
    if (arrow instanceof HTMLElement) {
      arrow.textContent = open ? '▲' : '▼';
      arrow.setAttribute('aria-expanded', String(open));
    }
  });

  const tierCount = contents.length;
  const arr = open ? Array.from({ length: tierCount }, (_, i) => i) : [];
  localStorage.setItem('openTiers', JSON.stringify(arr));
}

async function bulkAction(action) {
  const checked = Array.from(document.querySelectorAll('.bulk-check:checked'))
    .map(cb => cb.dataset.id)
    .filter(Boolean);

  if (!checked.length) return showToast('No tools selected', 'info');

  try {
    if (action === 'checkout') {
      const operator = prompt('Operator ID:', '')?.trim().toLowerCase();
      if (!operator) return;
      await apiBulkAction(checked, 'checkout', operator);
    } else {
      await apiBulkAction(checked, 'return');
    }

    await fetchAndRenderAll();
    showToast(`Bulk ${action} complete`, 'success');
  } catch (err) {
    console.error(`Bulk ${action} failed:`, err);
    showToast(`Bulk ${action} failed: ${err.message}`, 'error');
  }
}

export function showToast(msg, type = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);

  setTimeout(() => el.remove(), 3000);
}

