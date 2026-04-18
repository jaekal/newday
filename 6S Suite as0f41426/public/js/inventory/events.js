// public/js/inventory/events.js

import * as api from './api.js';
import { renderTable } from './render.js';
import { openModalById, closeAllModals, openModal, openConfirm } from './modals.js';

let editingCode = null;
let lastAuditLogs = [];

// Safe Notyf fallback
const NotyfCtor = window.Notyf || function () { return { success(){}, error(){}, open(){} }; };
const notyf = window.notyf || new NotyfCtor({ duration: 3500, position: { x: 'right', y: 'bottom' } });

function activeBuilding() {
  return window.inventoryBuildingScope?.activeBuilding?.() || 'Bldg-350';
}

function confirmBuildingScope(actionLabel, targetBuilding = activeBuilding()) {
  return window.inventoryBuildingScope?.confirm?.(actionLabel, targetBuilding) ?? true;
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/* ------------------------------ utils ------------------------------ */

function getSelectedCodes() {
  return $('input.row-select:checked')
    .map((_, el) => ($(el).data('code') || '').toString().trim())
    .get()
    .filter(Boolean);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeChanges(log) {
  if (log && log.fieldChanges && typeof log.fieldChanges === 'object') {
    return log.fieldChanges;
  }
  if (log && Array.isArray(log.changes)) {
    const obj = {};
    for (const c of log.changes) {
      if (!c) continue;
      const key = c.field || c.key || '';
      if (!key) continue;
      obj[key] = { from: c.from, to: c.to };
    }
    return obj;
  }
  return {};
}

function topLevelLogCode(l) {
  return l?.itemCode || l?.ItemCode || l?.code || l?.sku || null;
}

function buildAliasSet(rootCode, logs) {
  const aliases = new Set([String(rootCode)]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const l of logs) {
      const fc = normalizeChanges(l);
      const from = fc.ItemCode?.from ?? fc.itemCode?.from ?? null;
      const to   = fc.ItemCode?.to   ?? fc.itemCode?.to   ?? null;

      if (from && aliases.has(String(from)) && to && !aliases.has(String(to))) {
        aliases.add(String(to)); grew = true;
      } else if (to && aliases.has(String(to)) && from && !aliases.has(String(from))) {
        aliases.add(String(from)); grew = true;
      }

      const top = topLevelLogCode(l);
      if (top && !aliases.has(String(top)) && String(top) === String(rootCode)) {
        aliases.add(String(top));
      }
    }
  }
  return aliases;
}

function logBelongsToAliases(l, aliases) {
  const top = topLevelLogCode(l);
  if (top && aliases.has(String(top))) return true;

  const fc = normalizeChanges(l);
  const from = fc.ItemCode?.from ?? fc.itemCode?.from ?? null;
  const to   = fc.ItemCode?.to   ?? fc.itemCode?.to   ?? null;

  if (from && aliases.has(String(from))) return true;
  if (to && aliases.has(String(to))) return true;

  return false;
}

function resolveRowContext(btn, table) {
  const $btn = $(btn);

  let code = ($btn.data('code') || '').toString().trim();

  let $tr = $btn.closest('tr');
  if ($tr.hasClass('child')) {
    const $parent = $tr.prev('tr');
    if ($parent.length) $tr = $parent;
  }

  const rowApi = table?.row ? table.row($tr) : null;
  const data = rowApi?.data?.() || {};

  if (!code) {
    code =
      data?.ItemCode ||
      data?.itemCode ||
      $tr.data('code') ||
      $tr.find('[data-code]').first().data('code') ||
      ($tr.find('.code-value').first().text() || '').trim();
  }

  code = (code == null ? '' : String(code)).trim();
  return { $tr, data, code };
}

/* --------------------------- row event bind --------------------------- */

export function bindTableRowEvents(table) {
  const $tbl = $('#inventoryTable');

  $tbl
    .off('click', 'button.btn-edit')
    .off('click', 'button.btn-delete')
    .off('click', 'button.btn-checkout')
    .off('click', 'button.btn-audit');

  $tbl.on('click', 'button.btn-edit',     (e) => onEdit(table, e.currentTarget));
  $tbl.on('click', 'button.btn-delete',   (e) => onDelete(table, e.currentTarget));
  $tbl.on('click', 'button.btn-checkout', (e) => onInitCheckout(table, e.currentTarget));
  $tbl.on('click', 'button.btn-audit',    (e) => onAudit(table, e.currentTarget));
}

/* ------------------------------ handlers ------------------------------ */

async function onEdit(table, btn) {
  const { data, code } = resolveRowContext(btn, table);
  if (!code) return notyf.error('Row not found');

  editingCode = code;

  $('#itemModal .tab-btn').removeClass('active');
  $('#itemModal .tab-pane').addClass('hidden');
  $('#tabBtnBasic').addClass('active');
  $('#tabBasic').removeClass('hidden');

  openModal({ ...data, ItemCode: code });

  // Tell the drop zone to check for an existing image on the server
  window._refreshDropZone?.(code);

  $(document).one('inventoryUpdated', () => {
    setTimeout(() => {
      const $row = $('#inventoryTable tbody tr').filter(function () {
        const domCode = ($(this).data('code') || $(this).find('.code-value').text().trim());
        return domCode === code;
      });
      if ($row.length) {
        $row.addClass('bg-yellow-200 transition-colors');
        setTimeout(() => $row.removeClass('bg-yellow-200'), 1600);
      }
    }, 400);
  });
}

function onDelete(table, btn) {
  const { code, $tr } = resolveRowContext(btn, table);
  if (!code) {
    // Invalid / ghost row — remove from UI to avoid repeated errors
    $tr?.remove();
    return notyf.error('Row not found');
  }

  openConfirm(`Delete ${escapeHtml(code)}?`, async () => {
    try {
      await api.deleteItem(code);
      notyf.success('Deleted');
      const data = await api.fetchInventory({ building: activeBuilding() });
      await renderTable(data);
      $('#selectAll').prop('checked', false);
      $('.bulk-toolbar').addClass('hidden');
    } catch (err) {
      console.error('Delete failed:', err);
      const msg = err?.status === 404
        ? `Item ${code} was not found on the server.`
        : (err?.message || 'Delete failed');
      notyf.error(msg);
    }
  });
}

async function onInitCheckout(table, btn) {
  const { data, code } = resolveRowContext(btn, table);
  if (!code) return notyf.error('Row not found');

  const qty  = Number(data?.OnHandQty) || 0;

  const form  = document.getElementById('checkoutForm');
  const modal = document.getElementById('checkoutModal');

  if (form) {
    form.reset();
    form.dataset.code = code;
    const qtyInput = form.elements['CheckoutQty'];
    if (qtyInput && !qtyInput.value) qtyInput.value = 1;
  }
  if (modal) modal.dataset.code = code;
  window.checkoutCode = code;

  const qtyEl = document.getElementById('currentQtyDisplay');
  if (qtyEl) qtyEl.textContent = `Current Qty: ${qty}`;

  openModalById('checkoutModal');
  requestAnimationFrame(() => form?.elements?.operatorId?.focus?.());
}

/* ------------------------------ item history modal ------------------------------ */

const HISTORY_ACTIONS = [
  { key: 'create',               label: 'Created',     tone: 'pos' },
  { key: 'update',               label: 'Updated',     tone: 'info' },
  { key: 'checkout',             label: 'Checkout',    tone: 'warn' },
  { key: 'checkin',              label: 'Check-in',    tone: 'pos' },
  { key: 'delete',               label: 'Deleted',     tone: 'neg' },
  { key: 'restore',              label: 'Restored',    tone: 'pos' },
  { key: 'bulk_delete',          label: 'Bulk Delete', tone: 'neg' },
  { key: 'bulk_reorder',         label: 'Bulk Reorder',tone: 'info' },
  { key: 'import_create',        label: 'Imported',    tone: 'pos' },
  { key: 'import_update',        label: 'Import Upd.', tone: 'info' },
  { key: 'import_update_rename', label: 'Import Ren.', tone: 'info' },
  { key: 'import_remove',        label: 'Import Del.', tone: 'neg' },
  { key: 'image_upload',         label: 'Image Added', tone: 'info' },
  { key: 'image_remove',         label: 'Image Removed', tone: 'neg' },
];

const ACTION_META = HISTORY_ACTIONS.reduce((m, a) => ((m[a.key] = a), m), {});
function _histIc(paths) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const ACTION_ICON_HTML = {
  create: _histIc('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  update: _histIc('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  checkout: _histIc('<path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/>'),
  checkin: _histIc('<path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/>'),
  delete: _histIc('<path d="M18 6 6 18M6 6l12 12"/>'),
  restore: _histIc('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  bulk_delete: _histIc('<path d="M18 6 6 18M6 6l12 12"/>'),
  bulk_reorder: _histIc('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  import_create: _histIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_update: _histIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_update_rename: _histIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_remove: _histIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  image_upload: _histIc('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  image_remove: _histIc('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>'),
};

function actionLabel(a) { return ACTION_META[a]?.label || titleCase(a || 'event'); }
function titleCase(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function performerOf(l) {
  return l?.operatorId || l?.performedBy || l?.sixSOperator || l?.actor || 'system';
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysBetween(a, b) {
  return Math.floor((startOfDay(a) - startOfDay(b)) / 86400000);
}

/** Human-friendly bucket label for a timestamp relative to "today". */
function dateBucketLabel(t) {
  const now = new Date();
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return 'Unknown';

  const diff = daysBetween(now, d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)   return 'This week';
  if (diff < 30)  return 'This month';
  if (now.getFullYear() === d.getFullYear()) {
    return d.toLocaleString(undefined, { month: 'long' });
  }
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function fmtDateTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function fmtDateShort(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildActionHeadline(l) {
  const action = l.action || 'event';
  const qty    = Number.isFinite(+l.qty) ? +l.qty : null;
  switch (action) {
    case 'checkout':       return qty != null ? `Checked out ${qty} unit${qty === 1 ? '' : 's'}` : 'Checked out';
    case 'checkin':        return qty != null ? `Checked in ${qty} unit${qty === 1 ? '' : 's'}`  : 'Checked in';
    case 'create':         return 'Item created';
    case 'update':         return 'Item updated';
    case 'delete':         return 'Item deleted';
    case 'restore':        return 'Item restored';
    case 'bulk_delete':    return 'Bulk delete';
    case 'bulk_reorder':   return 'Marked for reorder';
    case 'import_create':  return 'Imported (new row)';
    case 'import_update':  return 'Imported (updated)';
    case 'import_update_rename': return 'Imported (renamed)';
    case 'import_remove':  return 'Imported (removed)';
    case 'image_upload':   return 'Image uploaded';
    case 'image_remove':   return 'Image removed';
    default:               return titleCase(action);
  }
}

function qtyDelta(l) {
  // Positive = inventory increase, Negative = decrease.
  const q = Number.isFinite(+l.qty) ? +l.qty : null;
  if (q == null) return null;
  if (l.action === 'checkin' || l.action === 'restore') return +q;
  if (l.action === 'checkout' || l.action === 'delete' || l.action === 'bulk_delete') return -q;
  return null;
}

function normChangesString(l) {
  const obj = (l && l.fieldChanges) ? l.fieldChanges :
              (Array.isArray(l?.changes) ? Object.fromEntries(l.changes.map(c => [c.field || c.key || '', { from: c.from, to: c.to }])) : {});
  return (obj && Object.keys(obj).length) ? JSON.stringify(obj) : '';
}

async function onAudit(table, btn) {
  const { code, data, $tr } = resolveRowContext(btn, table);
  if (!code) {
    $tr?.remove();
    return notyf.error('Row not found');
  }

  // Open first so the loading skeleton is visible, then load.
  openModalById('auditModal');

  const $modal        = $('#auditModal');
  const $body         = $('#auditModalBody');
  const $chips        = $('#auditActionChips');
  const $search       = $('#auditFilterSearch');
  const $operator     = $('#auditFilterOperator');
  const $startInput   = $('#auditFilterStart');
  const $endInput     = $('#auditFilterEnd');
  const $presets      = $modal.find('.hist-chip--preset');
  const $expandBtn    = $('#expandAudit');
  const $resultCount  = $('#auditResultCount');

  $('#auditTitle').text('Item History');
  $('#auditItemCode').text(code);
  $('#auditItemDesc').text(data?.Description || '');

  // Reset filter UI on each open so state doesn't leak across items.
  $search.val('');
  $operator.val('');
  $startInput.val('');
  $endInput.val('');
  $presets.removeClass('is-active');
  $presets.filter('[data-preset="all"]').addClass('is-active');

  // Loading skeleton
  $body.attr('aria-busy', 'true').html(`
    <div class="hist-skeleton">
      <div class="hist-skeleton__row"></div>
      <div class="hist-skeleton__row"></div>
      <div class="hist-skeleton__row"></div>
      <div class="hist-skeleton__row"></div>
    </div>
  `);

  /** @type {Set<string>} */
  const activeActions = new Set(); // empty == all

  let allLogs = [];

  try {
    const res = await api.fetchAuditLog(code);
    const rawLogs = Array.isArray(res) ? res : [];
    const aliases = buildAliasSet(code, rawLogs);
    allLogs = rawLogs
      .filter(l => logBelongsToAliases(l, aliases))
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  } catch (e) {
    console.error(e);
    notyf.error('Failed to fetch audit log');
    $body.attr('aria-busy', 'false').html(emptyStateHtml('Couldn\'t load history', 'There was a problem fetching audit data.'));
    return;
  }

  buildActionChips(allLogs, $chips, activeActions, applyAndRender);
  applyAndRender();

  // --- Event wiring (re-bound each time the modal opens for this item) ---

  let searchDebounce = null;
  $search.off('input.hist').on('input.hist', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyAndRender, 120);
  });
  $operator.off('input.hist').on('input.hist', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyAndRender, 150);
  });
  $startInput.off('change.hist').on('change.hist', () => { clearPreset(); applyAndRender(); });
  $endInput  .off('change.hist').on('change.hist', () => { clearPreset(); applyAndRender(); });

  $presets.off('click.hist').on('click.hist', function () {
    const preset = this.dataset.preset;
    $presets.removeClass('is-active');
    this.classList.add('is-active');
    applyPreset(preset);
    applyAndRender();
  });

  $('#auditFilterReset').off('click.hist').on('click.hist', () => {
    $search.val('');
    $operator.val('');
    $startInput.val('');
    $endInput.val('');
    activeActions.clear();
    $chips.find('.hist-chip').removeClass('is-active');
    $presets.removeClass('is-active');
    $presets.filter('[data-preset="all"]').addClass('is-active');
    applyAndRender();
  });

  $expandBtn.off('click.hist').on('click.hist', () => {
    const expanded = $modal.find('.modal').toggleClass('modal--fullscreen').hasClass('modal--fullscreen');
    $expandBtn.attr('aria-expanded', expanded ? 'true' : 'false').text(expanded ? 'Collapse' : 'Expand');
  });

  $('#exportHistoryBtn').off('click.hist').on('click.hist', () => exportVisibleCsv(code));

  /* --------------------------- helpers (closure) --------------------------- */

  function clearPreset() {
    $presets.removeClass('is-active');
  }

  function applyPreset(preset) {
    const today = startOfDay(new Date());
    const yyyyMmDd = (d) => {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    };
    if (preset === 'all') {
      $startInput.val(''); $endInput.val('');
      return;
    }
    const end = new Date(today); end.setHours(23,59,59,999);
    const start = new Date(today);
    if (preset === 'today') { /* start = today */ }
    else if (preset === '7d')  start.setDate(start.getDate() - 6);
    else if (preset === '30d') start.setDate(start.getDate() - 29);
    else if (preset === '90d') start.setDate(start.getDate() - 89);
    $startInput.val(yyyyMmDd(start));
    $endInput.val(yyyyMmDd(end));
  }

  function applyAndRender() {
    const q         = ($search.val() || '').toString().trim().toLowerCase();
    const opFilter  = ($operator.val() || '').toString().trim().toLowerCase();
    const startStr  = ($startInput.val() || '').toString();
    const endStr    = ($endInput.val() || '').toString();
    const startTs   = startStr ? new Date(`${startStr}T00:00:00`).getTime() : -Infinity;
    const endTs     = endStr   ? new Date(`${endStr}T23:59:59.999`).getTime() : Infinity;

    const filtered = allLogs.filter(l => {
      const t = new Date(l.time).getTime();
      if (Number.isFinite(t) && (t < startTs || t > endTs)) return false;

      if (activeActions.size && !activeActions.has(l.action)) return false;

      if (opFilter) {
        const perf = String(performerOf(l)).toLowerCase();
        if (!perf.includes(opFilter)) return false;
      }

      if (q) {
        const hay = [
          l.action,
          performerOf(l),
          topLevelLogCode(l),
          l.qty,
          l.startingQty,
          JSON.stringify(normalizeChanges(l) || {}),
        ].map(v => String(v ?? '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    lastAuditLogs = filtered; // used by CSV export
    renderSummary(filtered, allLogs);
    renderTimeline(filtered);
    updateChipCounts(allLogs, $chips, activeActions);
    $resultCount.text(
      filtered.length === allLogs.length
        ? `${filtered.length} event${filtered.length === 1 ? '' : 's'}`
        : `${filtered.length} of ${allLogs.length} event${allLogs.length === 1 ? '' : 's'}`
    );
  }

  function renderSummary(visible, total) {
    const net = visible.reduce((acc, l) => acc + (qtyDelta(l) || 0), 0);
    const operators = new Set(visible.map(performerOf).filter(Boolean));

    const $total = $('#histStatTotal');
    $total.text(visible.length.toLocaleString());
    $('#histStatTotalSub').text(visible.length === total.length
      ? 'all events'
      : `of ${total.length.toLocaleString()} total`);

    const $netQty = $('#histStatNetQty');
    const $netCard = $('.hist-stat[data-stat="qty"]');
    const signed = net > 0 ? `+${net}` : `${net}`;
    $netQty.text(signed);
    $netCard.attr('data-tone', net > 0 ? 'pos' : (net < 0 ? 'neg' : ''));

    $('#histStatOperators').text(operators.size.toLocaleString());

    if (visible.length) {
      const sorted = [...visible].sort((a, b) => new Date(a.time) - new Date(b.time));
      const first = sorted[0].time;
      const last  = sorted[sorted.length - 1].time;
      const sameDay = daysBetween(last, first) === 0;
      $('#histStatRange').text(sameDay ? fmtDateShort(first) : `${fmtDateShort(first)} → ${fmtDateShort(last)}`);
      const span = daysBetween(new Date(), first);
      $('#histStatRangeSub').text(span === 0 ? 'today' : `spanning ${span + 1} day${span ? 's' : ''}`);
    } else {
      $('#histStatRange').text('—');
      $('#histStatRangeSub').text('');
    }
  }

  function renderTimeline(visible) {
    $body.attr('aria-busy', 'false');
    if (!visible.length) {
      $body.html(emptyStateHtml('No events match your filters', 'Try clearing filters or expanding the date range.'));
      return;
    }

    const groups = new Map(); // label -> logs[]
    for (const l of visible) {
      const label = dateBucketLabel(l.time);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(l);
    }

    const groupHtml = [...groups.entries()].map(([label, logs]) => `
      <section class="hist-group">
        <header class="hist-group__header">
          <span>${escapeHtml(label)}</span>
          <span class="hist-group__count">${logs.length} event${logs.length === 1 ? '' : 's'}</span>
        </header>
        ${logs.map(entryHtml).join('')}
      </section>
    `).join('');

    $body.html(groupHtml);
  }

  function entryHtml(l) {
    const action = l.action || 'event';
    const performer = performerOf(l);
    const top = topLevelLogCode(l);
    const alias = top && String(top) !== String(code)
      ? `<span class="hist-pill hist-pill--code" title="Logged under ${escapeHtml(top)}">${escapeHtml(top)}</span>`
      : '';
    const dotInner = ACTION_ICON_HTML[action] || escapeHtml('•');
    const delta = qtyDelta(l);
    const qtyHtml = delta != null
      ? `<span class="hist-entry__qty ${delta < 0 ? 'hist-entry__qty--out' : 'hist-entry__qty--in'}">${delta > 0 ? '+' : ''}${delta}</span>`
      : (l.qty != null ? `<span class="hist-entry__qty">${escapeHtml(l.qty)}</span>` : '');

    const changesObj = normalizeChanges(l);
    const keys = Object.keys(changesObj || {});
    let changesHtml = '';
    if (keys.length) {
      const rows = keys.map(k => {
        const v = changesObj[k];
        if (v && typeof v === 'object' && ('from' in v || 'to' in v)) {
          const from = v.from == null || v.from === '' ? '—' : String(v.from);
          const to   = v.to   == null || v.to   === '' ? '—' : String(v.to);
          return `<div class="hist-diff">
            <span class="hist-diff__field">${escapeHtml(k)}</span>
            <span class="hist-diff__from" title="from">${escapeHtml(from)}</span>
            <span class="hist-diff__arrow" aria-hidden="true">→</span>
            <span class="hist-diff__to" title="to">${escapeHtml(to)}</span>
          </div>`;
        }
        return `<div class="hist-diff hist-diff--single">
          <span class="hist-diff__field">${escapeHtml(k)}</span>
          <span class="hist-diff__to">${escapeHtml(String(v ?? ''))}</span>
        </div>`;
      }).join('');
      changesHtml = `<div class="hist-entry__changes">${rows}</div>`;
    }

    const startingQtyHtml = (l.startingQty != null && l.action !== 'create')
      ? `<span>Starting qty <strong>${escapeHtml(l.startingQty)}</strong></span>`
      : '';

    return `
      <article class="hist-entry" data-action="${escapeHtml(action)}">
        <span class="hist-entry__dot" aria-hidden="true">${dotInner}</span>
        <div class="hist-entry__head">
          <span class="hist-entry__badge">${escapeHtml(actionLabel(action))}</span>
          <span class="hist-entry__title">${escapeHtml(buildActionHeadline(l))}</span>
          ${qtyHtml}
          ${alias}
          <span class="hist-entry__time" title="${escapeHtml(fmtDateTime(l.time))}">${escapeHtml(fmtDateTime(l.time))}</span>
        </div>
        <div class="hist-entry__meta">
          <span>By <strong>${escapeHtml(performer)}</strong></span>
          ${startingQtyHtml}
        </div>
        ${changesHtml}
      </article>`;
  }

  function exportVisibleCsv(itemCode) {
    if (!lastAuditLogs.length) {
      notyf.error('No history to export.');
      return;
    }
    const csv = [
      ['Date/Time', 'Action', 'Performed By', 'Qty', 'Qty Delta', 'Starting Qty', 'Item Code', 'Changed Fields'],
      ...lastAuditLogs.map(l => ([
        new Date(l.time).toLocaleString(),
        l.action || '',
        performerOf(l),
        l.qty ?? '',
        qtyDelta(l) ?? '',
        l.startingQty ?? '',
        topLevelLogCode(l) || '',
        normChangesString(l),
      ])),
    ].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ItemHistory_${itemCode}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
}

function buildActionChips(allLogs, $chips, activeActions, onChange) {
  const counts = new Map();
  for (const l of allLogs) {
    const a = l.action || 'event';
    counts.set(a, (counts.get(a) || 0) + 1);
  }

  // Order: known actions in HISTORY_ACTIONS order first, then any unexpected actions.
  const keysSeen = new Set(counts.keys());
  const ordered = [
    ...HISTORY_ACTIONS.map(a => a.key).filter(k => keysSeen.has(k)),
    ...[...keysSeen].filter(k => !ACTION_META[k]),
  ];

  const html = ordered.map(k => {
    const c = counts.get(k) || 0;
    return `<button type="button" class="hist-chip" data-action-filter="${escapeHtml(k)}">
      <span>${escapeHtml(actionLabel(k))}</span>
      <span class="hist-chip__count" data-count-for="${escapeHtml(k)}">${c}</span>
    </button>`;
  }).join('');

  $chips.html(html || '<span class="hist-result-count">No action types to filter.</span>');

  $chips.off('click.hist').on('click.hist', '.hist-chip', function () {
    const key = this.dataset.actionFilter;
    if (!key) return;
    if (activeActions.has(key)) activeActions.delete(key);
    else activeActions.add(key);
    this.classList.toggle('is-active', activeActions.has(key));
    onChange();
  });
}

function updateChipCounts(allLogs, $chips, activeActions) {
  // We could recompute counts against the currently visible subset, but keeping
  // chip counts anchored to the full dataset helps users gauge what clicking
  // a chip will reveal. Just reflect which are toggled.
  $chips.find('.hist-chip').each(function () {
    const key = this.dataset.actionFilter;
    this.classList.toggle('is-active', activeActions.has(key));
  });
}

function emptyStateHtml(title, hint) {
  return `
    <div class="hist-empty">
      <div class="hist-empty__icon" aria-hidden="true">📭</div>
      <div class="hist-empty__title">${escapeHtml(title)}</div>
      <div class="hist-empty__hint">${escapeHtml(hint)}</div>
    </div>`;
}

/* ------------------------------ bulk + toolbar ------------------------------ */

function showUndoSnackbar(deletedCodes) {
  const snackbar = document.createElement('div');
  snackbar.className = 'undo-snackbar fixed bottom-4 right-4 p-3 bg-gray-800 text-white rounded shadow z-50 flex items-center gap-4';
  snackbar.innerHTML = `
    <span>${deletedCodes.length} item(s) deleted).</span>
    <button class="btn btn-xs btn-primary" id="undoDeleteBtn">Undo</button>
  `;
  document.body.appendChild(snackbar);

  const timer = setTimeout(() => snackbar.remove(), 15000);

  document.getElementById('undoDeleteBtn').onclick = async () => {
    clearTimeout(timer);
    snackbar.remove();
    try {
      const res = await fetch(`${api.API_PREFIX}/undo-delete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      , body: JSON.stringify({ codes: deletedCodes }) });
      if (!res.ok) throw new Error('Undo failed');
      const data = await api.fetchInventory({ building: activeBuilding() });
      await renderTable(data);
      notyf.success('Restore successful!');
    } catch {
      notyf.error('Restore failed');
    }
  };
}

// Public: bind toolbar & other page UI
export function bindOtherUIEvents() {
  // Add Item
  $('#addItemBtn').off('click').on('click', () => {
    editingCode = null;
    $('#itemModal .tab-btn').removeClass('active');
    $('#itemModal .tab-pane').addClass('hidden');
    $('#tabBtnBasic').addClass('active');
    $('#tabBasic').removeClass('hidden');

    openModal({});
    // Reset the drop zone to its idle state for a new item
    window._refreshDropZone?.(null);
  });

  // Import CSV
  $('#importBtn').off('click').on('click', async () => {
    const file = $('#importFile')[0]?.files?.[0];
    if (!file) return notyf.error('Choose a CSV file');
    if (!confirmBuildingScope('import inventory items')) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('building', activeBuilding());
    try {
      const result = await api.importCsv(fd);
      if (result && typeof result === 'object') {
        const { created = 0, updated = 0, removed = 0, total = 0 } = result;
        notyf.success(`Imported • +${created} created, ${updated} updated, -${removed} removed • Total: ${total}`);
      } else {
        notyf.success('Imported');
      }
      const data = await api.fetchInventory({ building: activeBuilding() });
      await renderTable(data);
    } catch (e) {
      notyf.error(e.message || 'Import failed');
    }
  });

  // Export CSV, Export All History
  $('#exportCsvBtn').off('click').on('click', () => {
    if (!confirmBuildingScope('export inventory data')) return;
    window.location.href = `${api.API_PREFIX}/export?building=${encodeURIComponent(activeBuilding())}`;
  });

  $('#downloadImportTemplateBtn').off('click').on('click', () => {
    downloadCsv('inventory_import_template.csv', [
      ['ItemCode', 'Description', 'Category', 'Location', 'Building', 'OnHandQty', 'SafetyLevelQty', 'Vendor', 'PartNumber', 'UnitPrice', 'OrderStatus', 'PurchaseOrderNumber', 'TrackingNumber', 'OrderDate', 'ExpectedArrival', 'PurchaseLink'],
      ['', '', '', '', activeBuilding(), '', '', '', '', '', '', '', '', '', '', ''],
    ]);
  });

  $('#exportAllHistoryBtn').off('click').on('click', () => openModalById('exportAllHistoryModal'));
  $('#cancelExportAllHistory').off('click').on('click', () => closeAllModals());
  $('#exportAllHistoryForm').off('submit').on('submit', function (e) {
    e.preventDefault();
    const start = $('#historyStartDate').val();
    const end = $('#historyEndDate').val();
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const url = `${api.API_PREFIX}/audit-log/export${params.toString() ? `?${params}` : ''}`;
    window.location.href = url;
    closeAllModals();
  });

  // Bulk delete with undo
  $('#deleteSelectedBtn').off('click').on('click', () => {
    const codes = getSelectedCodes();
    if (!codes.length) return notyf.error('No items selected');
    openConfirm(`Delete ${codes.length} item(s)?`, async () => {
      try {
        await api.bulkDelete(codes);
        notyf.success('Bulk delete complete');
        const data = await api.fetchInventory({ building: activeBuilding() });
        await renderTable(data);
        showUndoSnackbar(codes);
        $('#selectAll').prop('checked', false);
        $('.bulk-toolbar').addClass('hidden');
      } catch (e) {
        notyf.error(e?.message || 'Bulk delete failed');
      }
    });
  });

  // Bulk reorder export
  $('#reorderSelectedBtn').off('click').on('click', async () => {
    const codes = getSelectedCodes();
    if (!codes.length) return notyf.error('No items selected');
    const requester = prompt('Enter Requester Name for the PO:', '');
    if (requester == null || requester.trim() === '') return notyf.error('PO Cancelled – requester required.');
    const justification = prompt('Enter Justification (optional):', '') || '';
    if (!confirmBuildingScope('export a bulk reorder file')) return;

    try {
      const { blob, filename } = await api.bulkReorderExport(codes, requester, justification);
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Empty file from server.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || `PO_bulk_reorder_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      notyf.success('Bulk reorder PO generated!');
      const data = await api.fetchInventory();
      await renderTable(data);
    } catch (e) {
      console.error('Bulk reorder download failed:', e);
      notyf.error(e?.message || 'Bulk reorder export failed.');
    }
  });

  // Bulk selection visibility
  $('#selectAll').off('change').on('change', function () {
    $('input.row-select').prop('checked', this.checked);
    $('.bulk-toolbar').toggleClass('hidden', !$('input.row-select:checked').length);
  });

  $('#inventoryTable')
    .off('change', 'input.row-select')
    .on('change', 'input.row-select', function () {
      const checked = $('input.row-select:checked').length;
      $('#selectAll').prop('checked', checked === $('input.row-select').length);
      $('.bulk-toolbar').toggleClass('hidden', checked === 0);
    });

  $('#cancelModal, #cancelCheckout, #cancelAudit, #cancelExportAllHistory')
    .off('click')
    .on('click', (e) => { e.preventDefault(); closeAllModals(); });
}
