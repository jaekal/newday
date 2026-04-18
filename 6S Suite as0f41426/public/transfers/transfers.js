/**
 * public/transfers/transfers.js
 * Client-side logic for the building transfer page.
 */
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ── State ─────────────────────────────────────────────────────────── */
let step         = 1;
let fromBuilding = 'Bldg-350';
let toBuilding   = 'Bldg-4050';
let transferType = '';   // 'inventory' | 'tool' | 'asset'
let selectedItems = [];  // [{ id, label, desc, meta, qty? }]
let searchTimer  = null;
let lastSearchResults = [];


/* ── Helpers ────────────────────────────────────────────────────────── */
function esc(s) { return String(s||'').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

function csrf() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function apiFetch(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers['X-CSRF-Token'] = csrf();
  }
  const r = await fetch(url, { credentials: 'include', headers, ...opts });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.message || `HTTP ${r.status}`);
  }
  return r.json();
}

function notify(msg, type = 'ok') {
  if (window.notyf) {
    type === 'ok' ? window.notyf.success(msg) : window.notyf.error(msg);
  } else {
    alert(msg);
  }
}

/* ── Step management ────────────────────────────────────────────────── */
function goStep(n) {
  step = n;
  for (let i = 1; i <= 4; i++) {
    const el = $(`step${i}`);
    if (el) el.style.display = i === n ? '' : 'none';
  }
  $$('.tr-step').forEach(s => {
    const sn = Number(s.dataset.step);
    s.classList.toggle('active', sn === n);
    s.classList.toggle('done',   sn < n);
  });
}

/* ── Building pills ─────────────────────────────────────────────────── */
function updatePills() {
  const label = b => b.replace('Bldg-', 'Building ');
  ['pillFrom','pillFrom3'].forEach(id => { const el = $(id); if (el) el.textContent = label(fromBuilding); });
  ['pillTo','pillTo3'].forEach(id => { const el = $(id); if (el) el.textContent = label(toBuilding); });
}

/* ── Type buttons ───────────────────────────────────────────────────── */
function updateTypeButtons() {
  $$('.tr-type-btn').forEach(btn => {
    const active = btn.dataset.type === transferType;
    btn.style.borderColor  = active ? 'var(--accent)' : 'var(--border)';
    btn.style.background   = active ? 'color-mix(in srgb,var(--accent) 12%,transparent)' : 'var(--surface-strong)';
    btn.style.color        = active ? 'var(--accent)' : '';
  });
}

const TYPE_LABELS = { inventory: 'Inventory', tool: 'Tool', asset: 'Asset' };
const TYPE_CLASSES = { inventory: 'tr-type-inventory', tool: 'tr-type-tool', asset: 'tr-type-asset' };

/* ── Item search ─────────────────────────────────────────────────────── */
async function searchItems(q) {
  if (!transferType || !fromBuilding) return;
  const url = `/transfers/search?type=${encodeURIComponent(transferType)}&building=${encodeURIComponent(fromBuilding)}&q=${encodeURIComponent(q)}`;
  try {
    const items = await apiFetch(url);
    lastSearchResults = Array.isArray(items) ? items : [];
    renderResults(lastSearchResults);
  } catch (e) {
    lastSearchResults = [];
    renderResults([]);
  }
}

function renderResults(items) {
  const el = $('itemResults');
  if (!items.length) {
    el.innerHTML = '<div style="padding:.6rem;font-size:.82rem;color:var(--fg-muted);text-align:center">No items found</div>';
  } else {
    el.innerHTML = items.map(i => {
      const isSelected = selectedItems.some(sel => sel.id === i.id);
      return `
      <div class="tr-result-item ${isSelected ? 'selected' : ''}" data-id="${esc(i.id)}" data-label="${esc(i.label)}"
           data-desc="${esc(i.desc)}" data-meta="${esc(i.meta)}" data-qty="${i.qty ?? ''}">
        <div class="tr-result-label">${esc(i.label)}${i.desc ? ` - <span style="font-weight:400">${esc(i.desc)}</span>` : ''}</div>
        <div class="tr-result-meta">${esc(i.meta || '')}</div>
      </div>`;
    }).join('');
  }
  el.classList.add('open');
}

function renderSelectedItems() {
  const display = $('selectedItemDisplay');
  const list = $('selectedItemList');
  if (!display || !list) return;

  if (!selectedItems.length) {
    display.style.display = 'none';
    list.innerHTML = '';
    $('qtyRow').style.display = 'none';
    $('btnStep3Next').disabled = true;
    return;
  }

  display.style.display = '';
  list.innerHTML = selectedItems.map(item => `
    <div class="tr-selected-chip">
      <div>
        <div style="font-weight:700">${esc(item.label)}${item.desc ? ` - ${esc(item.desc)}` : ''}</div>
        <div style="font-size:.76rem;color:var(--fg-muted)">${esc(item.meta || '')}</div>
      </div>
      <button type="button" class="tr-clear-btn" data-remove-id="${esc(item.id)}" title="Remove selection">x</button>
    </div>`).join('');

  if (transferType === 'inventory') {
    const item = selectedItems[0];
    $('qtyRow').style.display = '';
    $('qtyInput').value = 1;
    $('qtyInput').max = item?.qty || 9999;
    $('maxQtyLabel').textContent = item?.qty != null ? `of ${item.qty} on hand` : '';
  } else {
    $('qtyRow').style.display = 'none';
  }

  $('btnStep3Next').disabled = false;
}

function selectItem(item) {
  if (transferType === 'inventory') {
    selectedItems = [item];
    $('itemResults').classList.remove('open');
  } else if (!selectedItems.some(sel => sel.id === item.id)) {
    selectedItems = selectedItems.concat(item);
  }
  renderSelectedItems();
  renderResults(lastSearchResults);
}

function selectAllVisibleResults() {
  if (!lastSearchResults.length) return;
  if (transferType === 'inventory') {
    selectItem(lastSearchResults[0]);
    return;
  }
  const existing = new Set(selectedItems.map(item => item.id));
  selectedItems = selectedItems.concat(lastSearchResults.filter(item => !existing.has(item.id)));
  renderSelectedItems();
  renderResults(lastSearchResults);
  $('itemResults').classList.remove('open');
}

function clearItem() {
  selectedItems = [];
  $('selectedItemDisplay').style.display = 'none';
  $('qtyRow').style.display              = 'none';
  $('btnStep3Next').disabled             = true;
  $('itemSearch').value                  = '';
  $('itemResults').classList.remove('open');
  $('itemResults').innerHTML             = '';
  lastSearchResults = [];
}
function buildSummary() {
  const label = b => b.replace('Bldg-', 'Building ');
  $('sum-type').textContent = TYPE_LABELS[transferType] || transferType;
  $('sum-item').innerHTML = selectedItems.length
    ? selectedItems.map(item => `<div>${esc(item.label)}${item.desc ? ` - ${esc(item.desc)}` : ''}</div>`).join('')
    : '-';
  $('sum-from').textContent = label(fromBuilding);
  $('sum-to').textContent   = label(toBuilding);

  if (transferType === 'inventory') {
    $('sum-qty-row').style.display = '';
    $('sum-qty').textContent       = $('qtyInput').value || '1';
  } else if (selectedItems.length > 1) {
    $('sum-qty-row').style.display = '';
    $('sum-qty').textContent       = `${selectedItems.length} items`;
  } else {
    $('sum-qty-row').style.display = 'none';
  }

  const notes = $('notesInput').value.trim();
  if (notes) {
    $('sum-notes-row').style.display = '';
    $('sum-notes').textContent       = notes;
  } else {
    $('sum-notes-row').style.display = 'none';
  }

  $('transferError').style.display = 'none';
}
async function submitTransfer() {
  const btn = $('btnConfirmTransfer');
  btn.disabled = true;
  btn.textContent = 'Transferring...';
  $('transferError').style.display = 'none';

  try {
    for (const item of selectedItems) {
      const body = {
        type:         transferType,
        itemId:       item.id,
        fromBuilding,
        toBuilding,
        notes:        $('notesInput').value.trim(),
      };
      if (transferType === 'inventory') {
        body.qty = Number($('qtyInput').value) || 1;
      }

      await apiFetch('/transfers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }

    notify(`Transfer complete: ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} moved to ${toBuilding.replace('Bldg-', 'Building ')}`);

    fromBuilding = $('fromBuilding').value;
    toBuilding   = $('toBuilding').value;
    transferType = '';
    selectedItems = [];
    $('itemSearch').value  = '';
    $('notesInput').value  = '';
    goStep(1);
    updatePills();
    loadHistory();
  } catch (err) {
    $('transferError').textContent    = err.message || 'Transfer failed.';
    $('transferError').style.display  = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Transfer';
  }
}
async function loadHistory() {
  const body = $('historyBody');
  body.innerHTML = '<div class="tr-loading">Loading…</div>';

  const type     = $('histType').value;
  const building = $('histBuilding').value;
  const params   = new URLSearchParams({ limit: '100' });
  if (type)     params.set('type', type);
  if (building) params.set('from', building); // backend checks both fromBuilding and toBuilding

  try {
    const { transfers } = await apiFetch(`/transfers/history?${params}`);

    if (!transfers.length) {
      body.innerHTML = '<div class="tr-empty">No transfers recorded yet.</div>';
      return;
    }

    const label = b => (b || '').replace('Bldg-', 'Bldg ');
    const rows = transfers.map(t => {
      const typeClass = TYPE_CLASSES[t.type] || '';
      const date      = t.transferredAt
        ? new Date(t.transferredAt).toLocaleString([], { dateStyle:'short', timeStyle:'short' })
        : '—';
      const qty = t.qty != null ? t.qty : '—';
      return `<tr>
        <td><span class="tr-type-badge ${typeClass}">${esc(t.type)}</span></td>
        <td style="font-family:monospace;font-weight:700">${esc(t.itemId)}</td>
        <td>${qty}</td>
        <td><span class="tr-bldg-from">${esc(label(t.fromBuilding))}</span> → <span class="tr-bldg-to">${esc(label(t.toBuilding))}</span></td>
        <td style="color:var(--fg-muted)">${esc(t.actorName || t.actor || '—')}</td>
        <td style="color:var(--fg-muted);white-space:nowrap">${esc(date)}</td>
        <td style="color:var(--fg-muted);font-size:.78rem">${esc(t.notes || '')}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <table class="tr-table">
        <thead>
          <tr>
            <th>Type</th><th>Item</th><th>Qty</th><th>Route</th>
            <th>By</th><th>Date</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    body.innerHTML = `<div class="tr-empty">Failed to load history: ${esc(e.message)}</div>`;
  }
}

/* ── Wire events ─────────────────────────────────────────────────────── */

// Step 1
$('fromBuilding').addEventListener('change', e => {
  fromBuilding = e.target.value;
  // Auto-flip toBuilding
  $('toBuilding').value = fromBuilding === 'Bldg-350' ? 'Bldg-4050' : 'Bldg-350';
  toBuilding = $('toBuilding').value;
});
$('toBuilding').addEventListener('change', e => { toBuilding = e.target.value; });

$('btnStep1Next').addEventListener('click', () => {
  fromBuilding = $('fromBuilding').value;
  toBuilding   = $('toBuilding').value;
  if (fromBuilding === toBuilding) {
    notify('Source and destination must be different buildings.', 'error'); return;
  }
  updatePills();
  goStep(2);
});

// Step 2
$$('.tr-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    transferType = btn.dataset.type;
    updateTypeButtons();

    // Update type badge in step 3
    const badge = $('typeBadge3');
    if (badge) {
      badge.textContent  = TYPE_LABELS[transferType] || '';
      badge.className    = `tr-type-badge ${TYPE_CLASSES[transferType] || ''}`;
    }

    clearItem();
    goStep(3);

    // Pre-load all items for this type/building
    searchItems('');
  });
});

$('btnStep2Back').addEventListener('click', () => goStep(1));

// Step 3 — search
$('itemSearch').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchItems(e.target.value.trim()), 220);
});
$('itemSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  selectAllVisibleResults();
});
$('itemSearch').addEventListener('focus', () => {
  if ($('itemResults').innerHTML) $('itemResults').classList.add('open');
});

$('itemResults').addEventListener('click', e => {
  const row = e.target.closest('.tr-result-item');
  if (!row) return;
  selectItem({
    id:    row.dataset.id,
    label: row.dataset.label,
    desc:  row.dataset.desc,
    meta:  row.dataset.meta,
    qty:   row.dataset.qty ? Number(row.dataset.qty) : null,
  });
});

$('selectedItemDisplay').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove-id]');
  if (!btn) return;
  selectedItems = selectedItems.filter(item => item.id !== btn.dataset.removeId);
  renderSelectedItems();
  renderResults(lastSearchResults);
});

// Close results when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#itemSearchWrap') && !e.target.closest('#itemResults')) {
    $('itemResults').classList.remove('open');
  }
});

$('btnClearItem').addEventListener('click', clearItem);

$('btnStep3Back').addEventListener('click', () => {
  clearItem();
  transferType = '';
  updateTypeButtons();
  goStep(2);
});

$('btnStep3Next').addEventListener('click', () => {
  if (!selectedItems.length) return;
  if (transferType === 'inventory') {
    const qty = Number($('qtyInput').value);
    if (qty < 1 || (selectedItems[0].qty != null && qty > selectedItems[0].qty)) {
      notify(`Quantity must be between 1 and ${selectedItems[0].qty}.`, 'error');
      return;
    }
  }
  buildSummary();
  goStep(4);
});

// Step 4
$('btnStep4Back').addEventListener('click', () => goStep(3));
$('btnConfirmTransfer').addEventListener('click', submitTransfer);

// History controls
$('histType').addEventListener('change', loadHistory);
$('histBuilding').addEventListener('change', loadHistory);
$('btnRefreshHistory').addEventListener('click', loadHistory);

// Theme selector
const themeEl = $('themeSelector');
const savedTheme = localStorage.getItem('themeSelector') || 'theme-command';
document.documentElement.className = savedTheme;
if (themeEl) {
  themeEl.value = savedTheme;
  themeEl.addEventListener('change', e => {
    document.documentElement.className = e.target.value;
    localStorage.setItem('themeSelector', e.target.value);
  });
}

// Init active building from shared key
const activeBldg = localStorage.getItem('suite.building.v1') || 'Bldg-350';
$('fromBuilding').value = activeBldg;
fromBuilding = activeBldg;
$('toBuilding').value   = activeBldg === 'Bldg-350' ? 'Bldg-4050' : 'Bldg-350';
toBuilding = $('toBuilding').value;

/* ── Boot ──────────────────────────────────────────────────────────── */
goStep(1);
loadHistory();

