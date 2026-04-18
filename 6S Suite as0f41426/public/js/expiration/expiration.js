const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const state = {
  items: [],
  summary: {},
  filters: { locations: [], owners: [], types: [] },
  selectedIdsByType: new Map(),
  activeView: 'list',
  activeKpiFilter: '',
  currentItem: null,
  currentMonthDate: new Date(),
};

const els = {
  liveRegion: document.getElementById('liveRegion'),
  ceMeta: document.getElementById('ceMeta'),
  ceCount: document.getElementById('ceCount'),
  loadingSkel: document.getElementById('loadingSkel'),
  emptyView: document.getElementById('emptyView'),
  listView: document.getElementById('listView'),
  boardView: document.getElementById('boardView'),
  calendarView: document.getElementById('calendarView'),
  tableBody: document.getElementById('tableBody'),

  kpiOverdue: document.getElementById('kpiOverdue'),
  kpiDue7: document.getElementById('kpiDue7'),
  kpiDue30: document.getElementById('kpiDue30'),
  kpiOk: document.getElementById('kpiOk'),
  kpiMissing: document.getElementById('kpiMissing'),
  kpiCompletedWeek: document.getElementById('kpiCompletedWeek'),

  selDays: document.getElementById('selDays'),
  selType: document.getElementById('selType'),
  selStatus: document.getElementById('selStatus'),
  selLocation: document.getElementById('selLocation'),
  selOwner: document.getElementById('selOwner'),
  selSort: document.getElementById('selSort'),
  searchItems: document.getElementById('searchItems'),
  chkOnlyMine: document.getElementById('chkOnlyMine'),

  btnRefresh: document.getElementById('btnRefresh'),
  btnExport: document.getElementById('btnExport'),

  tabs: [...document.querySelectorAll('.ce-tab')],
  kpiCards: [...document.querySelectorAll('.ce-kpi[data-kpi]')],

  bulkBar: document.getElementById('bulkBar'),
  bulkCount: document.getElementById('bulkCount'),
  bulkAction: document.getElementById('bulkAction'),
  bulkDueDate: document.getElementById('bulkDueDate'),
  btnApplyBulk: document.getElementById('btnApplyBulk'),
  btnClearBulk: document.getElementById('btnClearBulk'),
  chkAllRows: document.getElementById('chkAllRows'),

  monthLabel: document.getElementById('monthLabel'),
  calHeaders: document.getElementById('calHeaders'),
  calCells: document.getElementById('calCells'),
  btnPrevMonth: document.getElementById('btnPrevMonth'),
  btnNextMonth: document.getElementById('btnNextMonth'),

  drawerBackdrop: document.getElementById('drawerBackdrop'),
  itemDrawer: document.getElementById('itemDrawer'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  drawerTitle: document.getElementById('drawerTitle'),
  drawerSub: document.getElementById('drawerSub'),
  drawerOverview: document.getElementById('drawerOverview'),
  drawerHistory: document.getElementById('drawerHistory'),

  drawerForm: document.getElementById('drawerForm'),
  fLocation: document.getElementById('fLocation'),
  fOwner: document.getElementById('fOwner'),
  fLastCompletedDate: document.getElementById('fLastCompletedDate'),
  fIntervalDays: document.getElementById('fIntervalDays'),
  fDueDate: document.getElementById('fDueDate'),
  fRawStatus: document.getElementById('fRawStatus'),
  fVendor: document.getElementById('fVendor'),
  fCertificateNumber: document.getElementById('fCertificateNumber'),
  fReason: document.getElementById('fReason'),
  fNotes: document.getElementById('fNotes'),

  btnSaveDrawer: document.getElementById('btnSaveDrawer'),
  btnResetDrawer: document.getElementById('btnResetDrawer'),
  btnMarkComplete: document.getElementById('btnMarkComplete'),
  btnReschedule: document.getElementById('btnReschedule'),
  btnOutOfService: document.getElementById('btnOutOfService'),
};

function announce(msg) {
  els.liveRegion.textContent = '';
  window.setTimeout(() => { els.liveRegion.textContent = msg; }, 10);
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusClass(status) {
  return `ce-badge--${status || 'missing'}`;
}

function typeClass(type) {
  return `ce-badge--${type || 'asset'}`;
}

function daysText(item) {
  if (item.daysUntil == null) return 'No due date';
  if (item.daysUntil < 0) return `${Math.abs(item.daysUntil)} day${Math.abs(item.daysUntil) === 1 ? '' : 's'} overdue`;
  if (item.daysUntil === 0) return 'Due today';
  return `Due in ${item.daysUntil} day${item.daysUntil === 1 ? '' : 's'}`;
}

function daysClass(item) {
  if (item.daysUntil == null) return 'is-missing';
  if (item.daysUntil < 0) return 'is-overdue';
  if (item.daysUntil <= 30) return 'is-due';
  return 'is-ok';
}

function currentQuery() {
  const status = state.activeKpiFilter || els.selStatus.value;
  return {
    days: els.selDays.value,
    type: els.selType.value,
    status,
    search: els.searchItems.value.trim(),
    location: els.selLocation.value,
    owner: els.selOwner.value,
    onlyMine: els.chkOnlyMine.checked ? 'true' : '',
    sort: els.selSort.value,
  };
}

function queryString(obj) {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => {
    if (v != null && String(v) !== '') params.set(k, String(v));
  });
  return params.toString();
}

function setLoading(loading) {
  els.loadingSkel.style.display = loading ? '' : 'none';
  if (loading) {
    els.listView.style.display = 'none';
    els.boardView.style.display = 'none';
    els.calendarView.style.display = 'none';
    els.emptyView.style.display = 'none';
  }
}

async function fetchJSON(url, options) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

function fillSelect(selectEl, values, defaultLabel) {
  const current = selectEl.value;
  const options = [`<option value="">${defaultLabel}</option>`]
    .concat(values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`));
  selectEl.innerHTML = options.join('');
  if ([...selectEl.options].some((o) => o.value === current)) {
    selectEl.value = current;
  }
}

async function loadItems() {
  setLoading(true);

  try {
    const qs = queryString(currentQuery());
    const data = await fetchJSON(`/expiration/api?${qs}`);

    state.items = Array.isArray(data.items) ? data.items : [];
    state.summary = data.summary || {};
    state.filters = data.filters || { locations: [], owners: [], types: [] };

    fillSelect(els.selLocation, state.filters.locations || [], 'All locations');
    fillSelect(els.selOwner, state.filters.owners || [], 'All owners');

    renderSummary();
    renderActiveView();
    syncBulkBar();
    updateMeta();

    announce(`${state.items.length} items loaded`);
  } catch (err) {
    console.error(err);
    els.ceMeta.textContent = 'Unable to load data';
    els.emptyView.style.display = '';
    els.loadingSkel.style.display = 'none';
  }
}

function renderSummary() {
  els.kpiOverdue.textContent = state.summary.overdue || 0;
  els.kpiDue7.textContent = state.summary.due7 || 0;
  els.kpiDue30.textContent = state.summary.due30 || 0;
  els.kpiOk.textContent = state.summary.ok || 0;
  els.kpiMissing.textContent = state.summary.missing || 0;
  els.kpiCompletedWeek.textContent = state.summary.completedThisWeek || 0;

  for (const card of els.kpiCards) {
    const key = card.dataset.kpi;
    card.classList.toggle('active', key === state.activeKpiFilter);
  }
}

function updateMeta() {
  const windowLabel = els.selDays.options[els.selDays.selectedIndex]?.text || `${els.selDays.value} days`;
  els.ceMeta.textContent = `${state.items.length} visible items in ${windowLabel}`;
  els.ceCount.textContent = `${state.items.length} item${state.items.length === 1 ? '' : 's'}`;
}

function renderActiveView() {
  els.loadingSkel.style.display = 'none';

  if (!state.items.length) {
    els.emptyView.style.display = '';
    els.listView.style.display = 'none';
    els.boardView.style.display = 'none';
    els.calendarView.style.display = 'none';
    return;
  }

  els.emptyView.style.display = 'none';

  if (state.activeView === 'list') {
    els.listView.style.display = '';
    els.boardView.style.display = 'none';
    els.calendarView.style.display = 'none';
    renderList();
  } else if (state.activeView === 'board') {
    els.listView.style.display = 'none';
    els.boardView.style.display = '';
    els.calendarView.style.display = 'none';
    renderBoard();
  } else {
    els.listView.style.display = 'none';
    els.boardView.style.display = 'none';
    els.calendarView.style.display = '';
    renderCalendar();
  }
}

function renderList() {
  const rows = state.items.map((item) => {
    const selected = isSelected(item.type, item.id);
    return `
      <tr class="ce-row" data-type="${esc(item.type)}" data-id="${esc(item.id)}">
        <td>
          <input class="ce-check row-check" type="checkbox"
            data-type="${esc(item.type)}"
            data-id="${esc(item.id)}"
            ${selected ? 'checked' : ''}/>
        </td>
        <td>
          <div class="ce-item-title">${esc(item.label)}</div>
          <div class="ce-item-sub">
            ${esc(item.serialNumber || item.tagNumber || '—')}
            ${item.classification ? ` • ${esc(item.classification)}` : ''}
          </div>
        </td>
        <td>
          <span class="ce-badge ${typeClass(item.type)}">${esc(item.type)}</span>
        </td>
        <td>${esc(item.location || '—')}</td>
        <td>${esc(fmtDate(item.lastCompletedDate))}</td>
        <td>${esc(fmtDate(item.dueDate))}</td>
        <td><span class="ce-days ${daysClass(item)}">${esc(daysText(item))}</span></td>
        <td>${esc(item.owner || '—')}</td>
        <td><span class="ce-badge ${statusClass(item.status)}">${esc(item.statusLabel || item.status || 'Unknown')}</span></td>
        <td>
          <div class="ce-actions">
            <button class="ce-mini-btn btn-open" data-type="${esc(item.type)}" data-id="${esc(item.id)}">Open</button>
            <button class="ce-mini-btn btn-complete" data-type="${esc(item.type)}" data-id="${esc(item.id)}">Complete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  els.tableBody.innerHTML = rows;
  els.chkAllRows.checked = state.items.length > 0 && state.items.every((x) => isSelected(x.type, x.id));
}

function renderBoard() {
  const columns = [
    { key: 'overdue', title: 'Overdue' },
    { key: 'due-7', title: 'Due in 7 days' },
    { key: 'due-30', title: 'Due in 30 days' },
    { key: 'missing', title: 'Needs setup' },
  ];

  els.boardView.innerHTML = `
    <div class="ce-board">
      ${columns.map((col) => {
        const items = state.items.filter((x) => x.status === col.key);
        return `
          <section class="ce-col">
            <div class="ce-col-head">
              <span>${esc(col.title)}</span>
              <span class="ce-badge ${statusClass(col.key)}">${items.length}</span>
            </div>
            <div class="ce-col-list">
              ${items.length ? items.map((item) => `
                <article class="ce-card" data-open-type="${esc(item.type)}" data-open-id="${esc(item.id)}">
                  <div class="ce-card-head">
                    <div class="ce-card-title">${esc(item.label)}</div>
                    <span class="ce-badge ${typeClass(item.type)}">${esc(item.type)}</span>
                  </div>
                  <div class="ce-card-meta">${esc(item.location || '—')} • ${esc(item.owner || 'Unassigned')}</div>
                  <div class="ce-card-meta">${esc(fmtDate(item.dueDate))} • ${esc(daysText(item))}</div>
                </article>
              `).join('') : `<div class="ce-empty" style="padding:1.5rem .8rem;"><div>Nothing here</div></div>`}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function renderCalendar() {
  const current = new Date(state.currentMonthDate.getFullYear(), state.currentMonthDate.getMonth(), 1);
  els.monthLabel.textContent = `${MONTH_NAMES[current.getMonth()]} ${current.getFullYear()}`;

  els.calHeaders.innerHTML = DAY_NAMES.map((d) => `<div class="ce-day-head">${d}</div>`).join('');

  const byDate = new Map();
  for (const item of state.items) {
    if (!item.dueDate) continue;
    const key = item.dueDate;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(item);
  }

  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  const last = new Date(current.getFullYear(), current.getMonth() + 1, 0);
  const startPad = first.getDay();

  const cells = [];

  for (let i = 0; i < startPad; i += 1) {
    cells.push(buildCalendarCell(new Date(current.getFullYear(), current.getMonth(), 1 - (startPad - i)), true));
  }
  for (let d = 1; d <= last.getDate(); d += 1) {
    cells.push(buildCalendarCell(new Date(current.getFullYear(), current.getMonth(), d), false));
  }

  const used = startPad + last.getDate();
  const trailing = (7 - (used % 7)) % 7;
  for (let i = 1; i <= trailing; i += 1) {
    cells.push(buildCalendarCell(new Date(current.getFullYear(), current.getMonth() + 1, i), true));
  }

  els.calCells.innerHTML = cells.join('');

  function buildCalendarCell(date, other) {
    const iso = date.toISOString().slice(0, 10);
    const todayIso = new Date().toISOString().slice(0, 10);
    const items = byDate.get(iso) || [];
    return `
      <div class="ce-day ${other ? 'other' : ''} ${iso === todayIso ? 'today' : ''}">
        <div class="ce-day-num">${date.getDate()}</div>
        ${items.slice(0, 3).map((item) => `
          <div class="ce-event ce-event--${esc(item.status)}" data-open-type="${esc(item.type)}" data-open-id="${esc(item.id)}">
            ${esc(item.serialNumber || item.tagNumber || item.label)}
          </div>
        `).join('')}
        ${items.length > 3 ? `<div class="ce-item-sub">+${items.length - 3} more</div>` : ''}
      </div>
    `;
  }
}

function isSelected(type, id) {
  const key = `${type}:${id}`;
  return state.selectedIdsByType.has(key);
}

function setSelected(type, id, selected) {
  const key = `${type}:${id}`;
  if (selected) state.selectedIdsByType.set(key, { type, id });
  else state.selectedIdsByType.delete(key);
}

function clearSelection() {
  state.selectedIdsByType.clear();
  syncBulkBar();
  renderActiveView();
}

function syncBulkBar() {
  const count = state.selectedIdsByType.size;
  els.bulkCount.textContent = String(count);
  els.bulkBar.classList.toggle('open', count > 0);
}

async function openDrawer(type, id) {
  try {
    const item = await fetchJSON(`/expiration/api/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    state.currentItem = item;

    els.drawerTitle.textContent = item.label || 'Item';
    els.drawerSub.textContent = `${item.type || 'item'} • ${item.serialNumber || item.tagNumber || item.id}`;

    els.drawerOverview.innerHTML = [
      row('Type', item.type),
      row('Serial', item.serialNumber || '—'),
      row('Tag', item.tagNumber || '—'),
      row('Location', item.location || '—'),
      row('Owner', item.owner || '—'),
      row('Last completed', fmtDate(item.lastCompletedDate)),
      row('Next due', fmtDate(item.dueDate)),
      row('Interval', item.intervalDays ? `${item.intervalDays} days` : '—'),
      row('Status', item.statusLabel || item.status || '—'),
    ].join('');

    els.fLocation.value = item.location || '';
    els.fOwner.value = item.owner || '';
    els.fLastCompletedDate.value = item.lastCompletedDate || '';
    els.fIntervalDays.value = item.intervalDays ?? '';
    els.fDueDate.value = item.dueDate || '';
    els.fRawStatus.value = '';
    els.fVendor.value = item.vendor || '';
    els.fCertificateNumber.value = item.certificateNumber || '';
    els.fReason.value = '';
    els.fNotes.value = '';

    renderHistory(item.history || []);

    els.itemDrawer.classList.add('open');
    els.drawerBackdrop.classList.add('open');
    els.itemDrawer.setAttribute('aria-hidden', 'false');

    announce(`Opened ${item.label}`);
  } catch (err) {
    console.error(err);
    alert('Unable to load item details.');
  }

  function row(label, value) {
    return `<div class="ce-info-row"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
  }
}

function closeDrawer() {
  els.itemDrawer.classList.remove('open');
  els.drawerBackdrop.classList.remove('open');
  els.itemDrawer.setAttribute('aria-hidden', 'true');
  state.currentItem = null;
}

function renderHistory(history) {
  if (!history.length) {
    els.drawerHistory.innerHTML = `<div class="ce-foot-note">No history yet.</div>`;
    return;
  }

  els.drawerHistory.innerHTML = history.map((entry) => `
    <div class="ce-history-item">
      <div class="ce-history-top">
        <span class="ce-history-action">${esc(entry.action || 'update')}</span>
        <span>${esc(fmtDate(entry.at))}</span>
      </div>
      <div class="ce-item-sub">By ${esc(entry.actor || 'system')}</div>
      ${entry.note ? `<div style="margin-top:.35rem; font-size:.82rem;">${esc(entry.note)}</div>` : ''}
    </div>
  `).join('');
}

async function saveDrawerForm(evt) {
  evt.preventDefault();
  if (!state.currentItem) return;

  const payload = {
    location: els.fLocation.value.trim(),
    owner: els.fOwner.value.trim(),
    lastCompletedDate: els.fLastCompletedDate.value || '',
    intervalDays: els.fIntervalDays.value || '',
    dueDate: els.fDueDate.value || '',
    rawStatus: els.fRawStatus.value || '',
    vendor: els.fVendor.value.trim(),
    certificateNumber: els.fCertificateNumber.value.trim(),
    reason: els.fReason.value.trim(),
    notes: els.fNotes.value.trim(),
  };

  try {
    await fetchJSON(`/expiration/api/${encodeURIComponent(state.currentItem.type)}/${encodeURIComponent(state.currentItem.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    announce('Changes saved');
    await loadItems();
    await openDrawer(state.currentItem.type, state.currentItem.id);
  } catch (err) {
    console.error(err);
    alert('Unable to save changes.');
  }
}

async function markCompleteCurrent() {
  if (!state.currentItem) return;

  const payload = {
    lastCompletedDate: els.fLastCompletedDate.value || new Date().toISOString().slice(0, 10),
    intervalDays: els.fIntervalDays.value || '',
    dueDate: els.fDueDate.value || '',
    rawStatus: els.fRawStatus.value || 'Active',
    vendor: els.fVendor.value.trim(),
    certificateNumber: els.fCertificateNumber.value.trim(),
    reason: els.fReason.value.trim(),
    notes: els.fNotes.value.trim(),
  };

  try {
    await fetchJSON(`/expiration/api/${encodeURIComponent(state.currentItem.type)}/${encodeURIComponent(state.currentItem.id)}/mark-complete`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    announce('Item marked complete');
    await loadItems();
    await openDrawer(state.currentItem.type, state.currentItem.id);
  } catch (err) {
    console.error(err);
    alert('Unable to mark item complete.');
  }
}

async function rescheduleCurrent() {
  if (!state.currentItem) return;

  const dueDate = els.fDueDate.value;
  const reason = els.fReason.value.trim();

  if (!dueDate) {
    alert('Choose a next due date first.');
    return;
  }

  try {
    await fetchJSON(`/expiration/api/${encodeURIComponent(state.currentItem.type)}/${encodeURIComponent(state.currentItem.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        dueDate,
        reason,
        notes: els.fNotes.value.trim(),
      }),
    });

    announce('Due date updated');
    await loadItems();
    await openDrawer(state.currentItem.type, state.currentItem.id);
  } catch (err) {
    console.error(err);
    alert('Unable to reschedule item.');
  }
}

async function outOfServiceCurrent() {
  if (!state.currentItem) return;

  try {
    await fetchJSON(`/expiration/api/${encodeURIComponent(state.currentItem.type)}/${encodeURIComponent(state.currentItem.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        rawStatus: 'Out of Service',
        reason: els.fReason.value.trim() || 'Marked out of service',
        notes: els.fNotes.value.trim(),
      }),
    });

    announce('Item marked out of service');
    await loadItems();
    await openDrawer(state.currentItem.type, state.currentItem.id);
  } catch (err) {
    console.error(err);
    alert('Unable to update status.');
  }
}

async function applyBulk() {
  const items = [...state.selectedIdsByType.values()];
  if (!items.length) return;

  const bulkAction = els.bulkAction.value;
  if (!bulkAction) {
    alert('Select a bulk action.');
    return;
  }

  const types = [...new Set(items.map((x) => x.type))];
  if (types.length !== 1) {
    alert('Bulk actions currently require all selected items to be the same type.');
    return;
  }

  const type = types[0];
  const ids = items.map((x) => x.id);
  const updates = {};

  if (bulkAction === 'reschedule') {
    if (!els.bulkDueDate.value) {
      alert('Choose a due date for reschedule.');
      return;
    }
    updates.dueDate = els.bulkDueDate.value;
    updates.reason = 'Bulk reschedule';
  }

  if (bulkAction === 'out-of-service') {
    updates.reason = 'Bulk status update';
  }

  try {
    await fetchJSON('/expiration/api/bulk-update', {
      method: 'POST',
      body: JSON.stringify({
        ids,
        type,
        action: bulkAction,
        updates,
      }),
    });

    announce('Bulk update complete');
    clearSelection();
    await loadItems();
  } catch (err) {
    console.error(err);
    alert('Unable to apply bulk update.');
  }
}

function exportCsv() {
  const rows = [
    ['Type', 'Label', 'Serial', 'Tag', 'Location', 'Owner', 'Last Completed', 'Next Due', 'Interval Days', 'Status', 'Days Until'],
    ...state.items.map((x) => [
      x.type || '',
      x.label || '',
      x.serialNumber || '',
      x.tagNumber || '',
      x.location || '',
      x.owner || '',
      x.lastCompletedDate || '',
      x.dueDate || '',
      x.intervalDays ?? '',
      x.statusLabel || x.status || '',
      x.daysUntil ?? '',
    ]),
  ];

  const csv = rows.map((row) =>
    row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calibration-expiration-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function wireEvents() {
  els.btnRefresh.addEventListener('click', loadItems);
  els.btnExport.addEventListener('click', exportCsv);

  const triggerReload = debounce(() => {
    if (state.activeKpiFilter && els.selStatus.value && els.selStatus.value !== state.activeKpiFilter) {
      state.activeKpiFilter = '';
    }
    loadItems();
  }, 220);

  [els.selDays, els.selType, els.selStatus, els.selLocation, els.selOwner, els.selSort, els.chkOnlyMine]
    .forEach((el) => el.addEventListener('change', triggerReload));

  els.searchItems.addEventListener('input', triggerReload);

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      state.activeView = tab.dataset.view;
      els.tabs.forEach((x) => {
        x.classList.toggle('active', x === tab);
        x.setAttribute('aria-selected', x === tab ? 'true' : 'false');
      });
      renderActiveView();
    });
  });

  els.kpiCards.forEach((card) => {
    const activate = () => {
      const key = card.dataset.kpi;
      if (key === 'completedThisWeek') return;
      state.activeKpiFilter = state.activeKpiFilter === key ? '' : key;
      els.selStatus.value = '';
      loadItems();
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });

  els.tableBody.addEventListener('click', (e) => {
    const openBtn = e.target.closest('.btn-open');
    const completeBtn = e.target.closest('.btn-complete');

    if (openBtn) {
      openDrawer(openBtn.dataset.type, openBtn.dataset.id);
      return;
    }
    if (completeBtn) {
      openDrawer(completeBtn.dataset.type, completeBtn.dataset.id).then(() => {
        els.fLastCompletedDate.value = new Date().toISOString().slice(0, 10);
      });
    }
  });

  els.tableBody.addEventListener('change', (e) => {
    const cb = e.target.closest('.row-check');
    if (!cb) return;
    setSelected(cb.dataset.type, cb.dataset.id, cb.checked);
    syncBulkBar();
    els.chkAllRows.checked = state.items.length > 0 && state.items.every((x) => isSelected(x.type, x.id));
  });

  els.chkAllRows.addEventListener('change', () => {
    for (const item of state.items) {
      setSelected(item.type, item.id, els.chkAllRows.checked);
    }
    syncBulkBar();
    renderActiveView();
  });

  els.boardView.addEventListener('click', (e) => {
    const card = e.target.closest('[data-open-type][data-open-id]');
    if (!card) return;
    openDrawer(card.dataset.openType, card.dataset.openId);
  });

  els.calendarView.addEventListener('click', (e) => {
    const ev = e.target.closest('[data-open-type][data-open-id]');
    if (!ev) return;
    openDrawer(ev.dataset.openType, ev.dataset.openId);
  });

  els.btnPrevMonth.addEventListener('click', () => {
    state.currentMonthDate = new Date(state.currentMonthDate.getFullYear(), state.currentMonthDate.getMonth() - 1, 1);
    renderCalendar();
  });

  els.btnNextMonth.addEventListener('click', () => {
    state.currentMonthDate = new Date(state.currentMonthDate.getFullYear(), state.currentMonthDate.getMonth() + 1, 1);
    renderCalendar();
  });

  els.btnClearBulk.addEventListener('click', clearSelection);
  els.btnApplyBulk.addEventListener('click', applyBulk);

  els.btnCloseDrawer.addEventListener('click', closeDrawer);
  els.drawerBackdrop.addEventListener('click', closeDrawer);

  els.drawerForm.addEventListener('submit', saveDrawerForm);
  els.btnResetDrawer.addEventListener('click', () => {
    if (state.currentItem) openDrawer(state.currentItem.type, state.currentItem.id);
  });

  els.btnMarkComplete.addEventListener('click', markCompleteCurrent);
  els.btnReschedule.addEventListener('click', rescheduleCurrent);
  els.btnOutOfService.addEventListener('click', outOfServiceCurrent);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  if (window.io) {
    try {
      const socket = window.io();
      socket.on('connect', () => console.log('[expiration] socket connected'));
      socket.on('auditUpdated', () => loadItems());
    } catch (err) {
      console.warn('[expiration] socket unavailable', err);
    }
  }
}

wireEvents();
loadItems();