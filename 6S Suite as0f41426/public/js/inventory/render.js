// public/js/inventory/render.js
import { API_PREFIX, imageUrl as apiImageUrl } from './api.js';
import { openModalById, closeAllModals } from './modals.js';
import { bindTableRowEvents } from './events.js';

let table = null;
let sourceData = [];

export function setSourceData(data) {
  sourceData = Array.isArray(data) ? data : [];
}

export function getSourceData() {
  return sourceData;
}

function normalizeCode(row = {}) {
  return String(
    row.ItemCode ??
    row.itemCode ??
    row.code ??
    row.Code ??
    row['Item Code'] ??
    ''
  ).trim();
}

function getImageUrl(code) {
  return `${apiImageUrl(code)}?${Date.now()}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '–';
}

function canDeleteInventoryItems() {
  const role = String(document.body?.dataset?.role || '').toLowerCase();
  return ['admin', 'lead', 'management', 'coordinator'].includes(role);
}

export function updateSummary(data) {
  if (!Array.isArray(data)) return;

  const totalSkusEl = document.getElementById('totalSkus');
  const belowSafetyEl = document.getElementById('belowSafetyCount');
  const pendingOrdersEl = document.getElementById('pendingOrders');
  const inventoryValueEl = document.getElementById('inventoryValue');

  if (totalSkusEl) totalSkusEl.textContent = data.length;
  if (belowSafetyEl) {
    belowSafetyEl.textContent = data.filter((row) => row.BelowSafetyLine).length;
  }
  if (pendingOrdersEl) {
    pendingOrdersEl.textContent = data.filter((row) => row.OrderStatus === 'Ordered').length;
  }

  const totalValue = data.reduce((sum, row) => {
    const qty = Number(row.OnHandQty) || 0;
    const price = Number(row.UnitPrice) || 0;
    return sum + qty * price;
  }, 0);

  if (inventoryValueEl) inventoryValueEl.textContent = `$${totalValue.toFixed(2)}`;
}

export function populateCategoryOptions(data) {
  const select = document.getElementById('filterCategory');
  if (!select) return;

  const current = select.value;
  const categories = Array.from(
    new Set(
      (data || [])
        .map((row) => (row.Category || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  select.innerHTML =
    '<option value="">All Categories</option>' +
    categories
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join('');

  if (current && categories.includes(current)) {
    select.value = current;
  }
}

function buildTableInfo(pageInfo) {
  const infoEl = document.getElementById('invTableInfo');
  if (!infoEl) return;

  const total = pageInfo.recordsTotal;
  const filtered = pageInfo.recordsDisplay;

  if (total === 0) {
    infoEl.textContent = 'No entries';
    return;
  }

  const start = pageInfo.start + 1;
  const end = pageInfo.end;

  infoEl.textContent =
    filtered < total
      ? `Showing ${start}–${end} of ${filtered} (filtered from ${total})`
      : `Showing ${start}–${end} of ${total} entries`;
}

function buildPager(dt) {
  const pagerEl = document.getElementById('invTablePager');
  if (!pagerEl) return;

  const info = dt.page.info();
  pagerEl.innerHTML = '';

  if (info.pages <= 1) return;

  function makeBtn(label, page, disabled = false, current = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-btn inv-btn--sm';
    button.textContent = label;
    button.disabled = disabled;

    if (current) {
      button.style.background = 'var(--accent)';
      button.style.color = '#fff';
      button.style.borderColor = 'var(--accent)';
      button.style.fontWeight = '700';
    }

    if (!disabled) {
      button.addEventListener('click', () => {
        dt.page(page).draw('page');
      });
    } else {
      button.style.opacity = '.35';
      button.style.cursor = 'not-allowed';
    }

    pagerEl.appendChild(button);
  }

  makeBtn('← Prev', info.page - 1, info.page === 0, false);

  const lo = Math.max(0, info.page - 2);
  const hi = Math.min(info.pages - 1, info.page + 2);

  for (let p = lo; p <= hi; p += 1) {
    makeBtn(String(p + 1), p, false, p === info.page);
  }

  makeBtn('Next →', info.page + 1, info.page >= info.pages - 1, false);
}

function syncFooter(dt) {
  if (!dt) return;
  buildTableInfo(dt.page.info());
  buildPager(dt);

  const pageLen = document.getElementById('invPageLen');
  if (pageLen) pageLen.value = String(dt.page.len());
}

function wirePageLength(dt) {
  const pageLen = document.getElementById('invPageLen');
  if (!pageLen || pageLen.dataset.wired === '1') return;

  pageLen.dataset.wired = '1';
  pageLen.addEventListener('change', () => {
    const value = Number.parseInt(pageLen.value, 10);
    dt.page.len(value).draw();
  });
}

export async function renderTable(data) {
  const cleanData = (Array.isArray(data) ? data : []).filter((row) => normalizeCode(row));
  updateSummary(cleanData);

  const $table = $('#inventoryTable');
  if ($table.length === 0) return null;

  if ($.fn.DataTable.isDataTable($table)) {
    table.destroy();
    $table.find('tbody').empty();
  }

  table = $table.DataTable({
    data: cleanData,
    destroy: true,
    deferRender: true,
    paging: true,
    pageLength: 20,
    autoWidth: false,
    responsive: false,
    searching: false,
    info: false,
    lengthChange: false,
    ordering: true,
    order: [[1, 'asc']],
    dom: 't',
    columns: [
      {
        data: null,
        orderable: false,
        searchable: false,
        className: 'dt-body-center dt-head-center',
        render: (row) => {
          const code = normalizeCode(row);
          return `<input type="checkbox" class="row-select" data-code="${escapeHtml(code)}" aria-label="Select row for ${escapeHtml(code)}"/>`;
        }
      },
      {
        data: null,
        className: 'code-cell',
        render: (_value, _type, row) => {
          const code = normalizeCode(row);
          return `
            <div class="code-hover-group" data-code="${escapeHtml(code)}">
              <img
                src="${getImageUrl(code)}"
                class="code-thumb js-thumb"
                alt="Item image for ${escapeHtml(code)}"
                loading="lazy"
              />
              <span
                class="code-value"
                data-code="${escapeHtml(code)}"
                tabindex="0"
                aria-label="Open details for item code ${escapeHtml(code)}"
              >${escapeHtml(code)}</span>
              <input type="file" class="image-upload-input hidden" data-code="${escapeHtml(code)}" accept="image/*"/>
              <button type="button" class="btn btn-xs btn-secondary btn-img-upload" data-code="${escapeHtml(code)}" aria-label="Upload image for ${escapeHtml(code)}">Image</button>
            </div>
          `;
        }
      },
      {
        data: 'Description',
        defaultContent: '–',
        render: (value) => escapeHtml(value ?? '–')
      },
      {
        data: 'OnHandQty',
        defaultContent: '–',
        render: (value) => Number(value ?? 0)
      },
      {
        data: 'Category',
        defaultContent: '–',
        render: (value) => escapeHtml(value ?? '–')
      },
      {
        data: 'Vendor',
        defaultContent: '–',
        render: (value) => escapeHtml(value ?? '–')
      },
      {
        data: 'OrderStatus',
        defaultContent: '–',
        render: (status) => {
          const text = escapeHtml(status ?? '');
          if (status === 'Ordered') return '<span class="badge badge-info">Ordered</span>';
          if (status === 'In Stock') return '<span class="badge badge-success">In Stock</span>';
          if (status === 'Low Stock') return '<span class="badge badge-warning">Low Stock</span>';
          if (status === 'Out of Stock') return '<span class="badge badge-error">Out of Stock</span>';
          return text ? `<span class="badge">${text}</span>` : '–';
        }
      },
      {
        data: null,
        orderable: false,
        searchable: false,
        className: 'action-cell',
        render: (_value, _type, row) => {
          const code = escapeHtml(normalizeCode(row));
          const deleteButton = canDeleteInventoryItems()
            ? `<button class="btn btn-delete" type="button" data-code="${code}" aria-label="Delete ${code}">Delete</button>`
            : '';
          return `
            <div class="row-actions">
              <button class="btn btn-audit" type="button" data-code="${code}" aria-label="History for ${code}">History</button>
              <button class="btn btn-edit" type="button" data-code="${code}" aria-label="Edit ${code}">Edit</button>
              ${deleteButton}
              <button class="btn btn-checkout" type="button" data-code="${code}" aria-label="Checkout ${code}">Checkout</button>
            </div>
          `;
        }
      }
    ],
    createdRow: (row, rowData) => {
      const code = normalizeCode(rowData);

      if (rowData.BelowSafetyLine) $(row).addClass('low-stock');
      if ((Number(rowData.OnHandQty) || 0) === 0) $(row).addClass('out-of-stock');

      $(row).attr('data-code', code);
      $(row).attr('title', `${code} — ${rowData.Description || ''}`);
    },
    drawCallback: function () {
      syncFooter(this.api());

      $('#inventoryTable img.js-thumb')
        .off('error')
        .on('error', function onImgError() {
          $(this).addClass('hidden');
        });

      $('#inventoryTable .code-value')
        .off('click keydown')
        .on('click', async function onCodeClick() {
          await showDetails($(this).data('code'));
        })
        .on('keydown', async function onCodeKeydown(e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            await showDetails($(this).data('code'));
          }
        });

      $('#closeItemDetails')
        .off('click')
        .on('click', () => closeAllModals());

      $('#inventoryTable .btn-img-upload')
        .off('click')
        .on('click', function onUploadButtonClick(e) {
          e.stopPropagation();
          $(this).closest('.code-hover-group').find('.image-upload-input').trigger('click');
        });

      $('#inventoryTable .image-upload-input')
        .off('change')
        .on('change', async function onUploadInputChange() {
          const file = this.files?.[0];
          const code = $(this).data('code');
          if (!file || !code) return;

          const formData = new FormData();
          formData.append('image', file);

          try {
            const response = await fetch(`${API_PREFIX}/${encodeURIComponent(code)}/image`, {
              method: 'POST',
              body: formData,
              credentials: 'include',
              headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (!response.ok) throw new Error('Upload failed');

            $(this)
              .closest('.code-hover-group')
              .find('img.code-thumb')
              .attr('src', getImageUrl(code));

            window.notyf?.success('Image uploaded!');
          } catch {
            window.notyf?.error('Upload failed');
          }
        });

      bindTableRowEvents(this.api());
    },
    initComplete: function () {
      const dt = this.api();
      wirePageLength(dt);
      syncFooter(dt);
    }
  });

  return table;
}

/* ---------------------- item details modal helpers ---------------------- */

const DET_ACTION_LABEL = {
  create: 'Created',
  update: 'Updated',
  checkout: 'Checked out',
  checkin: 'Checked in',
  delete: 'Deleted',
  restore: 'Restored',
  bulk_delete: 'Bulk delete',
  bulk_reorder: 'Marked to reorder',
  import_create: 'Imported (new)',
  import_update: 'Imported (updated)',
  import_update_rename: 'Imported (renamed)',
  import_remove: 'Imported (removed)',
  image_upload: 'Image uploaded',
  image_remove: 'Image removed',
};
function _detIc(paths) {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const DET_ACTION_ICON_HTML = {
  create: _detIc('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  update: _detIc('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  checkout: _detIc('<path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/>'),
  checkin: _detIc('<path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/>'),
  delete: _detIc('<path d="M18 6 6 18M6 6l12 12"/>'),
  restore: _detIc('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  bulk_delete: _detIc('<path d="M18 6 6 18M6 6l12 12"/>'),
  bulk_reorder: _detIc('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  import_create: _detIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_update: _detIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_update_rename: _detIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  import_remove: _detIc('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  image_upload: _detIc('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
  image_remove: _detIc('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>'),
};

function detPerformer(l) {
  return l?.operatorId || l?.performedBy || l?.sixSOperator || l?.actor || 'system';
}

function detRelativeTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function detAbsoluteTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function detNormalizeChanges(log) {
  if (log && log.fieldChanges && typeof log.fieldChanges === 'object') return log.fieldChanges;
  if (log && Array.isArray(log.changes)) {
    const obj = {};
    for (const c of log.changes) {
      const key = c?.field || c?.key || '';
      if (key) obj[key] = { from: c.from, to: c.to };
    }
    return obj;
  }
  return {};
}

function detStockStatus(item) {
  const qty = Number(item.OnHandQty) || 0;
  const safety = Number(item.SafetyLevelQty) || 0;
  if (qty <= 0) return { tone: 'danger', label: 'Out of stock' };
  if (item.BelowSafetyLine || (safety > 0 && qty < safety)) return { tone: 'warn', label: 'Low stock' };
  return { tone: 'ok', label: 'In stock' };
}

function detOrderStatusTone(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return 'neutral';
  if (s.includes('order')) return 'info';
  if (s.includes('arriv') || s.includes('receiv')) return 'ok';
  if (s.includes('back') || s.includes('cancel') || s.includes('hold')) return 'warn';
  return 'neutral';
}

function detField(label, rawValue, opts = {}) {
  const isEmpty = rawValue == null || rawValue === '' || rawValue === '–';
  const valueClass = [
    'det-field__value',
    isEmpty ? 'det-field__value--muted' : '',
    opts.mono ? 'det-field__value--mono' : '',
  ].filter(Boolean).join(' ');
  const display = isEmpty ? '—' : (opts.raw ? rawValue : escapeHtml(rawValue));
  const wide = opts.wide ? ' det-field--wide' : '';
  return `
    <div class="det-field${wide}">
      <span class="det-field__label">${escapeHtml(label)}</span>
      <span class="${valueClass}">${display}</span>
    </div>`;
}

function detActivityRowHtml(l) {
  const action = l.action || 'event';
  const label = DET_ACTION_LABEL[action] || action;
  const dotInner = DET_ACTION_ICON_HTML[action] || escapeHtml('•');
  const performer = detPerformer(l);
  const qty = (l.qty != null && Number.isFinite(+l.qty)) ? +l.qty : null;
  const changes = Object.keys(detNormalizeChanges(l) || {});

  let qtyOrChangesHtml = '';
  if (action === 'checkout' && qty != null) qtyOrChangesHtml = ` · <span>−${qty} units</span>`;
  else if (action === 'checkin' && qty != null) qtyOrChangesHtml = ` · <span>+${qty} units</span>`;
  else if (qty != null && qty !== 0 && action !== 'create') qtyOrChangesHtml = ` · <span>${qty}</span>`;
  else if (changes.length) {
    qtyOrChangesHtml = ` · <span>${changes.length} field${changes.length === 1 ? '' : 's'} changed</span>`;
  }

  return `
    <div class="det-activity__row" data-action="${escapeHtml(action)}" title="${escapeHtml(detAbsoluteTime(l.time))}">
      <span class="det-activity__dot" aria-hidden="true">${dotInner}</span>
      <span class="det-activity__main">
        <span class="det-activity__action">${escapeHtml(label)}</span>
        <span class="det-activity__by">by <strong>${escapeHtml(performer)}</strong></span>
        <span class="det-activity__by">${qtyOrChangesHtml}</span>
      </span>
      <span class="det-activity__time">${escapeHtml(detRelativeTime(l.time))}</span>
    </div>`;
}

async function showDetails(code) {
  if (!code) return;

  const titleEl = document.getElementById('itemDetailsTitle');
  const subtitleEl = document.getElementById('itemDetailsSubtitle');
  const bodyEl = document.getElementById('itemDetailsBody');
  const editBtn = document.getElementById('itemDetailsEditBtn');
  const histBtn = document.getElementById('itemDetailsHistoryBtn');
  const expandBtn = document.getElementById('expandItemDetails');
  if (!titleEl || !bodyEl) return;

  if (titleEl) titleEl.textContent = 'Item Details';
  if (subtitleEl) subtitleEl.innerHTML = `<code>${escapeHtml(code)}</code>`;

  bodyEl.setAttribute('aria-busy', 'true');
  bodyEl.innerHTML = `
    <div class="det-skeleton">
      <div class="det-skeleton__hero"></div>
      <div class="det-skeleton__section"></div>
      <div class="det-skeleton__section"></div>
    </div>`;
  openModalById('itemDetailsModal');

  let item;
  let logs = [];
  try {
    const [itemRes, logsRes] = await Promise.all([
      fetch(`${API_PREFIX}/${encodeURIComponent(code)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      }),
      fetch(`${API_PREFIX}/audit-log?itemCode=${encodeURIComponent(code)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      }),
    ]);
    if (!itemRes.ok) throw new Error('Item fetch failed');
    item = await itemRes.json();
    if (!item || item.message === 'Not found') {
      window.notyf?.error('Item not found.');
      bodyEl.setAttribute('aria-busy', 'false');
      bodyEl.innerHTML = `<div class="det-activity__empty">Item not found.</div>`;
      return;
    }
    logs = logsRes.ok ? await logsRes.json() : [];
  } catch (err) {
    console.error(err);
    window.notyf?.error('Failed to load details');
    bodyEl.setAttribute('aria-busy', 'false');
    bodyEl.innerHTML = `<div class="det-activity__empty">Couldn't load details.</div>`;
    return;
  }

  // Filter logs to just this code (server returns all; mirror history-modal behavior)
  const scopedLogs = Array.isArray(logs)
    ? logs
        .filter(l => {
          const top = l?.itemCode || l?.ItemCode || l?.code || l?.sku;
          return !top || String(top) === String(code) || String(top) === String(item.ItemCode);
        })
        .sort((a, b) => new Date(b.time) - new Date(a.time))
    : [];

  // Header
  if (titleEl) titleEl.textContent = item.ItemCode || code;
  if (subtitleEl) {
    const desc = (item.Description || '').trim();
    subtitleEl.innerHTML = desc
      ? `<span>${escapeHtml(desc)}</span>`
      : `<span class="det-field__value--muted">No description</span>`;
  }

  // Hero metrics
  const onHand = Number(item.OnHandQty) || 0;
  const safety = Number(item.SafetyLevelQty) || 0;
  const unitPrice = Number(item.UnitPrice) || 0;
  const totalValue = onHand * unitPrice;
  const stock = detStockStatus(item);
  const orderTone = detOrderStatusTone(item.OrderStatus);

  const qtyTone = stock.tone === 'ok' ? '' :
                   stock.tone === 'danger' ? 'danger' : 'warn';
  const safetyTone = safety > 0 && onHand < safety ? 'warn' : '';

  const purchaseLink = (item.PurchaseLink || '').trim();
  const purchaseHtml = purchaseLink
    ? `<a href="${escapeHtml(purchaseLink)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`
    : '';

  // Recent activity (compact, max 5)
  const RECENT_LIMIT = 5;
  const recent = scopedLogs.slice(0, RECENT_LIMIT);
  let recentHtml;
  if (!scopedLogs.length) {
    recentHtml = `<div class="det-activity__empty">No activity yet.</div>`;
  } else {
    recentHtml = `
      <div class="det-activity__list">
        ${recent.map(detActivityRowHtml).join('')}
      </div>
      ${
        scopedLogs.length > RECENT_LIMIT
          ? `<button type="button" class="det-activity__more" id="detailsOpenHistory">
               +${scopedLogs.length - RECENT_LIMIT} more event${scopedLogs.length - RECENT_LIMIT === 1 ? '' : 's'} — view full history →
             </button>`
          : ''
      }`;
  }

  bodyEl.setAttribute('aria-busy', 'false');
  bodyEl.innerHTML = `
    <section class="det-hero">
      <div class="det-hero__image">
        <img src="${getImageUrl(item.ItemCode)}" alt="Image for ${escapeHtml(item.ItemCode)}" class="js-thumb" loading="lazy"/>
      </div>
      <div class="det-hero__right">
        <div class="det-badges">
          <span class="det-badge" data-tone="${stock.tone}">${escapeHtml(stock.label)}</span>
          ${item.OrderStatus
            ? `<span class="det-badge" data-tone="${orderTone}">${escapeHtml(item.OrderStatus)}</span>`
            : ''}
          ${item.SafetyWarningOn
            ? `<span class="det-badge" data-tone="warn">Safety warning on</span>`
            : ''}
          ${item.Category
            ? `<span class="det-badge" data-tone="neutral">${escapeHtml(item.Category)}</span>`
            : ''}
        </div>
        <div class="det-metrics">
          <div class="det-metric" data-tone="${qtyTone}">
            <span class="det-metric__label">On Hand</span>
            <span class="det-metric__value">${onHand.toLocaleString()}</span>
            <span class="det-metric__sub">unit${onHand === 1 ? '' : 's'}</span>
          </div>
          <div class="det-metric" data-tone="${safetyTone}">
            <span class="det-metric__label">Safety Level</span>
            <span class="det-metric__value">${safety.toLocaleString()}</span>
            <span class="det-metric__sub">
              ${safety > 0
                ? (onHand < safety
                    ? `short ${(safety - onHand).toLocaleString()}`
                    : `buffer +${(onHand - safety).toLocaleString()}`)
                : 'not set'}
            </span>
          </div>
          <div class="det-metric">
            <span class="det-metric__label">Unit Price</span>
            <span class="det-metric__value">${safeMoney(item.UnitPrice)}</span>
            <span class="det-metric__sub">${item.Vendor ? escapeHtml(item.Vendor) : '—'}</span>
          </div>
          <div class="det-metric">
            <span class="det-metric__label">Total Value</span>
            <span class="det-metric__value">$${totalValue.toFixed(2)}</span>
            <span class="det-metric__sub">on-hand × price</span>
          </div>
        </div>
      </div>
    </section>

    <section class="det-section">
      <header class="det-section__header">
        <span>Location &amp; identification</span>
      </header>
      <div class="det-grid">
        ${detField('Item Code', item.ItemCode, { mono: true })}
        ${detField('Category', item.Category)}
        ${detField('Location', item.Location)}
        ${detField('Building', item.Building)}
        ${detField('Description', item.Description, { wide: true })}
      </div>
    </section>

    <section class="det-section">
      <header class="det-section__header">
        <span>Purchase &amp; order</span>
      </header>
      <div class="det-grid">
        ${detField('Vendor', item.Vendor)}
        ${detField('Order Status', item.OrderStatus)}
        ${detField('PO Number', item.PurchaseOrderNumber, { mono: true })}
        ${detField('Tracking #', item.TrackingNumber, { mono: true })}
        ${detField('Order Date', item.OrderDate)}
        ${detField('Expected Arrival', item.ExpectedArrival)}
        ${purchaseLink
          ? detField('Purchase Link', purchaseHtml, { wide: true, raw: true })
          : detField('Purchase Link', '', { wide: true })}
      </div>
    </section>

    <section class="det-section det-activity">
      <header class="det-section__header">
        <span>Recent activity</span>
        <span class="det-section__header-spacer"></span>
        ${scopedLogs.length
          ? `<button type="button" class="det-section__action" id="detailsOpenHistoryTop">View full history →</button>`
          : ''}
      </header>
      ${recentHtml}
    </section>
  `;

  $(bodyEl).find('img.js-thumb').on('error', function onDetailsImageError() {
    const wrap = this.closest('.det-hero__image');
    if (wrap) {
      wrap.classList.add('det-hero__image--empty');
      wrap.innerHTML = 'No image';
    } else {
      this.classList.add('hidden');
    }
  });

  // --- footer + inline actions ---
  const openHistoryForCode = () => {
    const btn = document.querySelector(
      `#inventoryTable tbody tr[data-code="${window.CSS?.escape ? CSS.escape(code) : code}"] .btn-audit`
    );
    if (btn) {
      btn.click();
    } else {
      window.notyf?.error('Open the row menu to view history.');
    }
  };
  const openEditForCode = () => {
    const btn = document.querySelector(
      `#inventoryTable tbody tr[data-code="${window.CSS?.escape ? CSS.escape(code) : code}"] .btn-edit`
    );
    if (btn) btn.click();
    else window.notyf?.error('Edit is only available from the row.');
  };

  if (histBtn) {
    histBtn.onclick = openHistoryForCode;
    histBtn.disabled = !scopedLogs.length;
    histBtn.title = scopedLogs.length
      ? `Open the full audit history (${scopedLogs.length} event${scopedLogs.length === 1 ? '' : 's'})`
      : 'No history recorded';
  }
  if (editBtn) editBtn.onclick = openEditForCode;

  // Inline shortcuts inside the body
  const topLink = document.getElementById('detailsOpenHistoryTop');
  if (topLink) topLink.onclick = openHistoryForCode;
  const moreLink = document.getElementById('detailsOpenHistory');
  if (moreLink) moreLink.onclick = openHistoryForCode;

  // Expand toggle (previously a dead button)
  if (expandBtn) {
    expandBtn.onclick = () => {
      const modal = document.querySelector('#itemDetailsModal .modal');
      if (!modal) return;
      const expanded = modal.classList.toggle('modal--fullscreen');
      expandBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      expandBtn.textContent = expanded ? 'Collapse' : 'Expand';
    };
  }
}

export function getTableInstance() {
  return table;
}
