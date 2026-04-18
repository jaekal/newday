// public/js/assetTable.js
console.log("Asset Catalog UI initializing…");

// ---------- Utilities ----------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function fetchJSON(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const method = (opts.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(opts.headers || {})
  };

  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers['CSRF-Token'] = headers['CSRF-Token'] || getCsrfToken();
  }

  try {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      ...opts,
      headers
    });
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json();
    else data = await res.text();

    if (!res.ok) {
      const errorPayload = data?.error && typeof data.error === 'object' ? data.error : null;
      const detail =
        Array.isArray(errorPayload?.details) && errorPayload.details.length
          ? errorPayload.details[0]?.message
          : Array.isArray(data?.details) && data.details.length
            ? data.details[0]?.message
          : '';
      const msg =
        detail ||
        errorPayload?.message ||
        (data && data.message) ||
        (typeof data === 'string' ? data : res.statusText);
      throw new Error(msg || `Request failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const notyf = window.Notyf ? new Notyf({ duration: 3000, position: { x: 'right', y: 'bottom' } }) : null;

function activeBuilding() {
  return (
    (typeof window.getBuilding === 'function' ? window.getBuilding() : null) ||
    localStorage.getItem('suite.building.v1') ||
    'Bldg-350'
  );
}

let assignedBuilding = '';

function confirmBuildingScope(actionLabel, targetBuilding = activeBuilding()) {
  const assigned = String(assignedBuilding || '').trim();
  const target = String(targetBuilding || '').trim();
  if (!assigned || !target || target === 'all' || assigned === target) return true;
  return window.confirm(
    `You are assigned to ${assigned}, but this action targets ${target}. Do you want to continue and ${actionLabel}?`
  );
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

function upsertHiddenInput(form, name, value) {
  if (!form) return;
  let input = form.querySelector(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

function normalizeAssetPayload(data = {}) {
  const normalized = { ...data };
  const intervalRaw = String(normalized.calibrationIntervalDays ?? '').trim();
  normalized.calibrationIntervalDays = intervalRaw ? Number.parseInt(intervalRaw, 10) || null : null;

  ['lastCalibrationDate', 'nextCalibrationDue'].forEach((key) => {
    normalized[key] = String(normalized[key] ?? '').trim() || null;
  });

  return normalized;
}

// ---------- DOM Ready ----------
document.addEventListener('DOMContentLoaded', () => {
  // Core elements
  const assetModal     = $('#assetModal');
  const modalOverlay   = $('#modalOverlay');
  const modalForm      = $('#modalForm');
  const modalTitle     = $('#modalTitle');
  const closeBtn       = $('#closeModal');
  const openModalBtn   = $('#openModalBtn');
  const selectAllCb    = $('#selectAll');
  const bulkAuditForm  = $('#bulkAuditForm');
  const tableEl        = $('.asset-table');

  // New top layout elements
  const filtersForm    = $('#filtersForm');
  const categoryFilter = $('#filterCategory');
  const equipmentClassFilter = $('#filterEquipmentClass');
  const auditFilter    = $('#filterAuditStatus');
  const liveSearch     = $('#liveSearch');
  const paginationLimitForm = $('#paginationLimitForm');
  const limitSelect    = $('#limit');
  const paginationForm = $('#paginationLimitForm');
  const syncManagedAssetsBtn = $('#syncManagedAssetsBtn');

  // Field map
  const FIELDS = ['name','tagNumber','category','location','building','status','description','itemType','equipmentClass','managedSource','serialNumber','torque','toolClassification','lastCalibrationDate','calibrationIntervalDays','nextCalibrationDue'];

  let modalIsOpen = false;

  fetch('/auth/whoami', { credentials: 'include', headers: { Accept: 'application/json' } })
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      assignedBuilding = data?.user?.building || '';
    })
    .catch(() => {});

  // ---------- Programmatic form/controls wiring (CSP-safe) ----------
  const currentBuilding = activeBuilding();
  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get('building') !== currentBuilding) {
    currentUrl.searchParams.set('building', currentBuilding);
    window.location.replace(currentUrl.pathname + currentUrl.search + currentUrl.hash);
    return;
  }

  upsertHiddenInput(filtersForm, 'building', currentBuilding);
  upsertHiddenInput(paginationForm, 'building', currentBuilding);

  $all('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (!(href.startsWith('/asset-catalog') || href.startsWith('?'))) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set('building', currentBuilding);
    link.href = href.startsWith('?') ? `${url.search}${url.hash}` : `${url.pathname}${url.search}${url.hash}`;
  });

  categoryFilter?.addEventListener('change', () => filtersForm?.submit());
  equipmentClassFilter?.addEventListener('change', () => filtersForm?.submit());
  auditFilter?.addEventListener('change', () => filtersForm?.submit());
  limitSelect?.addEventListener('change', () => paginationLimitForm?.submit());

  function submitFiltersToServer() {
    if (!filtersForm) return;
    upsertHiddenInput(filtersForm, 'page', '1');
    filtersForm.submit();
  }

  // ---------- Modal helpers ----------
  function setSubmitButtonsHidden(hidden) {
    modalForm?.querySelectorAll('button[type="submit"]').forEach((btn) => {
      btn.classList.toggle('hidden', !!hidden);
    });
  }

  function setModalMode() {
    $all('.modal-tab-btn').forEach((btn) => {
      btn.style.display = '';
    });
  }

  function setModalReadonly(readonly) {
    modalForm?.querySelectorAll('input, textarea, select').forEach((el) => {
      if (readonly) {
        el.setAttribute('readonly', 'true');
        if (el.tagName === 'SELECT') el.setAttribute('disabled', 'disabled');
      } else {
        el.removeAttribute('readonly');
        el.removeAttribute('disabled');
      }
    });
  }

  function activateModalTab(target) {
    $all('.modal-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === target);
    });
    $all('.tab-content').forEach((panel) => {
      const show = panel.id === `tab-${target}`;
      panel.classList.toggle('active', show);
      panel.classList.toggle('hidden', !show);
      panel.style.display = show ? '' : 'none';
    });
  }

  function emitAssetModalOpened(detail = {}) {
    document.dispatchEvent(new CustomEvent('assetModalOpened', { detail }));
  }

  function openModal({ startTab = 'form', detail = {} } = {}) {
    if (modalIsOpen) return;
    modalIsOpen = true;
    assetModal?.classList.remove('hidden');
    modalOverlay?.classList.remove('hidden');
    modalOverlay?.classList.add('active');
    activateModalTab(startTab);
    emitAssetModalOpened(detail);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeModal() {
    modalIsOpen = false;
    modalOverlay?.classList.remove('active');
    assetModal?.classList.add('hidden');
    modalOverlay?.classList.add('hidden');
    modalForm?.reset();
    modalForm?.removeAttribute('data-editing');
    modalForm?.removeAttribute('data-id');
    modalForm?.querySelector('input[name="id"]')?.remove();
    setModalReadonly(false);
    setSubmitButtonsHidden(false);
    setModalMode('edit');
  }

  closeBtn?.addEventListener('click', closeModal);
  assetModal?.addEventListener('click', (e) => e.stopPropagation());
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  openModalBtn?.addEventListener('click', () => {
    modalTitle.textContent = 'New Asset';
    modalForm?.removeAttribute('data-editing');
    modalForm?.removeAttribute('data-id');
    modalForm?.reset();
    setModalReadonly(false);
    setSubmitButtonsHidden(false);
    setModalMode('edit');
    const buildingField = document.getElementById('building');
    if (buildingField) buildingField.value = activeBuilding();
    openModal({ startTab: 'form', detail: { itemType: 'fleet', building: activeBuilding() } });
  });

  function populateForm(data = {}) {
    FIELDS.forEach(k => {
      const el = document.getElementById(k);
      if (el) el.value = data[k] ?? '';
    });
  }

  // Tab switching
  $all('.modal-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      activateModalTab(target);
    });
  });

  // ---------- Toggle audit history for a specific row (by id) ----------
  async function toggleAuditForId(id) {
    const row = document.querySelector(`tr.asset-row[data-id="${CSS.escape(id)}"]`);
    const auditRow = row?.nextElementSibling?.classList.contains('audit-row') ? row.nextElementSibling : null;
    if (!row || !auditRow) return;

    const cell = auditRow.querySelector('.audit-preview');
    const isHidden = auditRow.classList.contains('hidden');
    if (!isHidden) {
      auditRow.classList.add('hidden');
      auditRow.style.display = 'none';
      row.classList.remove('expanded');
      return;
    }

    auditRow.classList.remove('hidden');
    auditRow.style.display = '';
    row.classList.add('expanded');
    if (cell) cell.innerHTML = '<em>Loading audit history...</em>';

    try {
      const logs = await fetchJSON(`/asset-catalog/${encodeURIComponent(id)}/audit-log`);
      if (!Array.isArray(logs) || !logs.length) {
        if (cell) cell.innerHTML = '<em>No history</em>';
        return;
      }
      if (cell) {
        cell.innerHTML = `
          <ul class="space-y-1">
            ${logs.map(l => `
              <li>
                <strong>${new Date(l.auditDate || l.time).toLocaleString()}</strong>
                – ${l.auditorName || l.performedBy || 'system'}
                ${l.passed !== undefined ? ` • ${l.passed ? '✅ passed' : '❌ failed'}` : ''}
                ${l.comments ? `<br><span class="text-sm text-gray-600">${l.comments}</span>` : ''}
              </li>
            `).join('')}
          </ul>
        `;
      }
    } catch (err) {
      if (cell) cell.innerHTML = `<span class="text-red-600">Failed to load audit: ${err.message}</span>`;
    }
  }

  // ---------- Row actions ----------
  document.body.addEventListener('click', async (e) => {
    // Tag link -> show just this asset's history
    const tagLink = e.target.closest('a.tag-link');
    if (tagLink) {
      e.preventDefault();
      const id = tagLink.dataset.id;
      if (id) toggleAuditForId(id);
      return;
    }

    const btn = e.target.closest('button');
    if (!btn) return;

    // EDIT
    if (btn.classList.contains('edit-btn')) {
      try {
        const seed = JSON.parse(btn.dataset.asset || '{}');
        if (!seed.id) throw new Error('Invalid asset data');
        const asset = await fetchJSON(`/asset-catalog/${encodeURIComponent(seed.id)}`);
        populateForm(asset);
        modalTitle.textContent = 'Edit Asset';
        setModalReadonly(false);
        setSubmitButtonsHidden(false);
        setModalMode('edit');

        let idInp = modalForm.querySelector('input[name="id"]');
        if (!idInp) {
          idInp = document.createElement('input');
          idInp.type = 'hidden';
          idInp.name = 'id';
          modalForm.appendChild(idInp);
        }
        idInp.value = asset.id;

        modalForm.setAttribute('data-editing', 'true');
        modalForm.setAttribute('data-id', asset.id);
        openModal({ startTab: 'form', detail: asset });
      } catch (err) {
        notyf?.error?.('Failed to open editor');
        console.error(err);
      }
      return;
    }
    // DELETE
    if (btn.classList.contains('delete-btn')) {
      const id  = btn.dataset.id;
      const tag = btn.dataset.tag || 'this asset';
      if (!id) return;

      if (!confirm(`Are you sure you want to delete ${tag}?`)) return;

      try {
        // Prefer RESTful DELETE
        try {
          await fetchJSON(`/asset-catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch {
          // Fallback to legacy POST /delete
          await fetchJSON(`/asset-catalog/${encodeURIComponent(id)}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
        }
        notyf?.success?.(`${tag} deleted.`);
        const tr = btn.closest('tr');
        const auditRow = tr?.nextElementSibling?.classList.contains('audit-row') ? tr.nextElementSibling : null;
        tr?.remove();
        auditRow?.remove();
      } catch (err) {
        notyf?.error?.(err.message || `Failed to delete ${tag}`);
        console.error(err);
      }
      return;
    }
  });

  // ---------- Create/Update submission ----------
  modalForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    FIELDS.forEach(k => { data[k] = document.getElementById(k)?.value?.trim() || ''; });
    const payload = normalizeAssetPayload(data);

    if (!payload.name || !payload.tagNumber) {
      notyf?.error?.('Name and Tag Number are required');
      return;
    }

    const isEdit = modalForm.hasAttribute('data-editing');
    const id     = modalForm.getAttribute('data-id');
    const url    = isEdit ? `/asset-catalog/${encodeURIComponent(id)}` : '/asset-catalog';
    const method = isEdit ? 'PUT' : 'POST';
    if (!confirmBuildingScope(isEdit ? 'update this asset' : 'create this asset', payload.building || activeBuilding())) {
      return;
    }

    try {
      await fetchJSON(url, { method, body: JSON.stringify(payload) });
      notyf?.success?.(`Asset ${isEdit ? 'updated' : 'created'} successfully.`);
      closeModal();
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      console.error(err);
      notyf?.error?.(err.message || 'Save failed');
    }
  });

  // ---------- Sorting (keeps audit rows attached) ----------
  if (tableEl) {
    const theadCells = $all('thead th', tableEl);
    theadCells.forEach((th, index) => {
      const sortable = th.classList.contains('sortable');
      const isCheckbox = index === 0;
      const isActions  = th.textContent.trim().toLowerCase() === 'actions';
      if (!sortable || isCheckbox || isActions) return;

      th.style.cursor = 'pointer';
      th.dataset.sortDir = th.dataset.sortDir || 'asc';

      th.addEventListener('click', () => {
        const tbody = tableEl.tBodies[0];
        if (!tbody) return;

        const assetRows = $all('tr.asset-row', tbody).map(ar => {
          const audit = ar.nextElementSibling?.classList.contains('audit-row') ? ar.nextElementSibling : null;
          return { asset: ar, audit };
        });

        const dir = th.dataset.sortDir === 'asc' ? 1 : -1;

        assetRows.sort((ra, rb) => {
          const aText = (ra.asset.cells[index]?.innerText || '').trim().toLowerCase();
          const bText = (rb.asset.cells[index]?.innerText || '').trim().toLowerCase();
          return aText.localeCompare(bText) * dir;
        });

        th.dataset.sortDir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';

        assetRows.forEach(({ asset, audit }) => {
          tbody.appendChild(asset);
          if (audit) tbody.appendChild(audit);
        });
      });
    });
  }

  // ---------- Client-side live filter (optional helper) ----------
  function debounce(fn, wait = 200) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function filterRows() {
    const q     = (liveSearch?.value || '').toLowerCase();
    const cat   = categoryFilter?.value || '';
    const audit = auditFilter?.value || '';
    const building = activeBuilding();

    const tbody = tableEl?.tBodies[0];
    if (!tbody) return;

    let anyVisible = false;

    const equipmentClassValue = (equipmentClassFilter?.value || '').trim();

    $all('tr.asset-row', tbody).forEach(ar => {
      const cells = ar.cells;
      const rowBuilding = ar.dataset.building || 'Bldg-350';
      const rowCategory = (ar.dataset.category || '').trim();
      const rowEquipmentClass = (ar.dataset.equipmentClass || '').trim();
      const tag       = (cells[1]?.innerText || '').toLowerCase();
      const name      = (cells[2]?.innerText || '').toLowerCase();
      const location  = (cells[4]?.innerText || '').toLowerCase();
      const auditText = (cells[6]?.innerText || '').trim().toLowerCase(); // OK / Due Soon / Overdue

      const matchQ     = !q || tag.includes(q) || name.includes(q) || location.includes(q);
      const matchCat   = !cat || rowCategory === cat;
      const matchEquipmentClass = !equipmentClassValue || rowEquipmentClass === equipmentClassValue;
      const matchAudit = !audit || auditText === audit.toLowerCase();
      const matchBuilding = !building || rowBuilding === building;

      const show = matchBuilding && matchQ && matchCat && matchEquipmentClass && matchAudit;
      ar.style.display = show ? '' : 'none';
      const checkbox = ar.querySelector('.rowCheckbox');
      if (!show && checkbox) checkbox.checked = false;

      const auditRow = ar.nextElementSibling?.classList.contains('audit-row') ? ar.nextElementSibling : null;
      if (auditRow) auditRow.style.display = show && !auditRow.classList.contains('hidden') ? '' : 'none';

      if (show) anyVisible = true;
    });

    let emptyRow = $('#asset-empty-state');
    if (!anyVisible) {
      if (!emptyRow) {
        emptyRow = document.createElement('tr');
        emptyRow.id = 'asset-empty-state';
        emptyRow.innerHTML = `<td colspan="8">No results.</td>`;
        tableEl.tBodies[0].appendChild(emptyRow);
      }
    } else {
      emptyRow?.remove();
    }
  }

  const initialSearchValue = liveSearch?.value || '';
  liveSearch?.addEventListener('input', debounce(() => {
    const currentValue = liveSearch?.value || '';
    if (currentValue === initialSearchValue && currentValue.length < 2) {
      filterRows();
      return;
    }
    submitFiltersToServer();
  }, 300));
  liveSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitFiltersToServer();
    }
  });
  filterRows();

  // ---------- Bulk Audit ----------
  bulkAuditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ids = $all('.rowCheckbox:checked').map(cb => cb.value);
    if (!ids.length) { notyf?.error?.('Select at least one asset.'); return; }
    if (!confirmBuildingScope('bulk-audit these assets')) return;
    if (!confirm(`Audit ${ids.length} assets?`)) return;

    const container = $('#bulkSelectedContainer');
    container.innerHTML = '';
    ids.forEach(id => {
      const inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = 'assetIds[]';
      inp.value = id;
      container.appendChild(inp);
    });

    bulkAuditForm.submit();
  });

  // ---------- Select All ----------
  selectAllCb?.addEventListener('change', () => {
    const checked = selectAllCb.checked;
    $all('tr.asset-row').forEach((row) => {
      if (row.style.display === 'none') return;
      const cb = row.querySelector('.rowCheckbox');
      if (cb) cb.checked = checked;
    });
  });

  // ---------- Expand inline audit history (row click) ----------
  $all('tr.asset-row').forEach(row => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('.btn-group') || e.target.matches('input[type="checkbox"]') || e.target.closest('a.tag-link')) return;
      const id = row.dataset.id;
      if (id) toggleAuditForId(id);
    });
  });

  const assetExportBtn = $('#assetExportBtn');
  assetExportBtn?.addEventListener('click', (e) => {
    if (!confirmBuildingScope('export asset data')) {
      e.preventDefault();
      return;
    }
    assetExportBtn.href = `/asset-catalog/export?building=${encodeURIComponent(activeBuilding())}`;
  });

  $('#assetImportTemplateBtn')?.addEventListener('click', () => {
    downloadCsv('asset_import_template.csv', [
      ['tagNumber', 'name', 'category', 'equipmentClass', 'location', 'building', 'status', 'description', 'itemType', 'managedSource', 'serialNumber', 'torque', 'toolClassification', 'lastCalibrationDate', 'nextCalibrationDue', 'calibrationIntervalDays'],
      ['', '', '', '', '', activeBuilding(), 'Available', '', 'fleet', 'asset-catalog', '', '', '', '', '', ''],
    ]);
  });

  $('#csvImportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const building = activeBuilding();
    const input = $('#assetImportBuilding');
    const form = e.currentTarget;
    const fileInput = $('#csvUpload');
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (input) input.value = building;
    if (!confirmBuildingScope('import asset data', building)) {
      return;
    }
    if (!fileInput?.files?.length) {
      notyf?.error?.('Choose a CSV file to import.');
      return;
    }

    const originalLabel = submitBtn?.textContent || 'Import CSV';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing...';
    }

    try {
      const formData = new FormData(form);
      const result = await fetchJSON(form.action, {
        method: 'POST',
        body: formData,
      });
      notyf?.success?.(result.message || 'Import complete.');

      const nextUrl = new URL(window.location.href);
      nextUrl.search = '';
      nextUrl.searchParams.set('building', building);
      nextUrl.searchParams.set('page', '1');
      setTimeout(() => window.location.assign(nextUrl.pathname + nextUrl.search + nextUrl.hash), 700);
    } catch (err) {
      notyf?.error?.(err.message || 'Import failed');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  });

  syncManagedAssetsBtn?.addEventListener('click', async () => {
    if (!confirmBuildingScope('sync managed tools and carts into the asset catalog')) return;
    const original = syncManagedAssetsBtn.textContent;
    syncManagedAssetsBtn.disabled = true;
    syncManagedAssetsBtn.textContent = 'Syncing...';
    try {
      const result = await fetchJSON('/asset-catalog/api/sync-managed-assets', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      notyf?.success?.(result.message || 'Managed assets synced.');
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      notyf?.error?.(err.message || 'Sync failed');
    } finally {
      syncManagedAssetsBtn.disabled = false;
      syncManagedAssetsBtn.textContent = original;
    }
  });
});
