/**
 * public/admin/user-mgmt.js
 * Standalone user management page logic.
 *
 * Calls:
 *   GET    /admin/users          — list all suite users
 *   POST   /admin/users          — create suite user
 *   POST   /admin/users/import   — bulk import suite users
 *   PUT    /admin/users/:id      — update user (name, role, password, techId)
 *   DELETE /admin/users/:id      — delete suite user
 *   GET    /auth/whoami          — session
 *
 * Technician roster:
 *   GET    /employees?q=&page=&limit=
 *   POST   /employees/update
 *   DELETE /employees/delete/:id
 */
'use strict';

/* ──────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────── */
function csrf() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function api(url, opts = {}) {
  const hasBody = opts.body != null;

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
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
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lc(v) {
  return String(v ?? '').trim().toLowerCase();
}

/** Matches server `MIN_PASSWORD_LEN` default (see services/userService.js). */
const MIN_PASSWORD_LEN = 8;

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

function toast(msg, type = 'ok') {
  const host = document.getElementById('umToasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = 'um-toast ' + type;
  el.textContent = msg;
  host.appendChild(el);

  setTimeout(() => el.remove(), 3500);
}

function showErr(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? '' : 'none';
}

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function rolePill(role) {
  const r = lc(role || 'user');
  return `<span class="role-pill role-${esc(r)}">${esc(r)}</span>`;
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
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

function downloadUserImportTemplate() {
  downloadCsv('suite-user-import-template.csv', [
    'username,name,password,role,techId,building',
    'jsmith,John Smith,TempPass123!,user,1001,Bldg-350',
  ]);
}

/* ──────────────────────────────────────────────────────────────
 * CSV helpers
 * ────────────────────────────────────────────────────────────── */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }

  out.push(cur.trim());
  return out.map(v => v.replace(/^"(.*)"$/, '$1').trim());
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map(h => lc(h));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function normalizeImportedUserRow(row) {
  return {
    username: String(row.username || row.user || '').trim(),
    name: String(row.name || row.displayname || row.display_name || '').trim(),
    password: String(row.password || '').trim(),
    role: lc(row.role || 'user'),
    techId: String(row.techid || row.tech_id || row.employeeid || row.employee_id || '').trim(),
    building: String(row.building || row.site || row.location || '').trim(),
  };
}

/* ──────────────────────────────────────────────────────────────
 * Password helpers
 * ────────────────────────────────────────────────────────────── */
function pwStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  const colors = ['', '#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#10b981'];

  return {
    score,
    pct: score * 20,
    label: labels[score] || '',
    color: colors[score] || '',
  };
}

function bindPwStrength(inputId, barId, hintId) {
  const inp = document.getElementById(inputId);
  const bar = document.getElementById(barId);
  const hint = document.getElementById(hintId);

  if (!inp || !bar) return;

  inp.addEventListener('input', () => {
    const { pct, label, color } = pwStrength(inp.value);
    bar.style.width = pct + '%';
    bar.style.background = color;
    if (hint) hint.textContent = label;
  });
}

function initPasswordEyes() {
  document.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });
}

/* ──────────────────────────────────────────────────────────────
 * State
 * ────────────────────────────────────────────────────────────── */
let session = null;
let allUsers = [];
let allTechs = [];

let isAdmin = false;
let isLead = false;
let isManagement = false;
let canManageTechs = false;

let techPage = 1;
let techPageSize = 20;
let techSearch = '';
let techShift = '';
let techBuilding = '';
let techLoaded = false;

/** Suite Users panel — client-side search / filters */
let userSearch = '';
let userRole = '';
let userBuilding = '';

let pendingUserImportRows = [];

/* ──────────────────────────────────────────────────────────────
 * Navigation
 * ────────────────────────────────────────────────────────────── */
function activatePanel(panelId) {
  document.querySelectorAll('.um-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.um-nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(panelId)?.classList.add('active');
  document.querySelector(`[data-panel="${panelId}"]`)?.classList.add('active');

  localStorage.setItem('um:panel', panelId);
}

function initNavigation() {
  document.querySelectorAll('.um-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => activatePanel(btn.dataset.panel));
  });
}

function applyRoleVisibility() {
  const canManageUsers = isAdmin || isManagement || isLead;
  setVisible('navUsers', canManageUsers);
  setVisible('panelUsers', canManageUsers);

  const suiteHeader = document.querySelector('#techsTable thead th:nth-child(6)');
  if (suiteHeader) suiteHeader.style.display = canManageUsers ? '' : 'none';

  if (!canManageUsers) activatePanel('panelTechs');
}

/* ──────────────────────────────────────────────────────────────
 * Session
 * ────────────────────────────────────────────────────────────── */
async function loadSession() {
  try {
    session = await api('/auth/whoami');

    const user = session?.user || null;
    const role = lc(user?.role);

    isAdmin = role === 'admin';
    isLead = role === 'lead';
    isManagement = role === 'management';
    canManageTechs = isAdmin || isLead;

    const chip = document.getElementById('sessionChip');
    if (chip && user) {
      chip.style.display = '';
      document.getElementById('sessionName').textContent = user.name || user.id || '—';
      document.getElementById('sessionRole').textContent = '· ' + (user.role || '');
    }

    const card = document.getElementById('selfCard');
    if (card && user) {
      card.innerHTML = `
        <dt>Username</dt><dd>${esc(user.id || '—')}</dd>
        <dt>Display Name</dt><dd>${esc(user.name || '—')}</dd>
        <dt>Role</dt><dd>${rolePill(user.role)}</dd>
        <dt>Tech ID</dt><dd>${esc(user.techId || '—')}</dd>
        <dt>Assigned Building</dt><dd>${esc(user.building || '—')}</dd>
      `;
    }

    const nameInp = document.getElementById('selfName');
    if (nameInp) nameInp.value = user?.name || '';

    setVisible('selfLoading', false);
    setVisible('selfContent', true);

    if (isAdmin || isManagement) {
      setVisible('btnAddUser', true);
      setVisible('btnImportUsers', true);
      setVisible('btnDownloadUserImportTemplate', true);
    }

    if (canManageTechs) {
      setVisible('btnAddTech', true);
    }
    applyRoleVisibility();
  } catch (e) {
    console.warn('Session load failed:', e);
    toast('Could not load session information', 'err');
  }
}

/* ──────────────────────────────────────────────────────────────
 * Suite Users
 * ────────────────────────────────────────────────────────────── */
async function loadUsers() {
  if (!isAdmin && !isManagement && !isLead) {
    allUsers = [];
    renderUsersTable();
    return;
  }
  setVisible('usersLoading', true);
  setVisible('usersTableWrap', false);
  setVisible('usersEmpty', false);

  try {
    const data = await api('/admin/users');
    allUsers = Array.isArray(data) ? data : (data?.users || []);
  } catch (e) {
    allUsers = [];
    toast('Could not load users: ' + e.message, 'err');
  }

  window._allUsers = allUsers;
  renderUsersTable();
}

function syncUserBuildingFilterOptions() {
  const sel = document.getElementById('userBuildingFilter');
  if (!sel) return;
  const prev = userBuilding || sel.value || '';
  const buildings = [...new Set(allUsers.map(u => u.building).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  sel.innerHTML =
    '<option value="">All buildings</option>' +
    buildings.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  const ok = prev && buildings.some(b => String(b) === String(prev));
  sel.value = ok ? prev : '';
  userBuilding = sel.value;
}

function getFilteredSuiteUsers() {
  const q = userSearch.toLowerCase().trim();
  return allUsers.filter(u => {
    const role = lc(u.role || 'user');
    if (userRole && role !== lc(userRole)) return false;
    if (userBuilding) {
      const b = String(u.building ?? '').trim();
      if (b !== userBuilding) return false;
    }
    if (q) {
      const hay = [u.username, u.name, u.techId, u.building]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function updateUserFilterChrome(filteredCount) {
  const meta = document.getElementById('userListMeta');
  if (meta) {
    const total = allUsers.length;
    const hasFilters = !!(userSearch.trim() || userRole || userBuilding);
    if (!total) meta.textContent = '';
    else if (hasFilters && filteredCount !== total) {
      meta.textContent = `(showing ${filteredCount} of ${total})`;
    } else {
      meta.textContent = `(${total})`;
    }
  }

  const clr = document.getElementById('userFilterClear');
  if (clr) {
    const active = !!(userSearch.trim() || userRole || userBuilding);
    clr.style.display = active ? '' : 'none';
  }
}

function renderUsersTable() {
  setVisible('usersLoading', false);

  const tbody = document.getElementById('usersBody');
  if (!tbody) return;

  syncUserBuildingFilterOptions();

  if (!allUsers.length) {
    setVisible('usersEmpty', true);
    setVisible('usersTableWrap', false);
    tbody.innerHTML = '';
    const emptyMsg = document.getElementById('usersEmptyMsg');
    if (emptyMsg) emptyMsg.textContent = 'No users found';
    updateUserFilterChrome(0);
    return;
  }

  const filtered = getFilteredSuiteUsers();
  updateUserFilterChrome(filtered.length);

  if (!filtered.length) {
    setVisible('usersEmpty', true);
    setVisible('usersTableWrap', false);
    tbody.innerHTML = '';
    const emptyMsg = document.getElementById('usersEmptyMsg');
    if (emptyMsg) {
      emptyMsg.textContent = 'No users match your search or filters. Try adjusting or clear filters.';
    }
    return;
  }

  setVisible('usersTableWrap', true);
  setVisible('usersEmpty', false);

  const selfId = lc(session?.user?.id);

  tbody.innerHTML = filtered.map(u => {
    const username = String(u.username || '');
    const isSelf = lc(username) === selfId;
    const targetRole = lc(u.role);
    const leadCanEditThis = isLead && (isSelf || targetRole !== 'admin');
    const canEdit = isAdmin || isManagement || isSelf || leadCanEditThis;
    const canDelete = isAdmin && !isSelf;

    return `<tr>
      <td><strong>${esc(username)}</strong>${isSelf ? ' <span style="font-size:.68rem;color:var(--accent)">(you)</span>' : ''}</td>
      <td>${esc(u.name || '—')}</td>
      <td>${rolePill(u.role)}</td>
      <td style="font-family:monospace;font-size:.82rem">${esc(u.techId || '—')}</td>
      <td style="font-size:.82rem;color:var(--fg-muted)">${esc(u.building || '—')}</td>
      <td>
        <div class="um-btn-group">
          ${canEdit ? `
            <button class="um-btn btn-edit-user" data-user="${esc(username)}" title="Edit user">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          ` : ''}
          ${canDelete ? `
            <button class="um-btn danger btn-delete-user" data-user="${esc(username)}" data-name="${esc(u.name || username)}" title="Delete user">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              Delete
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.user));
  });

  tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.user, btn.dataset.name));
  });
}

function initUserFilters() {
  let searchTimer;

  const apply = () => renderUsersTable();

  document.getElementById('userSearch')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      userSearch = e.target.value || '';
      apply();
    }, 200);
  });

  document.getElementById('userRoleFilter')?.addEventListener('change', e => {
    userRole = e.target.value || '';
    apply();
  });

  document.getElementById('userBuildingFilter')?.addEventListener('change', e => {
    userBuilding = e.target.value || '';
    apply();
  });

  document.getElementById('userFilterClear')?.addEventListener('click', () => {
    userSearch = '';
    userRole = '';
    userBuilding = '';
    const s = document.getElementById('userSearch');
    const r = document.getElementById('userRoleFilter');
    const b = document.getElementById('userBuildingFilter');
    if (s) s.value = '';
    if (r) r.value = '';
    if (b) b.value = '';
    apply();
    s?.focus();
  });
}

/* ──────────────────────────────────────────────────────────────
 * Suite User Import
 * ────────────────────────────────────────────────────────────── */
function openUserImportModal() {
  pendingUserImportRows = [];
  showErr('importUsersErr', '');

  const fileInput = document.getElementById('importUsersFile');
  const preview = document.getElementById('importUsersPreview');
  const summary = document.getElementById('importUsersSummary');

  if (fileInput) fileInput.value = '';
  if (preview) preview.innerHTML = '';
  if (summary) summary.textContent = 'Choose a CSV file to preview import rows.';

  openModal('modalImportUsers');
}

function renderUserImportPreview(rows) {
  const preview = document.getElementById('importUsersPreview');
  const summary = document.getElementById('importUsersSummary');
  if (!preview || !summary) return;

  if (!rows.length) {
    preview.innerHTML = '';
    summary.textContent = 'No valid rows found in file.';
    return;
  }

  const invalid = rows.filter(r => !r.username || !r.password);
  const valid = rows.filter(r => r.username && r.password);

  summary.textContent = `${rows.length} row(s) parsed • ${valid.length} valid • ${invalid.length} missing required fields`;

  preview.innerHTML = `
    <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm)">
      <table class="um-table" style="font-size:.8rem">
        <thead>
          <tr>
            <th>Username</th>
            <th>Name</th>
            <th>Role</th>
            <th>Tech ID</th>
            <th>Building</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.slice(0, 20).map(r => {
            const ok = r.username && r.password;
            return `
              <tr>
                <td>${esc(r.username || '—')}</td>
                <td>${esc(r.name || '—')}</td>
                <td>${esc(r.role || 'user')}</td>
                <td>${esc(r.techId || '—')}</td>
                <td>${esc(r.building || '—')}</td>
                <td style="color:${ok ? 'var(--ok)' : 'var(--danger)'}">${ok ? 'Ready' : 'Missing username/password'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length > 20 ? `<div style="margin-top:.5rem;font-size:.78rem;color:var(--fg-muted)">Preview limited to first 20 rows.</div>` : ''}
  `;
}

async function handleUserImportFile(file) {
  showErr('importUsersErr', '');

  if (!file) {
    pendingUserImportRows = [];
    renderUserImportPreview([]);
    return;
  }

  try {
    const text = await file.text();
    const parsed = parseCsv(text).map(normalizeImportedUserRow);
    pendingUserImportRows = parsed;
    renderUserImportPreview(parsed);
  } catch (e) {
    pendingUserImportRows = [];
    renderUserImportPreview([]);
    showErr('importUsersErr', 'Could not read CSV file');
  }
}

async function submitUserImport() {
  showErr('importUsersErr', '');

  if (!pendingUserImportRows.length) {
    showErr('importUsersErr', 'No import rows loaded');
    return;
  }

  try {
    const result = await api('/admin/users/import', {
      method: 'POST',
      body: JSON.stringify({ users: pendingUserImportRows }),
    });

    const created = Number(result?.created || 0);
    const skipped = Number(result?.skipped || 0);
    const failed = Number(result?.failed || 0);

    toast(`Import complete: ${created} created, ${skipped} skipped, ${failed} failed`, failed ? 'err' : 'ok');

    closeModal('modalImportUsers');
    await loadUsers();
  } catch (e) {
    showErr('importUsersErr', e.message);
  }
}

/* ──────────────────────────────────────────────────────────────
 * Suite Users: Add / Edit / Delete
 * ────────────────────────────────────────────────────────────── */
function initUserModals() {
  document.getElementById('btnAddUser')?.addEventListener('click', () => {
    if (!isAdmin && !isManagement) return;
    document.getElementById('newUsername').value = '';
    document.getElementById('newName').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newTechId').value = '';
    document.getElementById('newBuilding').value = '';
    document.getElementById('newRole').value = 'user';
    Array.from(document.getElementById('newRole').options).forEach(opt => {
      opt.hidden = isManagement && opt.value === 'admin';
    });
    document.getElementById('newPwBar').style.width = '0';
    document.getElementById('newPwBar').style.background = '';
    document.getElementById('newPwHint').textContent = '';
    showErr('addUserErr', '');
    openModal('modalAddUser');
    setTimeout(() => document.getElementById('newUsername')?.focus(), 60);
  });

  document.getElementById('btnImportUsers')?.addEventListener('click', () => {
    if (!isAdmin && !isManagement) return;
    openUserImportModal();
  });
  document.getElementById('btnImportUsersTemplate')?.addEventListener('click', downloadUserImportTemplate);
  document.getElementById('btnDownloadUserImportTemplate')?.addEventListener('click', downloadUserImportTemplate);

  document.getElementById('btnCancelImportUsers')?.addEventListener('click', () => closeModal('modalImportUsers'));
  document.getElementById('modalImportUsers')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalImportUsers');
  });

  document.getElementById('importUsersFile')?.addEventListener('change', async e => {
    const file = e.target.files?.[0] || null;
    await handleUserImportFile(file);
  });

  document.getElementById('btnConfirmImportUsers')?.addEventListener('click', submitUserImport);

  document.getElementById('btnCancelAdd')?.addEventListener('click', () => closeModal('modalAddUser'));
  document.getElementById('modalAddUser')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalAddUser');
  });

  document.getElementById('btnConfirmAdd')?.addEventListener('click', async () => {
    showErr('addUserErr', '');

    const username = document.getElementById('newUsername')?.value.trim() || '';
    const name = document.getElementById('newName')?.value.trim() || '';
    const password = document.getElementById('newPassword')?.value || '';
    const role = document.getElementById('newRole')?.value || 'user';
    const techId = document.getElementById('newTechId')?.value.trim() || '';
    const building = document.getElementById('newBuilding')?.value || '';

    if (!username) {
      showErr('addUserErr', 'Username is required');
      return;
    }
    if (!password) {
      showErr('addUserErr', 'Password is required');
      return;
    }
    if (password.length < MIN_PASSWORD_LEN) {
      toast(`Password must be at least ${MIN_PASSWORD_LEN} characters`, 'err');
      return;
    }

    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, name, password, role, techId, building }),
      });

      toast('User created successfully', 'ok');
      closeModal('modalAddUser');
      await loadUsers();
    } catch (e) {
      const msg = e.message || 'Request failed';
      showErr('addUserErr', msg);
      if (/password/i.test(msg)) toast(msg, 'err');
    }
  });

  document.getElementById('btnCancelEdit')?.addEventListener('click', () => closeModal('modalEditUser'));
  document.getElementById('modalEditUser')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalEditUser');
  });

  document.getElementById('btnConfirmEdit')?.addEventListener('click', async () => {
    showErr('editUserErr', '');

    const username = document.getElementById('editUsername')?.value || '';
    const loginEl = document.getElementById('editLoginName');
    const newLogin = loginEl ? String(loginEl.value || '').trim() : '';
    const name = document.getElementById('editName')?.value.trim() || '';
    const role = document.getElementById('editRole')?.value || 'user';
    const techId = document.getElementById('editTechId')?.value.trim() || '';
    const building = document.getElementById('editBuilding')?.value || '';
    const password = document.getElementById('editPassword')?.value || '';

    const body = { name, techId };
    if (isAdmin || isManagement) body.role = role;
    if (isAdmin || isManagement) body.building = building;
    if (isAdmin && loginEl && newLogin && lc(newLogin) !== lc(username)) {
      body.newUsername = newLogin;
    }
    if (password) {
      if (password.length < MIN_PASSWORD_LEN) {
        toast(`Password must be at least ${MIN_PASSWORD_LEN} characters`, 'err');
        return;
      }
      body.password = password;
    }

    try {
      await api('/admin/users/' + encodeURIComponent(username), {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      toast('User updated', 'ok');
      closeModal('modalEditUser');
      await loadUsers();
      await loadSession();
    } catch (e) {
      const msg = e.message || 'Request failed';
      showErr('editUserErr', msg);
      if (/password/i.test(msg)) toast(msg, 'err');
    }
  });

  document.getElementById('btnCancelDelete')?.addEventListener('click', () => closeModal('modalDeleteUser'));
  document.getElementById('modalDeleteUser')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalDeleteUser');
  });

  document.getElementById('btnConfirmDelete')?.addEventListener('click', async () => {
    showErr('deleteUserErr', '');

    const username = document.getElementById('deleteUsername')?.value || '';
    try {
      await api('/admin/users/' + encodeURIComponent(username), { method: 'DELETE' });
      toast('User deleted', 'ok');
      closeModal('modalDeleteUser');
      await loadUsers();
    } catch (e) {
      showErr('deleteUserErr', e.message);
    }
  });
}

function openEditModal(username) {
  const u = allUsers.find(x => lc(x.username) === lc(username));
  if (!u) return;

  const selfId = lc(session?.user?.id);
  const isSelf = lc(u.username) === selfId;

  document.getElementById('editUsername').value = u.username;
  const loginField = document.getElementById('editLoginName');
  const loginWrap = document.getElementById('editLoginNameField');
  if (loginField) loginField.value = u.username;
  if (loginWrap) {
    loginWrap.style.display = isAdmin ? '' : 'none';
  }
  document.getElementById('editName').value = u.name || '';
  document.getElementById('editRole').value = u.role || 'user';
  document.getElementById('editTechId').value = u.techId || '';
  document.getElementById('editBuilding').value = u.building || '';
  document.getElementById('editPassword').value = '';
  document.getElementById('editPwBar').style.width = '0';
  document.getElementById('editPwBar').style.background = '';
  document.getElementById('editSelfNotice').style.display = isSelf ? '' : 'none';
  const canManageUsers = isAdmin || isManagement;
  const canChangeRole = isAdmin || isManagement;
  document.getElementById('editRoleField').style.opacity = canChangeRole ? '1' : '.45';
  document.getElementById('editRole').disabled = !canChangeRole;
  document.getElementById('editBuildingField').style.opacity = canManageUsers ? '1' : '.45';
  document.getElementById('editBuilding').disabled = !canManageUsers;
  Array.from(document.getElementById('editRole').options).forEach(opt => {
    opt.hidden = isManagement && opt.value === 'admin';
  });
  showErr('editUserErr', '');

  openModal('modalEditUser');
  setTimeout(() => document.getElementById('editName')?.focus(), 60);
}

function openDeleteModal(username, displayName) {
  document.getElementById('deleteUsername').value = username;
  document.getElementById('deleteUserName').textContent = displayName || username;
  showErr('deleteUserErr', '');
  openModal('modalDeleteUser');
}

/* ──────────────────────────────────────────────────────────────
 * Self Account
 * ────────────────────────────────────────────────────────────── */
function initSelfActions() {
  document.getElementById('btnSelfName')?.addEventListener('click', async () => {
    showErr('selfNameErr', '');

    const name = document.getElementById('selfName')?.value.trim() || '';
    if (!name) {
      showErr('selfNameErr', 'Display name cannot be empty');
      return;
    }

    try {
      const uid = session?.user?.id;
      await api('/admin/users/' + encodeURIComponent(uid), {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });

      toast('Display name updated', 'ok');
      await loadSession();
      await loadUsers();
    } catch (e) {
      showErr('selfNameErr', e.message);
    }
  });

  document.getElementById('btnSelfPw')?.addEventListener('click', async () => {
    showErr('selfPwErr', '');

    const current = document.getElementById('selfPwCurrent')?.value || '';
    const newPw = document.getElementById('selfPwNew')?.value || '';
    const confirm = document.getElementById('selfPwConfirm')?.value || '';

    if (!current) {
      toast('Current password is required', 'err');
      return;
    }
    if (!newPw) {
      toast('New password is required', 'err');
      return;
    }
    if (newPw !== confirm) {
      toast('Passwords do not match', 'err');
      return;
    }
    if (newPw.length < MIN_PASSWORD_LEN) {
      toast(`Password must be at least ${MIN_PASSWORD_LEN} characters`, 'err');
      return;
    }

    try {
      const uid = session?.user?.id;
      await api('/admin/users/' + encodeURIComponent(uid), {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: current, password: newPw }),
      });

      toast('Password changed successfully', 'ok');

      document.getElementById('selfPwCurrent').value = '';
      document.getElementById('selfPwNew').value = '';
      document.getElementById('selfPwConfirm').value = '';
      document.getElementById('selfPwBar').style.width = '0';
      document.getElementById('selfPwBar').style.background = '';
      document.getElementById('selfPwHint').textContent = '';
    } catch (e) {
      const msg = e.message || 'Request failed';
      showErr('selfPwErr', msg);
      if (/password/i.test(msg)) toast(msg, 'err');
    }
  });
}

/* ──────────────────────────────────────────────────────────────
 * Audit Log
 * ────────────────────────────────────────────────────────────── */
async function loadAuditLog() {
  setVisible('auditLoading', true);
  setVisible('auditTableWrap', false);

  try {
    const data = await api('/admin/audit-log');
    const rows = Array.isArray(data) ? data : [];
    const tbody = document.getElementById('auditBody');

    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:2rem;color:var(--fg-muted)">
            No audit entries found.
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = rows.slice(0, 100).map(r => {
        const subject =
          r.serialNumber ||
          r.employeeId ||
          r.usernameCreated ||
          r.usernameDeleted ||
          r.username ||
          '—';

        const changes = Array.isArray(r.changes)
          ? r.changes.join(', ')
          : (r.changes || '—');

        const time = r.time ? new Date(r.time).toLocaleString() : '—';

        return `<tr>
          <td style="font-size:.8rem;color:var(--fg-muted);white-space:nowrap">${esc(time)}</td>
          <td><span style="font-size:.75rem;font-weight:700;padding:.12rem .42rem;border-radius:4px;background:var(--surface-strong);border:1px solid var(--border)">${esc(r.action || '—')}</span></td>
          <td style="font-weight:600">${esc(subject)}</td>
          <td style="color:var(--fg-muted)">${esc(r.performedBy || '—')}</td>
          <td style="font-size:.8rem;color:var(--fg-muted)">${esc(changes)}</td>
        </tr>`;
      }).join('');
    }

    setVisible('auditLoading', false);
    setVisible('auditTableWrap', true);
  } catch (e) {
    setVisible('auditLoading', false);
    toast('Could not load audit log: ' + e.message, 'err');
  }
}

function initAuditActions() {
  document.getElementById('btnRefreshAudit')?.addEventListener('click', loadAuditLog);
}

/* ──────────────────────────────────────────────────────────────
 * Technician Roster
 * ────────────────────────────────────────────────────────────── */
function canDeleteTechs() {
  return isAdmin;
}

function suiteUsersByTechIdMap() {
  const out = {};
  allUsers.forEach(u => {
    if (u?.techId) out[lc(u.techId)] = u;
  });
  return out;
}

async function loadTechs() {
  setVisible('techsLoading', true);
  setVisible('techsTableWrap', false);
  setVisible('techsEmpty', false);

  try {
    const data = await api('/employees?limit=500');
    allTechs = Array.isArray(data) ? data : (data?.items || []);

    const buildings = [...new Set(allTechs.map(e => e.building).filter(Boolean))].sort();
    const bSel = document.getElementById('techBuildingFilter');
    const curB = bSel?.value || '';

    if (bSel) {
      bSel.innerHTML =
        '<option value="">All Buildings</option>' +
        buildings.map(b => `<option value="${esc(b)}" ${b === curB ? 'selected' : ''}>${esc(b)}</option>`).join('');
    }
  } catch (e) {
    allTechs = [];
    toast('Could not load technicians: ' + e.message, 'err');
  }

  techLoaded = true;
  applyTechFilters();
}

function applyTechFilters() {
  const q = techSearch.toLowerCase().trim();
  const sh = techShift;
  const bd = techBuilding;

  const filtered = allTechs.filter(e => {
    if (sh && normalizeTechShiftValue(e.shift) !== sh) return false;
    if (bd && e.building !== bd) return false;

    if (q) {
      const hay = [e.id, e.name, e.role, e.building]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (!hay.includes(q)) return false;
    }

    return true;
  });

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / techPageSize));
  if (techPage > pages) techPage = 1;

  const start = (techPage - 1) * techPageSize;
  const slice = filtered.slice(start, start + techPageSize);

  const countEl = document.getElementById('techCount');
  if (countEl) countEl.textContent = `${total.toLocaleString()} technicians`;

  renderTechsTable(slice);
  renderTechPagination(total);
}

function renderTechsTable(slice) {
  setVisible('techsLoading', false);

  const tbody = document.getElementById('techsBody');
  if (!tbody) return;

  if (!slice.length) {
    setVisible('techsEmpty', true);
    setVisible('techsTableWrap', false);
    tbody.innerHTML = '';
    return;
  }

  setVisible('techsTableWrap', true);
  setVisible('techsEmpty', false);

  const byTechId = suiteUsersByTechIdMap();
  const canSeeSuiteUser = isAdmin || isManagement;
  const shiftDotColor = { '1': '#3b82f6', '2': '#f59e0b', '3': '#10b981', 'WKND': '#8b5cf6' };

  tbody.innerHTML = slice.map(e => {
    const shiftValue = normalizeTechShiftValue(e.shift);
    const shiftColor = shiftDotColor[shiftValue] || 'var(--fg-muted)';
    const suiteUser = byTechId[lc(e.id)];
    const suiteCell = suiteUser
      ? `<span style="font-size:.78rem;display:inline-flex;align-items:center;gap:.3rem">
           <span class="role-pill role-${esc(lc(suiteUser.role || 'user'))}" style="font-size:.68rem">${esc(suiteUser.role || 'user')}</span>
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
      ${canSeeSuiteUser ? `<td>${suiteCell}</td>` : ''}
      <td>
        <div class="um-btn-group">
          ${canManageTechs ? `
            <button class="um-btn btn-edit-tech" data-id="${esc(e.id)}" title="Edit technician">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
          ` : ''}
          ${canDeleteTechs() ? `
            <button class="um-btn danger btn-delete-tech" data-id="${esc(e.id)}" data-name="${esc(e.name)}" title="Remove technician">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              Remove
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-edit-tech').forEach(btn => {
    btn.addEventListener('click', () => {
      const tech = allTechs.find(e => String(e.id) === String(btn.dataset.id));
      if (tech) openTechModal(tech);
    });
  });

  tbody.querySelectorAll('.btn-delete-tech').forEach(btn => {
    btn.addEventListener('click', () => openDeleteTechModal(btn.dataset.id, btn.dataset.name));
  });
}

function renderTechPagination(total) {
  const pages = Math.max(1, Math.ceil(total / techPageSize));
  const info = document.getElementById('techPageInfo');
  const btns = document.getElementById('techPageBtns');

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
    b.disabled = disabled;
    b.style.cssText = 'padding:.25rem .55rem;font-size:.78rem;min-width:1.8rem;justify-content:center';
    b.addEventListener('click', () => {
      techPage = p;
      applyTechFilters();
    });
    return b;
  };

  btns.appendChild(mk('‹', techPage - 1, false, techPage === 1));

  const lo = Math.max(1, techPage - 2);
  const hi = Math.min(pages, techPage + 2);

  if (lo > 1) btns.appendChild(mk('1', 1, false, false));
  if (lo > 2) {
    const d = document.createElement('span');
    d.textContent = '…';
    d.style.padding = '0 .25rem';
    btns.appendChild(d);
  }

  for (let p = lo; p <= hi; p++) btns.appendChild(mk(String(p), p, p === techPage, false));

  if (hi < pages - 1) {
    const d = document.createElement('span');
    d.textContent = '…';
    d.style.padding = '0 .25rem';
    btns.appendChild(d);
  }

  if (hi < pages) btns.appendChild(mk(String(pages), pages, false, false));
  btns.appendChild(mk('›', techPage + 1, false, techPage >= pages));
}

function openTechModal(tech = {}) {
  const isEdit = !!tech?.id;

  document.getElementById('techModalTitle').textContent = isEdit ? 'Edit Technician' : 'Add Technician';
  document.getElementById('techOriginalId').value = tech?.id || '';
  document.getElementById('techId').value = tech?.id || '';
  document.getElementById('techIdField').style.opacity = '1';
  document.getElementById('techId').disabled = false;
  document.getElementById('techName').value = tech?.name || '';
  document.getElementById('techRole').value = tech?.role || 'Technician';
  document.getElementById('techBuilding').value = tech?.building || '';
  document.getElementById('techShiftSel').value = normalizeTechShiftValue(tech?.shift);

  showErr('techModalErr', '');
  openModal('modalTech');

  setTimeout(() => {
    (isEdit ? document.getElementById('techName') : document.getElementById('techId'))?.focus();
  }, 60);
}

function openDeleteTechModal(id, name) {
  document.getElementById('deleteTechId').value = id;
  document.getElementById('deleteTechName').textContent = name || id;
  showErr('deleteTechErr', '');
  openModal('modalDeleteTech');
}

function initTechFilters() {
  let timer;

  document.getElementById('techSearch')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      techSearch = e.target.value;
      techPage = 1;
      applyTechFilters();
    }, 200);
  });

  document.getElementById('techShiftFilter')?.addEventListener('change', e => {
    techShift = e.target.value;
    techPage = 1;
    applyTechFilters();
  });

  document.getElementById('techBuildingFilter')?.addEventListener('change', e => {
    techBuilding = e.target.value;
    techPage = 1;
    applyTechFilters();
  });
}

function initTechModals() {
  document.getElementById('btnAddTech')?.addEventListener('click', () => {
    if (!canManageTechs) return;
    openTechModal({});
  });

  document.getElementById('btnTechImportHint')?.addEventListener('click', () => {
    const h = document.getElementById('techImportHint');
    if (h) h.style.display = h.style.display === 'none' ? '' : 'none';
  });

  document.getElementById('btnCancelTech')?.addEventListener('click', () => closeModal('modalTech'));
  document.getElementById('modalTech')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalTech');
  });

  document.getElementById('btnConfirmTech')?.addEventListener('click', async () => {
    showErr('techModalErr', '');

    const originalId = document.getElementById('techOriginalId')?.value.trim() || '';
    const id = document.getElementById('techId')?.value.trim() || '';
    const name = document.getElementById('techName')?.value.trim() || '';
    const role = document.getElementById('techRole')?.value.trim() || 'Technician';
    const building = document.getElementById('techBuilding')?.value.trim() || '';
    const shift = normalizeTechShiftValue(document.getElementById('techShiftSel')?.value || '1');

    if (!id) {
      showErr('techModalErr', 'Employee ID is required');
      return;
    }
    if (!name) {
      showErr('techModalErr', 'Name is required');
      return;
    }

    try {
      await api('/employees/update', {
        method: 'POST',
        body: JSON.stringify({ originalId, id, name, role, building, shift }),
      });

      toast(`Technician ${name} saved`, 'ok');
      closeModal('modalTech');
      await loadTechs();
    } catch (e) {
      showErr('techModalErr', e.message);
    }
  });

  document.getElementById('btnCancelDeleteTech')?.addEventListener('click', () => closeModal('modalDeleteTech'));
  document.getElementById('modalDeleteTech')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modalDeleteTech');
  });

  document.getElementById('btnConfirmDeleteTech')?.addEventListener('click', async () => {
    showErr('deleteTechErr', '');

    const id = document.getElementById('deleteTechId')?.value || '';
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

/* ──────────────────────────────────────────────────────────────
 * Global UI events
 * ────────────────────────────────────────────────────────────── */
function initGlobalUI() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modalAddUser', 'modalImportUsers', 'modalEditUser', 'modalDeleteUser', 'modalTech', 'modalDeleteTech'].forEach(closeModal);
  });
}

/* ──────────────────────────────────────────────────────────────
 * Boot
 * ────────────────────────────────────────────────────────────── */
(async function init() {
  initNavigation();
  initUserModals();
  initUserFilters();
  initSelfActions();
  initTechFilters();
  initTechModals();
  initGlobalUI();
  initPasswordEyes();

  bindPwStrength('newPassword', 'newPwBar', 'newPwHint');
  bindPwStrength('selfPwNew', 'selfPwBar', 'selfPwHint');
  bindPwStrength('editPassword', 'editPwBar', null);

  await loadSession();
  if (isAdmin || isManagement || isLead) {
    await loadUsers();
  }

  document.getElementById('navTechs')?.addEventListener('click', async () => {
    if (!techLoaded) await loadTechs();
  }, { once: true });

  const saved = localStorage.getItem('um:panel');
  if (saved && document.getElementById(saved) && (saved !== 'panelUsers' || isAdmin || isManagement)) {
    activatePanel(saved);

    if (saved === 'panelTechs' && !techLoaded) {
      await loadTechs();
    }
  } else if (!isAdmin && !isManagement && !techLoaded) {
    await loadTechs();
  }
})();
