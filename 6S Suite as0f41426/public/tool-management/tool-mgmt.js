/*** public/tool-management/tool-mgmt.js */
'use strict';

/* ── Helpers ─────────────────────────────────────────────────────── */
function csrf() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
async function api(url, opts = {}) {
  const hasBody = opts.body != null;
  const res = await fetch(url, {
    method: 'GET', credentials: 'include',
    headers: {
      'Accept': 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'CSRF-Token': csrf(),
    },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toast(msg, type = 'ok') {
  const c = document.getElementById('tmToasts'); if (!c) return;
  const el = document.createElement('div');
  el.className = `tm-toast tm-toast--${type}`; el.textContent = msg;
  c.appendChild(el); setTimeout(() => el.remove(), 3500);
}
function showErr(id, msg) {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = msg || ''; el.style.display = msg ? '' : 'none';
}
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
const $ = id => document.getElementById(id);
const ACTIVE_BUILDING = (typeof window.getBuilding === 'function' && window.getBuilding()) || 'Bldg-350';
let sessionUser = null;

function buildingLabel(v) {
  return String(v || 'Bldg-350').replace('Bldg-', 'Building ');
}

function normalizeBuildingValue(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^bldg-/i.test(raw)) return raw.replace(/^bldg-/i, 'Bldg-');
  if (/^\d+$/.test(raw)) return `Bldg-${raw}`;
  if (/^building\s*\d+$/i.test(raw)) return `Bldg-${raw.replace(/[^0-9]/g, '')}`;
  return raw;
}

function downloadCsv(filename, lines) {
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 250);
}

async function loadSession() {
  try {
    const data = await api('/auth/whoami');
    sessionUser = data?.user || null;
  } catch {
    sessionUser = null;
  }
}

function confirmBuildingChange(targetBuilding, actionLabel) {
  const assigned = sessionUser?.building || '';
  const target = String(targetBuilding || '').trim();
  if (!assigned || !target || assigned === target) return true;
  return window.confirm(
    `You are assigned to ${buildingLabel(assigned)} but are about to ${actionLabel} in ${buildingLabel(target)}. Continue?`
  );
}

function setFilterCollapsed(toolbarId, buttonId, collapsed) {
  const toolbar = $(toolbarId);
  const button = $(buttonId);
  if (toolbar) toolbar.classList.toggle('is-collapsed', collapsed);
  if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/* ── Theme ───────────────────────────────────────────────────────── */
(function () {
  const sel = $('themeSelector');
  const saved = localStorage.getItem('themeSelector') || 'theme-command';
  document.documentElement.className = saved;
  if (!sel) return;
  sel.value = saved;
  sel.addEventListener('change', e => {
    document.documentElement.className = e.target.value;
    localStorage.setItem('themeSelector', e.target.value);
  });
})();

/* ── Tab navigation ──────────────────────────────────────────────── */
function activateTab(tabId) {
  document.querySelectorAll('.tm-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tm-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
  localStorage.setItem('tm:tab', tabId);
}
document.querySelectorAll('.tm-nav-btn').forEach(btn =>
  btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

/* ══════════════════════════════════════════════════════════════════
   TOOLS TAB
══════════════════════════════════════════════════════════════════ */
function typeIconSvg(typeName) {
  try {
    if (typeof window !== 'undefined' && window.suiteIcons?.toolType) {
      return window.suiteIcons.toolType(typeName, 14);
    }
  } catch (_) { /* noop */ }
  return '';
}

function inferType(t) {
  if (t.toolType) return t.toolType;
  const m = (t.model || '').toLowerCase();
  if (m.includes('screwdriver') || m.includes('wera')) return 'Screwdriver';
  if (m.includes('drill') || m.includes('metabo') || m.includes('hikoki') ||
      m.includes('hitachi') || m.includes('milwaukee') || m.includes('panasonic')) return 'Drill';
  if (m.includes('dongle')) return 'Dongle';
  if (m.includes('3d')) return '3D Tooling';
  return 'Other';
}

let allTools = [], toolFiltered = [], toolPage = 1;
const PER_PAGE = 25;
let fSearch = '', fType = '', fCls = '', fStatus = '', fCal = '';
let sortCol = 'serialNumber', sortAsc = true;

function syncToolFilterInputs() {
  if ($('toolStatusFilter')) $('toolStatusFilter').value = fStatus;
  if ($('toolCalFilter')) $('toolCalFilter').value = fCal;
  ['kpi-total-card', 'kpi-avail-card', 'kpi-out-card', 'kpi-cal-card'].forEach((id) => {
    $(id)?.classList.remove('is-active');
  });
  if (!fStatus && !fCal) $('kpi-total-card')?.classList.add('is-active');
  if (fStatus === 'in inventory') $('kpi-avail-card')?.classList.add('is-active');
  if (fStatus === 'being used') $('kpi-out-card')?.classList.add('is-active');
  if (fCal === 'due') $('kpi-cal-card')?.classList.add('is-active');
}

async function loadTools() {
  $('toolsLoading').style.display   = '';
  $('toolsTableWrap').style.display = 'none';
  $('toolsEmpty').style.display     = 'none';
  try {
    const data = await api(`/tools?building=${encodeURIComponent(ACTIVE_BUILDING)}`);
    allTools = Array.isArray(data) ? data : (data?.tools || []);
    renderKpis();
  } catch (e) {
    allTools = [];
    toast('Could not load tools: ' + e.message, 'err');
  }
  applyFilters();
}

function renderKpis() {
  const total  = allTools.length;
  const out    = allTools.filter(t => t.status === 'being used').length;
  const now14  = Date.now() + 14 * 86400000;
  const calDue = allTools.filter(t => t.nextCalibrationDue && new Date(t.nextCalibrationDue) <= now14).length;
  $('kpi-total').textContent = total;
  $('kpi-avail').textContent = total - out;
  $('kpi-out').textContent   = out;
  $('kpi-cal').textContent   = calDue;
  $('kpi-cal-card').classList.toggle('tm-kpi--warn',   calDue > 0 && calDue < 10);
  $('kpi-cal-card').classList.toggle('tm-kpi--danger', calDue >= 10);
}

function applyFilters() {
  const q = fSearch.toLowerCase().trim();
  const now = Date.now(), now14 = now + 14 * 86400000;

  toolFiltered = allTools.filter(t => {
    if (fType) {
      const tt = inferType(t).toLowerCase();
      if (tt !== fType.toLowerCase()) return false;
    }
    if (fCls && (t.classification||'').toLowerCase() !== fCls.toLowerCase()) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fCal) {
      const dueMs = t.nextCalibrationDue ? new Date(t.nextCalibrationDue).getTime() : null;
      if (fCal === 'expired' && (!dueMs || dueMs >= now)) return false;
      if (fCal === 'due' && (!dueMs || dueMs < now || dueMs >= now14)) return false;
      if (fCal === 'ok' && (!dueMs || dueMs < now14)) return false;
    }
    if (q) {
      const hay = [t.serialNumber, t.model, t.slot, t.torque, t.description,
                   t.classification, t.calibrationStatus, t.toolType, t.operatorId]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  toolFiltered.sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (sortCol === 'nextCalibrationDue') {
      av = av ? new Date(av).getTime() : Infinity;
      bv = bv ? new Date(bv).getTime() : Infinity;
      return sortAsc ? av - bv : bv - av;
    }
    const c = String(av).localeCompare(String(bv), undefined, { numeric:true, sensitivity:'base' });
    return sortAsc ? c : -c;
  });

  toolPage = 1;
  syncToolFilterInputs();
  renderTable();
}

function renderTable() {
  $('toolsLoading').style.display = 'none';
  const total = toolFiltered.length;
  const start = (toolPage - 1) * PER_PAGE;
  const slice = toolFiltered.slice(start, start + PER_PAGE);
  $('toolCount').textContent    = `${total.toLocaleString()} tool${total !== 1 ? 's' : ''}`;
  $('toolPageInfo').textContent = !total ? 'No results' : `${start+1}–${Math.min(start+PER_PAGE,total)} of ${total.toLocaleString()}`;

  if (!slice.length) {
    $('toolsEmpty').style.display     = '';
    $('toolsTableWrap').style.display = 'none';
    renderPager(total);
    return;
  }

  $('toolsEmpty').style.display     = 'none';
  $('toolsTableWrap').style.display = '';

  const tbody = $('toolsBody');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  const now = Date.now(), now14 = now + 14 * 86400000;

  slice.forEach(t => {
    const isOut  = t.status === 'being used';
    const dueMs  = t.nextCalibrationDue ? new Date(t.nextCalibrationDue).getTime() : null;
    const days   = dueMs ? Math.ceil((dueMs - now) / 86400000) : null;
    const calCls = !dueMs ? 'tm-cal--none' : dueMs < now ? 'tm-cal--expired' : dueMs <= now14 ? 'tm-cal--soon' : 'tm-cal--ok';
    const calLbl = !dueMs ? '—' : days < 0 ? `Exp ${Math.abs(days)}d ago` : days === 0 ? 'Today' : days <= 14 ? `${days}d` : new Date(dueMs).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});

    const typeName = inferType(t);
    const icon = typeIconSvg(typeName);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono" style="font-weight:700">${esc(t.serialNumber)}</td>
      <td style="font-size:.82rem">
        <span style="display:inline-flex;align-items:center;gap:.3rem;color:var(--fg-muted)">
          ${icon ? `<span aria-hidden="true" style="display:inline-flex;color:var(--fg-muted)">${icon}</span>` : ''}<span>${esc(typeName)}</span>
        </span>
      </td>
      <td style="font-size:.82rem">${esc(t.model||'—')}</td>
      <td style="font-size:.82rem;color:var(--fg-muted)">${esc(t.classification||'—')}</td>
      <td style="font-size:.82rem;text-align:center;color:var(--fg-muted)">${esc(t.slot||'—')}</td>
      <td style="font-size:.82rem;font-family:monospace">${esc(t.torque ? t.torque+' Nm' : '—')}</td>
      <td style="font-size:.78rem;white-space:nowrap">
        <span style="display:inline-flex;align-items:center;gap:.25rem;padding:.15rem .45rem;border-radius:999px;background:${(t.building||'Bldg-350')==='Bldg-4050'?'color-mix(in srgb,var(--info) 12%,transparent)':'color-mix(in srgb,var(--accent) 10%,transparent)'};color:${(t.building||'Bldg-350')==='Bldg-4050'?'var(--info)':'var(--accent)'};font-weight:600">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          ${esc((t.building||'Bldg-350').replace('Bldg-',''))}
        </span>
      </td>
      <td>
        <span class="tm-status-pill tm-status--${isOut?'out':'avail'}">${isOut?'Checked Out':'Available'}</span>
        ${isOut&&t.operatorId?`<span style="font-size:.72rem;color:var(--fg-muted);margin-left:.3rem">${esc(t.operatorId)}</span>`:''}
      </td>
      <td><span class="${calCls}" style="font-size:.78rem;font-family:monospace;font-weight:600">${esc(calLbl)}</span></td>
      <td>
        <div class="tm-btn-group">
          <button class="tm-btn btn-edit-tool" data-sn="${esc(t.serialNumber)}" title="Edit">
            Edit
          </button>
          <button class="tm-btn tm-btn--danger btn-delete-tool" data-sn="${esc(t.serialNumber)}" title="Delete">
            Delete
          </button>
        </div>
      </td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  renderPager(total);

  tbody.querySelectorAll('.btn-edit-tool').forEach(b =>
    b.addEventListener('click', () => openToolModal(allTools.find(t => t.serialNumber === b.dataset.sn))));
  tbody.querySelectorAll('.btn-delete-tool').forEach(b =>
    b.addEventListener('click', () => openDeleteToolModal(b.dataset.sn)));
}

function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const c = $('toolPageBtns');
  c.innerHTML = '';
  if (pages <= 1) return;

  const frag = document.createDocumentFragment();
  const mk = (html, p, active, disabled) => {
    const b = document.createElement('button');
    b.className = 'tm-pg-btn' + (active ? ' active' : '');
    b.innerHTML = html;
    b.disabled = disabled;
    b.addEventListener('click', () => { toolPage = p; renderTable(); });
    return b;
  };

  const lo = Math.max(1, toolPage-2), hi = Math.min(pages, toolPage+2);
  frag.appendChild(mk('‹', toolPage-1, false, toolPage===1));
  if (lo > 1) frag.appendChild(mk('1', 1, false, false));
  if (lo > 2) { const s = document.createElement('span'); s.textContent='…'; s.style.padding='0 .2rem'; frag.appendChild(s); }
  for (let p = lo; p <= hi; p++) frag.appendChild(mk(p, p, p===toolPage, false));
  if (hi < pages-1) { const s = document.createElement('span'); s.textContent='…'; s.style.padding='0 .2rem'; frag.appendChild(s); }
  if (hi < pages) frag.appendChild(mk(pages, pages, false, false));
  frag.appendChild(mk('›', toolPage+1, false, toolPage>=pages));
  c.appendChild(frag);
}

document.querySelectorAll('.tm-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    sortCol === col ? (sortAsc = !sortAsc) : (sortCol = col, sortAsc = true);
    applyFilters();
  });
});

function initToolFilters() {
  let t;
  $('btnToggleToolFilters')?.addEventListener('click', () => {
    const collapsed = !$('toolToolbar')?.classList.contains('is-collapsed');
    setFilterCollapsed('toolToolbar', 'btnToggleToolFilters', collapsed);
  });
  $('toolSearch').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { fSearch = e.target.value; applyFilters(); }, 180);
  });
  $('toolTypeFilter').addEventListener('change', e => { fType = e.target.value; applyFilters(); });
  $('toolClsFilter').addEventListener('change', e => { fCls = e.target.value; applyFilters(); });
  $('toolStatusFilter').addEventListener('change', e => { fStatus = e.target.value; applyFilters(); });
  $('toolCalFilter').addEventListener('change', e => { fCal = e.target.value; applyFilters(); });
  $('kpi-total-card')?.addEventListener('click', () => { fStatus = ''; fCal = ''; applyFilters(); });
  $('kpi-avail-card')?.addEventListener('click', () => { fStatus = 'in inventory'; fCal = ''; applyFilters(); });
  $('kpi-out-card')?.addEventListener('click', () => { fStatus = 'being used'; fCal = ''; applyFilters(); });
  $('kpi-cal-card')?.addEventListener('click', () => { fStatus = ''; fCal = 'due'; applyFilters(); });
}

function openToolModal(tool) {
  const isEdit = !!(tool?.serialNumber);
  $('toolModalTitle').textContent  = isEdit ? `Edit — ${tool.serialNumber}` : 'Add Tool';
  $('tm-sn').value                 = tool?.serialNumber      || '';
  $('tm-sn').disabled              = isEdit;
  $('tm-model').value              = tool?.model             || '';
  $('tm-toolType').value           = tool?.toolType          || '';
  $('tm-classification').value     = tool?.classification    || '';
  $('tm-slot').value               = tool?.slot              || '';
  $('tm-torque').value             = tool?.torque            || '';
  $('tm-description').value        = tool?.description       || '';
  $('tm-calStatus').value          = tool?.calibrationStatus || '';
  $('tm-calDate').value            = tool?.calibrationDate ? tool.calibrationDate.slice(0,10) : '';
  $('tm-calDue').value             = tool?.nextCalibrationDue ? tool.nextCalibrationDue.slice(0,10) : '';
  $('tm-building').value           = tool?.building || ACTIVE_BUILDING;
  showErr('toolModalErr', '');
  openModal('modalTool');
  setTimeout(() => (isEdit ? $('tm-model') : $('tm-sn')).focus(), 60);
}
$('btnAddTool').addEventListener('click', () => openToolModal({}));
$('btnCancelTool').addEventListener('click', () => closeModal('modalTool'));
$('modalTool').addEventListener('click', e => { if (e.target === $('modalTool')) closeModal('modalTool'); });

$('toolForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('toolModalErr', '');
  const sn = $('tm-sn').value.trim();
  if (!sn) { showErr('toolModalErr', 'Serial number is required'); return; }

  const isEdit = $('tm-sn').disabled;
  const payload = {
    serialNumber: sn,
    model: $('tm-model').value.trim(),
    toolType: $('tm-toolType').value,
    classification: $('tm-classification').value,
    slot: $('tm-slot').value.trim(),
    torque: $('tm-torque').value.trim(),
    description: $('tm-description').value.trim(),
    calibrationStatus: $('tm-calStatus').value,
    calibrationDate: $('tm-calDate').value,
    nextCalibrationDue: $('tm-calDue').value,
    building: $('tm-building').value || ACTIVE_BUILDING,
  };
  if (!confirmBuildingChange(payload.building, isEdit ? 'update a tool' : 'add a tool')) return;

  const btn = $('btnSaveTool');
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    if (isEdit) {
      await api(`/tools/${encodeURIComponent(sn)}`, { method:'PUT', body:JSON.stringify(payload) });
      toast(`Tool ${sn} updated`, 'ok');
    } else {
      await api('/tools', { method:'POST', body:JSON.stringify(payload) });
      toast(`Tool ${sn} added`, 'ok');
    }
    closeModal('modalTool');
    await loadTools();
  } catch (err) {
    showErr('toolModalErr', err.message);
  } finally {
    btn.textContent = 'Save Tool';
    btn.disabled = false;
  }
});

function openDeleteToolModal(sn) {
  $('deleteTool-sn').value = sn;
  $('deleteToolName').textContent = sn;
  showErr('deleteToolErr', '');
  openModal('modalDeleteTool');
}
$('btnCancelDeleteTool').addEventListener('click', () => closeModal('modalDeleteTool'));
$('modalDeleteTool').addEventListener('click', e => { if (e.target === $('modalDeleteTool')) closeModal('modalDeleteTool'); });
$('btnConfirmDeleteTool').addEventListener('click', async () => {
  const sn = $('deleteTool-sn').value;
  const tool = allTools.find(t => t.serialNumber === sn);
  if (!confirmBuildingChange(tool?.building || ACTIVE_BUILDING, 'delete a tool')) return;
  const btn = $('btnConfirmDeleteTool');
  btn.textContent = 'Deleting…';
  btn.disabled = true;
  try {
    await api(`/tools/${encodeURIComponent(sn)}`, { method:'DELETE' });
    toast(`Tool ${sn} deleted`, 'ok');
    closeModal('modalDeleteTool');
    await loadTools();
  } catch (err) {
    showErr('deleteToolErr', err.message);
  } finally {
    btn.textContent = 'Delete';
    btn.disabled = false;
  }
});

$('btnImportCSV').addEventListener('click', () => openModal('modalImportCSV'));
$('btnCancelImport').addEventListener('click', () => closeModal('modalImportCSV'));
$('modalImportCSV').addEventListener('click', e => { if (e.target === $('modalImportCSV')) closeModal('modalImportCSV'); });
$('importForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('importErr', '');
  const file = $('importFile').files[0];
  if (!file) { showErr('importErr', 'Select a CSV file'); return; }

  const lines = (await file.text()).split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showErr('importErr', 'CSV needs header + at least one row'); return; }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  const rows = lines.slice(1)
    .map(line => {
      const v = line.split(',').map(c=>c.trim().replace(/^"|"$/g,''));
      const o = {};
      headers.forEach((h,i) => {
        const key = String(h || '').trim();
        const lower = key.toLowerCase();
        const value = v[i] || '';
        o[key] = value;
        if (!(lower in o)) o[lower] = value;
      });
      return o;
    })
    .filter(r => r.serialNumber || r.serialnumber);

  if (!rows.length) { showErr('importErr', 'No valid rows - "serialNumber" column required'); return; }
  const normalizedRows = rows.map((row) => {
    const serialNumber = String(row.serialNumber || row.serialnumber || '').trim();
    const building = normalizeBuildingValue(row.building || row.Building || ACTIVE_BUILDING) || ACTIVE_BUILDING;
    return {
      ...row,
      serialNumber,
      building,
      nextCalibrationDue: row.nextCalibrationDue || row.nextcalibrationdue || row.NextCalibrationDue || '',
      calibrationDate: row.calibrationDate || row.calibrationdate || row.lastCalibrationDate || row.lastcalibrationdate || row.LastCalibrationDate || '',
    };
  });
  const crossBuildingImport = normalizedRows.some((row) => {
    const assigned = sessionUser?.building || '';
    return assigned && row.building && row.building !== assigned;
  });
  if (crossBuildingImport && !confirmBuildingChange(
    normalizedRows.find((row) => row.building !== (sessionUser?.building || ''))?.building,
    'import tools'
  )) return;

  const btn = $('btnConfirmImport');
  const seenSerials = new Set();
  const failedRows = [];
  let added = 0, updated = 0, failed = 0;
  const globalTools = await api('/tools');
  const globalList = Array.isArray(globalTools) ? globalTools : (globalTools?.tools || []);

  btn.disabled = true;
  try {
    for (let i = 0; i < normalizedRows.length; i++) {
      btn.textContent = 'Importing ' + (i + 1) + '/' + normalizedRows.length + '...';
      const row = normalizedRows[i];
      const serial = String(row.serialNumber || '').trim();
      const serialKey = serial.toLowerCase();

      if (seenSerials.has(serialKey)) {
        failed++;
        failedRows.push(serial + ': duplicate serialNumber within the import file');
        continue;
      }
      seenSerials.add(serialKey);

      try {
        const exists = globalList.some(t => (t.serialNumber || '').toLowerCase() === serialKey);
        if (exists) {
          const result = await api('/tools/' + encodeURIComponent(serial), { method:'PUT', body:JSON.stringify(row) });
          updated++;
          if (result?.tool) {
            const idx = allTools.findIndex(t => (t.serialNumber || '').toLowerCase() === serialKey);
            if (idx !== -1) allTools[idx] = result.tool;
            const globalIdx = globalList.findIndex(t => (t.serialNumber || '').toLowerCase() === serialKey);
            if (globalIdx !== -1) globalList[globalIdx] = result.tool;
          }
        } else {
          const result = await api('/tools', { method:'POST', body:JSON.stringify(row) });
          added++;
          if (result?.tool) {
            allTools.push(result.tool);
            globalList.push(result.tool);
          }
        }
      } catch (err) {
        failed++;
        failedRows.push((serial || ('row ' + (i + 2))) + ': ' + (err.message || 'Unknown error'));
      }
    }

    const summary = 'Import: ' + added + ' added, ' + updated + ' updated' + (failed ? ', ' + failed + ' failed' : '');
    if (failedRows.length) {
      const preview = failedRows.slice(0, 8).join('\n');
      const more = failedRows.length > 8 ? '\n...plus ' + (failedRows.length - 8) + ' more' : '';
      showErr('importErr', summary + '\n' + preview + more);
      toast(summary, 'warn');
    } else {
      toast(summary, 'ok');
      closeModal('modalImportCSV');
      $('importFile').value = '';
    }
    await loadTools();
  } finally {
    btn.textContent = 'Import';
    btn.disabled = false;
  }
});
$('btnExportTools').addEventListener('click', () => {
  const cols = ['serialNumber','toolType','model','classification','slot','torque','status',
                'building','calibrationStatus','calibrationDate','nextCalibrationDue','description'];
  const csv = '\uFEFF' + [cols.join(','),
    ...toolFiltered.map(t => cols.map(c => `"${String(t[c]??'').replace(/"/g,'""')}"`).join(','))
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download: `floor-tools_${ACTIVE_BUILDING.replace('Bldg-','')}_${new Date().toISOString().slice(0,10)}.csv`,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
});

$('btnDownloadToolImportTemplate').addEventListener('click', () => {
  downloadCsv('floor-tools-import-template.csv', [
    'serialNumber,toolType,model,classification,slot,torque,status,building,calibrationStatus,calibrationDate,nextCalibrationDue,description',
    `MFG001234,Screwdriver,Wera Screwdriver,Wired,47,0.6,in inventory,${ACTIVE_BUILDING},Calibrated,2026-03-01,2026-09-01,Sample tool`,
  ]);
});

/* ══════════════════════════════════════════════════════════════════
   ESD CARTS TAB
══════════════════════════════════════════════════════════════════ */
let allCarts = [], fCartQ = '', fCartSt = '', cartsLoaded = false;

async function loadCarts() {
  $('cartsLoading').style.display   = '';
  $('cartsTableWrap').style.display = 'none';
  $('cartsEmpty').style.display     = 'none';
  try {
    const data = await api(`/esd-carts?building=${encodeURIComponent(ACTIVE_BUILDING)}`);
    allCarts = Array.isArray(data) ? data : (data?.carts || []);
    cartsLoaded = true;
  } catch (e) {
    allCarts = [];
    toast('Could not load carts: ' + e.message, 'err');
  }
  renderCartKpis();
  applyCartFilters();
}

function renderCartKpis() {
  const total = allCarts.length;
  const out   = allCarts.filter(c => (c.status||'').toLowerCase().replace(/[_\s]/g,'') === 'checkedout').length;
  $('kpi-carts-total').textContent = total;
  $('kpi-carts-avail').textContent = total - out;
  $('kpi-carts-out').textContent   = out;
}

function applyCartFilters() {
  const q = fCartQ.toLowerCase().trim();
  const filtered = allCarts.filter(c => {
    const st = (c.status||'').toLowerCase().replace(/[_\s]/g,'');
    if (fCartSt === 'available' && st !== 'available') return false;
    if (fCartSt === 'checked_out' && st !== 'checkedout') return false;
    if (q) {
      const h = [c.id, c.holder].filter(Boolean).join(' ').toLowerCase();
      if (!h.includes(q)) return false;
    }
    return true;
  });
  $('cartCount').textContent = `${filtered.length.toLocaleString()} cart${filtered.length!==1?'s':''}`;
  renderCartsTable(filtered);
}

function renderCartsTable(carts) {
  $('cartsLoading').style.display = 'none';

  if (!carts.length) {
    $('cartsTableWrap').style.display = 'none';
    $('cartsEmpty').style.display = '';
    return;
  }

  $('cartsEmpty').style.display = 'none';
  $('cartsTableWrap').style.display = '';
  const tbody = $('cartsBody');
  tbody.innerHTML = '';

  const frag = document.createDocumentFragment();
  carts.forEach(c => {
    const isOut = (c.status||'').toLowerCase().replace(/[_\s]/g,'') === 'checkedout';
    const holder = c.holder && c.holder !== 'null' ? c.holder : '—';
    const updated = c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono" style="font-weight:700">${esc(c.id)}</td>
      <td style="font-size:.78rem;white-space:nowrap;color:var(--fg-muted)">${esc((c.building || ACTIVE_BUILDING).replace('Bldg-',''))}</td>
      <td><span class="tm-status-pill tm-status--${isOut?'out':'avail'}">${isOut?'Checked Out':'Available'}</span></td>
      <td style="font-size:.82rem;color:var(--fg-muted)">${esc(holder)}</td>
      <td style="font-size:.78rem;color:var(--fg-muted)">${esc(updated)}</td>
      <td>
        <div class="tm-btn-group">
          <button class="tm-btn btn-edit-cart" data-id="${esc(c.id)}" title="Edit cart">
            Edit
          </button>
          <button class="tm-btn tm-btn--danger btn-del-cart" data-id="${esc(c.id)}"
            ${isOut?'disabled title="Cannot remove a checked-out cart"':'title="Remove from roster"'}>
            Remove
          </button>
        </div>
      </td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  tbody.querySelectorAll('.btn-edit-cart').forEach(b =>
    b.addEventListener('click', () => {
      const cart = allCarts.find(c => c.id === b.dataset.id);
      openCartModal(cart);
    })
  );

  tbody.querySelectorAll('.btn-del-cart').forEach(b =>
    b.addEventListener('click', () => openDeleteCartModal(b.dataset.id))
  );
}

/* ── Add / Edit cart modal ──────────────────────────────────────── */
function openCartModal(cart) {
  const isEdit = !!cart;
  $('cartModalTitle').textContent = isEdit ? `Edit Cart — ${cart.id}` : 'Add ESD Cart';
  $('tm-cart-original-id').value = cart?.id || '';
  $('tm-cart-edit-id').value = cart?.id || '';
  $('tm-cart-status').value = cart?.status || 'available';
  $('tm-cart-holder').value = cart?.holder || '';
  $('tm-cart-building').value = cart?.building || ACTIVE_BUILDING;
  showErr('cartModalErr', '');
  openModal('modalCart');
  setTimeout(() => $('tm-cart-edit-id').focus(), 60);
}

$('btnAddCart').addEventListener('click', () => openCartModal(null));
$('btnCancelCartModal').addEventListener('click', () => closeModal('modalCart'));
$('modalCart').addEventListener('click', e => { if (e.target === $('modalCart')) closeModal('modalCart'); });

$('cartForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('cartModalErr', '');

  const originalId = $('tm-cart-original-id').value.trim();
  const id = $('tm-cart-edit-id').value.trim();
  const status = $('tm-cart-status').value;
  let holder = $('tm-cart-holder').value.trim();
  const building = $('tm-cart-building').value || ACTIVE_BUILDING;

  if (!id) {
    showErr('cartModalErr', 'Cart ID is required');
    return;
  }

  if (status === 'checked_out' && !holder) {
    showErr('cartModalErr', 'Holder is required when cart is checked out');
    return;
  }

  if (status === 'available') {
    holder = '';
  }
  if (!confirmBuildingChange(building, isEdit ? 'update an ESD cart' : 'add an ESD cart')) return;

  const btn = $('btnSaveCartModal');
  const isEdit = !!originalId;
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    if (isEdit) {
      await api(`/esd-carts/admin/${encodeURIComponent(originalId)}`, {
        method: 'PUT',
        body: JSON.stringify({ id, status, holder, building })
      });
      toast(`Cart ${originalId} updated`, 'ok');
    } else {
      if (allCarts.some(c => c.id === id)) {
        throw new Error(`Cart "${id}" already exists`);
      }
      await api('/esd-carts/admin/add', {
        method: 'POST',
        body: JSON.stringify({ cartId: id, building })
      });

      if (status !== 'available' || holder) {
        await api(`/esd-carts/admin/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ id, status, holder, building })
        });
      }

      toast(`Cart ${id} added`, 'ok');
    }

    closeModal('modalCart');
    await loadCarts();
  } catch (err) {
    showErr('cartModalErr', err.message);
  } finally {
    btn.textContent = 'Save Cart';
    btn.disabled = false;
  }
});

/* ── Legacy single-add modal kept if you still want it elsewhere ── */
/* You can remove modalAddCart + addCartForm now if you want,
   because modalCart handles both add and edit. */

/* ── Bulk add carts ──────────────────────────────────────────────── */
$('btnBulkAddCarts').addEventListener('click', () => {
  $('bulkCartIds').value = '';
  $('bulkCartBuilding').value = ACTIVE_BUILDING;
  showErr('bulkCartErr', '');
  openModal('modalBulkAddCarts');
  setTimeout(() => $('bulkCartIds').focus(), 60);
});
$('btnCancelBulkCart').addEventListener('click', () => closeModal('modalBulkAddCarts'));
$('modalBulkAddCarts').addEventListener('click', e => { if(e.target === $('modalBulkAddCarts')) closeModal('modalBulkAddCarts'); });
$('bulkCartForm').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('bulkCartErr', '');
  const ids = $('bulkCartIds').value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!ids.length) {
    showErr('bulkCartErr', 'Enter at least one Cart ID');
    return;
  }

  const btn = $('btnConfirmBulkCart');
  btn.textContent = 'Adding…';
  btn.disabled = true;

  let added = 0, skipped = 0;
  const building = $('bulkCartBuilding').value || ACTIVE_BUILDING;
  if (!confirmBuildingChange(building, 'bulk add ESD carts')) return;
  for (const id of ids) {
    if (allCarts.some(c => c.id === id)) { skipped++; continue; }
    try {
      await api('/esd-carts/admin/add', { method:'POST', body:JSON.stringify({ cartId:id, building }) });
      added++;
    } catch {
      skipped++;
    }
  }

  btn.textContent = 'Add Carts';
  btn.disabled = false;
  toast(added + ' cart' + (added!==1?'s':'') + ' added' + (skipped?', '+skipped+' skipped':''), 'ok');
  closeModal('modalBulkAddCarts');
  await loadCarts();
});

/* ── Delete cart ─────────────────────────────────────────────────── */
function openDeleteCartModal(id) {
  $('deleteCart-id').value = id;
  $('deleteCartName').textContent = id;
  showErr('deleteCartErr', '');
  openModal('modalDeleteCart');
}
$('btnCancelDeleteCart').addEventListener('click', () => closeModal('modalDeleteCart'));
$('modalDeleteCart').addEventListener('click', e => { if(e.target === $('modalDeleteCart')) closeModal('modalDeleteCart'); });
$('btnConfirmDeleteCart').addEventListener('click', async () => {
  const id = $('deleteCart-id').value;
  const cart = allCarts.find(c => c.id === id);
  if (!confirmBuildingChange(cart?.building || ACTIVE_BUILDING, 'remove an ESD cart')) return;
  const btn = $('btnConfirmDeleteCart');
  btn.textContent = 'Removing…';
  btn.disabled = true;
  try {
    await api(`/esd-carts/admin/${encodeURIComponent(id)}`, { method:'DELETE' });
    toast(`Cart ${id} removed`, 'ok');
    closeModal('modalDeleteCart');
    await loadCarts();
  } catch (err) {
    showErr('deleteCartErr', err.message);
  } finally {
    btn.textContent = 'Remove';
    btn.disabled = false;
  }
});

function initCartFilters() {
  let t;
  $('btnToggleCartFilters')?.addEventListener('click', () => {
    const collapsed = !$('cartToolbar')?.classList.contains('is-collapsed');
    setFilterCollapsed('cartToolbar', 'btnToggleCartFilters', collapsed);
  });
  $('cartSearch').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { fCartQ = e.target.value; applyCartFilters(); }, 180);
  });
  $('cartStatusFilter').addEventListener('change', e => {
    fCartSt = e.target.value;
    applyCartFilters();
  });
}

/* ── Global Escape ───────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['modalTool','modalDeleteTool','modalImportCSV','modalCart','modalBulkAddCarts','modalDeleteCart'].forEach(closeModal);
});

/* ── Boot ────────────────────────────────────────────────────────── */
(async function init() {
  await loadSession();
  initToolFilters();
  initCartFilters();
  setFilterCollapsed('toolToolbar', 'btnToggleToolFilters', false);
  setFilterCollapsed('cartToolbar', 'btnToggleCartFilters', false);

  document.querySelector('[data-tab="tabCarts"]')?.addEventListener('click', () => {
    if (!cartsLoaded) loadCarts();
  }, { once: true });

  const saved = localStorage.getItem('tm:tab');
  if (saved && document.getElementById(saved)) {
    activateTab(saved);
    if (saved === 'tabCarts') loadCarts();
  }

  await loadTools();
})();

