// public/js/inventory/main.js

import { initTheme } from './theme.js';
import { bindOtherUIEvents } from './events.js';
import { bindFormEvents } from './formHandlers.js';
import { bindConfirmButtons, openModal } from './modals.js';
import {
  renderTable,
  setSourceData,
  getSourceData,
  populateCategoryOptions
} from './render.js';
import { fetchInventory } from './api.js';

const NotyfCtor = window.Notyf || function () {
  return { success() {}, error() {}, open() {} };
};
window.notyf = window.notyf || new NotyfCtor({
  duration: 3500,
  position: { x: 'right', y: 'bottom' }
});

let socket = null;
try {
  socket = typeof window.io === 'function' ? window.io() : null;
} catch {
  socket = null;
}

const FILTER_STORAGE_KEY = 'inv.filters.v2';
let assignedBuilding = '';

function activeBuilding() {
  return (
    (typeof window.getBuilding === 'function' ? window.getBuilding() : null) ||
    localStorage.getItem('suite.building.v1') ||
    'Bldg-350'
  );
}

function confirmBuildingScope(actionLabel = 'make changes', targetBuilding = activeBuilding()) {
  const assigned = String(assignedBuilding || '').trim();
  const target = String(targetBuilding || '').trim();
  if (!assigned || !target || target === 'all' || assigned === target) return true;
  return window.confirm(
    `You are assigned to ${assigned}, but this action targets ${target}. Do you want to continue and ${actionLabel}?`
  );
}

function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function getEl(id) {
  return document.getElementById(id);
}

function readFiltersFromUI() {
  return {
    q: (getEl('filterSearch')?.value || '').trim(),
    status: getEl('filterStatus')?.value || '',
    category: getEl('filterCategory')?.value || '',
    minQty: getEl('filterMinQty')?.value || '',
    maxQty: getEl('filterMaxQty')?.value || ''
  };
}

function applyFiltersToUI(state = {}) {
  if (getEl('filterSearch')) getEl('filterSearch').value = state.q ?? '';
  if (getEl('filterStatus')) getEl('filterStatus').value = state.status ?? '';
  if (getEl('filterCategory')) getEl('filterCategory').value = state.category ?? '';
  if (getEl('filterMinQty')) getEl('filterMinQty').value = state.minQty ?? '';
  if (getEl('filterMaxQty')) getEl('filterMaxQty').value = state.maxQty ?? '';
}

function saveFilters(state) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function loadFilters() {
  try {
    const url = new URL(location.href);
    const hasParams = ['q', 'status', 'category', 'minQty', 'maxQty'].some((k) =>
      url.searchParams.has(k)
    );

    if (hasParams) {
      return {
        q: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || '',
        category: url.searchParams.get('category') || '',
        minQty: url.searchParams.get('minQty') || '',
        maxQty: url.searchParams.get('maxQty') || ''
      };
    }

    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function pushFiltersToURL(state) {
  try {
    const url = new URL(location.href);
    ['q', 'status', 'category', 'minQty', 'maxQty'].forEach((key) => {
      const value = String(state[key] ?? '').trim();
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    history.replaceState({}, '', url.toString());
  } catch {}
}

async function applyRoleGates() {
  let role = 'guest';
  try {
    const res = await fetch('/auth/whoami', {
      headers: { Accept: 'application/json' }
    });
    const { user } = await res.json();
    role = user?.role || 'guest';
    assignedBuilding = user?.building || '';
    window.inventoryBuildingScope = {
      activeBuilding,
      assignedBuilding: () => assignedBuilding,
      confirm: confirmBuildingScope,
    };
  } catch {}

  document.body.dataset.role = role;

  document.querySelectorAll('[data-role]').forEach((el) => {
    const allowed = (el.getAttribute('data-role') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const show = allowed.includes(role);
    el.classList.toggle('hidden', !show);

    if (!show) {
      el.setAttribute('hidden', 'true');
      if (el.matches('button,input,select,textarea')) el.disabled = true;
      el.querySelectorAll('button,input,select,textarea').forEach((child) => {
        child.disabled = true;
      });
    } else {
      el.removeAttribute('hidden');
    }
  });
}

function wireModalBuildingDefault() {
  const modal = getEl('itemModal');
  if (!modal) return;

  const observer = new MutationObserver(() => {
    const buildingSelect = modal.querySelector('select[name="Building"]');
    if (!buildingSelect) return;

    if (modal.getAttribute('aria-hidden') === 'false') {
      if (!buildingSelect.dataset.userEdited) {
        buildingSelect.value = activeBuilding();
      }
    } else {
      delete buildingSelect.dataset.userEdited;
    }
  });

  observer.observe(modal, {
    attributes: true,
    attributeFilter: ['aria-hidden']
  });

  modal.querySelector('select[name="Building"]')?.addEventListener('change', (e) => {
    e.target.dataset.userEdited = '1';
  });
}

function wireModalTabs() {
  const modal = getEl('itemModal');
  if (!modal) return;

  function showTab(tabId) {
    modal.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    modal.querySelectorAll('.tab-pane').forEach((pane) => {
      pane.classList.toggle('hidden', pane.id !== tabId);
    });
  }

  modal.addEventListener('click', (e) => {
    const btn = e.target.closest?.('.tab-btn');
    if (!btn || !modal.contains(btn)) return;
    e.preventDefault();
    showTab(btn.dataset.tab);
  });

  showTab('tabBasic');
}

function wireImportFileLabel() {
  const input = getEl('importFile');
  const label = getEl('importFileName');
  if (!input || !label) return;

  input.addEventListener('change', (e) => {
    label.textContent = e.target.files?.[0]?.name || '';
  });
}

function buildFilterPredicate() {
  const { q, status, category, minQty, maxQty } = readFiltersFromUI();
  const qLC = q.toLowerCase();
  const min = Number.parseInt(minQty, 10);
  const max = Number.parseInt(maxQty, 10);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);

  return (row) => {
    if (qLC) {
      const haystack = [
        row.ItemCode,
        row.Description,
        row.Location,
        row.Vendor,
        row.PartNumber,
        row.Category
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(qLC)) return false;
    }

    if (status && (row.OrderStatus || '') !== status) return false;
    if (category && (row.Category || '') !== category) return false;

    const qty = Number(row.OnHandQty) || 0;
    if (hasMin && qty < min) return false;
    if (hasMax && qty > max) return false;

    return true;
  };
}

async function applyFiltersAndRender() {
  const filtered = getSourceData().filter(buildFilterPredicate());
  await renderTable(filtered);
}

function clearAllFilters() {
  applyFiltersToUI({
    q: '',
    status: '',
    category: '',
    minQty: '',
    maxQty: ''
  });

  const state = readFiltersFromUI();
  saveFilters(state);
  pushFiltersToURL(state);
  applyFiltersAndRender();
}

function wireFilters() {
  const rerender = debounce(() => {
    const state = readFiltersFromUI();
    saveFilters(state);
    pushFiltersToURL(state);
    applyFiltersAndRender();
  }, 120);

  ['filterSearch', 'filterStatus', 'filterCategory', 'filterMinQty', 'filterMaxQty'].forEach((id) => {
    const el = getEl(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', rerender);
  });

  getEl('cardTotalSkus')?.addEventListener('click', clearAllFilters);

  getEl('cardBelowSafety')?.addEventListener('click', () => {
    if (getEl('filterStatus')) getEl('filterStatus').value = 'Low Stock';
    const state = readFiltersFromUI();
    saveFilters(state);
    pushFiltersToURL(state);
    applyFiltersAndRender();
  });

  getEl('cardPendingOrders')?.addEventListener('click', () => {
    if (getEl('filterStatus')) getEl('filterStatus').value = 'Ordered';
    const state = readFiltersFromUI();
    saveFilters(state);
    pushFiltersToURL(state);
    applyFiltersAndRender();
  });

  getEl('cardInventoryValue')?.addEventListener('click', applyFiltersAndRender);
  getEl('clearFiltersBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAllFilters();
  });
}

async function loadAndRenderAll() {
  document.body.classList.add('loading');

  try {
    const data = await fetchInventory({ building: activeBuilding() });
    setSourceData(data);

    const previousCategory = getEl('filterCategory')?.value || '';
    populateCategoryOptions(data);

    if (
      previousCategory &&
      getEl('filterCategory') &&
      Array.from(getEl('filterCategory').options).some((option) => option.value === previousCategory)
    ) {
      getEl('filterCategory').value = previousCategory;
    }

    await applyFiltersAndRender();
    setTimeout(() => getEl('inventoryTable')?.focus(), 150);
  } catch (err) {
    console.error(err);
    window.notyf?.error('Failed to load inventory.');
  } finally {
    document.body.classList.remove('loading');
  }
}

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target?.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable;

    if (!typing && e.key === '/') {
      e.preventDefault();
      getEl('filterSearch')?.focus();
    }

    if (!typing && (e.key === 'n' || e.key === 'N')) {
      const btn = getEl('addItemBtn');
      if (btn && !btn.classList.contains('hidden')) {
        e.preventDefault();
        openModal('itemModal');
      }
    }

    if (!typing && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      loadAndRenderAll();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await applyRoleGates();

  initTheme();
  wireModalTabs();
  wireImportFileLabel();
  wireModalBuildingDefault();

  bindOtherUIEvents();
  bindFormEvents();
  bindConfirmButtons();

  const saved = loadFilters();
  if (saved) applyFiltersToUI(saved);
  pushFiltersToURL(readFiltersFromUI());

  wireFilters();
  wireShortcuts();
  await loadAndRenderAll();

  if (socket) {
    let refreshTimer = null;

    socket.on?.('connect_error', () => {
      console.warn('[socket] connect error');
    });

    socket.on?.('inventoryUpdated', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        await loadAndRenderAll();
        window.notyf?.success('Inventory updated');
      }, 200);
    });
  }

  getEl('refreshInventoryBtn')?.addEventListener('click', loadAndRenderAll);
});
