/* ── TECHNICIAN ROSTER ─────────────────────────────────────────────
 * Appended to user-mgmt.js (or loaded as a separate module).
 * Manages employees.json via the existing /employees API.
 * Endpoints used:
 *   GET    /employees?q=&page=&limit=  — paginated list
 *   POST   /employees/update           — upsert (add or edit)
 *   DELETE /employees/delete/:id       — delete
 */

let allTechs     = [];    // full filtered list
let techPage     = 1;
let techPageSize = 20;
let techSearch   = '';
let techShift    = '';
let techBuilding = '';
let allUsers     = window._allUsers || [];   // set by loadUsers()
let techLoaded   = false;

function normalizeTechShiftValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '1';
  if (raw.toUpperCase() === 'WKND') return 'WKND';
  return raw;
}

function formatTechShiftLabel(value) {
  const normalized = normalizeTechShiftValue(value);
  return normalized === 'WKND' ? 'WKND' : `Shift ${normalized}`;
}

/* ── Load ─────────────────────────────────────────────────────── */
async function loadTechs() {
  document.getElementById('techsLoading').style.display    = '';
  document.getElementById('techsTableWrap').style.display  = 'none';
  document.getElementById('techsEmpty').style.display      = 'none';

  try {
    // Load all at once (employees list is typically <1000)
    const data = await api('/employees?limit=500');
    allTechs = Array.isArray(data) ? data : (data?.items || []);

    // Populate building filter
    const buildings = [...new Set(allTechs.map(e => e.building).filter(Boolean))].sort();
    const bSel = document.getElementById('techBuildingFilter');
    const curB = bSel?.value || '';
    if (bSel) {
      bSel.innerHTML = '<option value="">All Buildings</option>' +
        buildings.map(b => `<option value="${esc(b)}" ${b===curB?'selected':''}>${esc(b)}</option>`).join('');
    }
  } catch (e) {
    allTechs = [];
    toast('Could not load technicians: ' + e.message, 'err');
  }

  techLoaded = true;
  applyTechFilters();
}

/* ── Filter + render ──────────────────────────────────────────── */
function applyTechFilters() {
  const q  = techSearch.toLowerCase().trim();
  const sh = techShift;
  const bd = techBuilding;

  let filtered = allTechs.filter(e => {
    if (sh && String(e.shift) !== sh) return false;
    if (bd && e.building !== bd)       return false;
    if (q) {
      const hay = [e.id, e.name, e.role, e.building].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / techPageSize));
  if (techPage > pages) techPage = 1;
  const start = (techPage - 1) * techPageSize;
  const slice = filtered.slice(start, start + techPageSize);

  // Count
  const countEl = document.getElementById('techCount');
  if (countEl) countEl.textContent = `${total.toLocaleString()} technicians`;

  renderTechsTable(slice, total, start);
  renderTechPagination(total);
}

function renderTechsTable(slice, total, start) {
  document.getElementById('techsLoading').style.display = 'none';

  if (!slice.length) {
    document.getElementById('techsEmpty').style.display     = '';
    document.getElementById('techsTableWrap').style.display = 'none';
    document.getElementById('techsBody').innerHTML = '';
    return;
  }

  document.getElementById('techsTableWrap').style.display = '';
  document.getElementById('techsEmpty').style.display     = 'none';

  // Build a set of techIds from suite users for the "Suite Account" column
  const suiteUsersByTechId = {};
  (window._allUsers || []).forEach(u => {
    if (u.techId) suiteUsersByTechId[String(u.techId).toLowerCase()] = u;
  });

  const shiftDotColor = { '1':'#3b82f6', '2':'#f59e0b', '3':'#10b981', 'WKND':'#8b5cf6' };

  const tbody = document.getElementById('techsBody');
  tbody.innerHTML = slice.map(e => {
    const shiftValue = normalizeTechShiftValue(e.shift);
    const shiftColor = shiftDotColor[shiftValue] || 'var(--fg-muted)';
    const suiteUser  = suiteUsersByTechId[String(e.id).toLowerCase()];
    const suiteCell  = suiteUser
      ? `<span style="font-size:.78rem;display:inline-flex;align-items:center;gap:.3rem">
           <span class="role-pill role-${(suiteUser.role||'user').toLowerCase()}" style="font-size:.68rem">${esc(suiteUser.role||'user')}</span>
           <span style="color:var(--fg-muted)">${esc(suiteUser.username)}</span>
         </span>`
      : `<span style="font-size:.75rem;color:var(--fg-muted)">—</span>`;

    return `<tr>
      <td style="font-family:monospace;font-size:.82rem;font-weight:600">${esc(e.id)}</td>
      <td>${esc(e.name)}</td>
      <td style="font-size:.82rem;color:var(--fg-muted)">${esc(e.role || '—')}</td>
      <td style="font-size:.82rem;color:var(--fg-muted)">${esc(e.building || '—')}</td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.82rem">
          <span style="width:8px;height:8px;border-radius:50%;background:${shiftColor};flex-shrink:0"></span>
          ${esc(formatTechShiftLabel(shiftValue))}
        </span>
      </td>
      <td>${suiteCell}</td>
      <td>
        <div class="um-btn-group">
          <button class="um-btn btn-edit-tech" data-id="${esc(e.id)}" title="Edit technician">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
          <button class="um-btn danger btn-delete-tech" data-id="${esc(e.id)}" data-name="${esc(e.name)}" title="Remove technician">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Remove
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Bind actions
  tbody.querySelectorAll('.btn-edit-tech').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = allTechs.find(e => e.id === btn.dataset.id);
      if (t) openTechModal(t);
    });
  });
  tbody.querySelectorAll('.btn-delete-tech').forEach(btn => {
    btn.addEventListener('click', () => openDeleteTechModal(btn.dataset.id, btn.dataset.name));
  });
}

/* ── Pagination ────────────────────────────────────────────────── */
function renderTechPagination(total) {
  const pages = Math.max(1, Math.ceil(total / techPageSize));
  const info  = document.getElementById('techPageInfo');
  const btns  = document.getElementById('techPageBtns');
  if (!info || !btns) return;

  const start = (techPage - 1) * techPageSize;
  info.textContent = total === 0
    ? 'No results'
    : `${start + 1}–${Math.min(start + techPageSize, total)} of ${total.toLocaleString()}`;

  btns.innerHTML = '';
  if (pages <= 1) return;

  const mk = (label, p, active, disabled) => {
    const b = document.createElement('button');
    b.className = 'um-btn' + (active ? ' um-btn-primary' : '');
    b.textContent = label;
    b.disabled    = disabled;
    b.style.cssText = 'padding:.25rem .55rem;font-size:.78rem;min-width:1.8rem;justify-content:center';
    b.addEventListener('click', () => { techPage = p; applyTechFilters(); });
    return b;
  };

  btns.appendChild(mk('‹', techPage - 1, false, techPage === 1));
  const lo = Math.max(1, techPage - 2), hi = Math.min(pages, techPage + 2);
  if (lo > 1) btns.appendChild(mk('1', 1, false, false));
  if (lo > 2) { const d = document.createElement('span'); d.textContent = '…'; d.style.padding = '0 .25rem'; btns.appendChild(d); }
  for (let p = lo; p <= hi; p++) btns.appendChild(mk(p, p, p === techPage, false));
  if (hi < pages - 1) { const d = document.createElement('span'); d.textContent = '…'; d.style.padding = '0 .25rem'; btns.appendChild(d); }
  if (hi < pages) btns.appendChild(mk(pages, pages, false, false));
  btns.appendChild(mk('›', techPage + 1, false, techPage >= pages));
}

/* ── Tech modal (add / edit) ──────────────────────────────────── */
function openTechModal(tech) {
  const isEdit = !!tech?.id;
  document.getElementById('techModalTitle').textContent = isEdit ? 'Edit Technician' : 'Add Technician';
  document.getElementById('techId').value       = tech?.id       || '';
  document.getElementById('techIdField').style.opacity = isEdit ? '.6' : '1';
  document.getElementById('techId').disabled           = isEdit;
  document.getElementById('techName').value     = tech?.name     || '';
  document.getElementById('techRole').value     = tech?.role     || 'Technician';
  document.getElementById('techBuilding').value = tech?.building || '';
  document.getElementById('techShiftSel').value = normalizeTechShiftValue(tech?.shift);
  showErr('techModalErr', '');
  openModal('modalTech');
  setTimeout(() => (isEdit ? document.getElementById('techName') : document.getElementById('techId')).focus(), 60);
}

function openDeleteTechModal(id, name) {
  document.getElementById('deleteTechId').value          = id;
  document.getElementById('deleteTechName').textContent  = name || id;
  showErr('deleteTechErr', '');
  openModal('modalDeleteTech');
}

/* ── Wire filter controls ──────────────────────────────────────── */
function initTechFilters() {
  let timer;
  document.getElementById('techSearch')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { techSearch = e.target.value; techPage = 1; applyTechFilters(); }, 200);
  });
  document.getElementById('techShiftFilter')?.addEventListener('change', e => {
    techShift = e.target.value; techPage = 1; applyTechFilters();
  });
  document.getElementById('techBuildingFilter')?.addEventListener('change', e => {
    techBuilding = e.target.value; techPage = 1; applyTechFilters();
  });
}

/* ── Wire modal buttons ────────────────────────────────────────── */
function initTechModals() {
  // Add button (admin only — shown after session loads)
  document.getElementById('btnAddTech')?.addEventListener('click', () => openTechModal({}));

  // Import hint toggle
  document.getElementById('btnTechImportHint')?.addEventListener('click', () => {
    const h = document.getElementById('techImportHint');
    if (h) h.style.display = h.style.display === 'none' ? '' : 'none';
  });

  // Tech modal cancel / backdrop
  document.getElementById('btnCancelTech')?.addEventListener('click', () => closeModal('modalTech'));
  document.getElementById('modalTech')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalTech');
  });

  // Tech modal save
  document.getElementById('btnConfirmTech')?.addEventListener('click', async () => {
    showErr('techModalErr', '');
    const id       = document.getElementById('techId').value.trim();
    const name     = document.getElementById('techName').value.trim();
    const role     = document.getElementById('techRole').value.trim() || 'Technician';
    const building = document.getElementById('techBuilding').value.trim();
    const shift    = normalizeTechShiftValue(document.getElementById('techShiftSel').value);

    if (!id)   { showErr('techModalErr', 'Employee ID is required'); return; }
    if (!name) { showErr('techModalErr', 'Name is required'); return; }

    try {
      await api('/employees/update', {
        method: 'POST',
        body: JSON.stringify({ id, name, role, building, shift }),
      });
      toast(`Technician ${name} saved`, 'ok');
      closeModal('modalTech');
      await loadTechs();
    } catch (e) {
      showErr('techModalErr', e.message);
    }
  });

  // Delete tech cancel / backdrop
  document.getElementById('btnCancelDeleteTech')?.addEventListener('click', () => closeModal('modalDeleteTech'));
  document.getElementById('modalDeleteTech')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalDeleteTech');
  });

  // Delete tech confirm
  document.getElementById('btnConfirmDeleteTech')?.addEventListener('click', async () => {
    showErr('deleteTechErr', '');
    const id = document.getElementById('deleteTechId').value;
    try {
      await api(`/employees/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Technician removed', 'ok');
      closeModal('modalDeleteTech');
      await loadTechs();
    } catch (e) {
      showErr('deleteTechErr', e.message);
    }
  });
}

/* ── Expose to main init ──────────────────────────────────────── */
window._loadTechs         = loadTechs;
window._initTechFilters   = initTechFilters;
window._initTechModals    = initTechModals;
window._showBtnAddTech    = () => {
  const btn = document.getElementById('btnAddTech');
  if (btn) btn.style.display = '';
};
