// ============================
// Helpers & Config
// ============================

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
  if (meta) return meta;
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * fetchWithCsrf: adds headers, handles auth redirects/401, timeouts, and throws clean errors.
 */
async function fetchWithCsrf(url, opts = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  // Build headers once; only set Content-Type if we have a body (avoid for GET)
  const hasBody = typeof opts.body === 'string' || (opts.body && typeof opts.body === 'object');
  const headers = {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    'CSRF-Token': getCsrfToken(),
    ...(opts.headers || {})
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
      cache: 'no-store',
      headers,
      ...opts
    });

    // Auth bounce handling
    if (res.redirected && res.url.includes('/auth/login')) {
      window.location.href = res.url;
      return new Promise(() => {}); // halt
    }
    if (res.status === 401) {
      window.location.href = '/auth/login';
      return new Promise(() => {});
    }

    const payload = await safeJson(res);
    if (!res.ok) {
      const msg = payload?.message || res.statusText || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(t);
  }
}

// Simple debounce (with cancel)
function debounce(fn, wait = 200) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// Toast notifications (accessible)
const toastsContainer = (() => {
  let el = document.getElementById('toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toasts';
    el.className = 'fixed bottom-4 right-4 space-y-2 z-50';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
})();
function showToast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : 'success'}`;
  t.setAttribute('role', 'alert');
  t.textContent = message;
  toastsContainer.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Trap focus in a modal
function trapFocus(modal) {
  const focusables = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return () => {};
  const first = focusables[0], last = focusables[focusables.length - 1];

  function onKeyDown(e) {
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    } else if (e.key === 'Escape') {
      closeModal(modal);
    }
  }
  modal.addEventListener('keydown', onKeyDown);
  setTimeout(() => first.focus(), 0);
  return () => modal.removeEventListener('keydown', onKeyDown);
}

function openModal(modal) {
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}
function closeModal(modal) {
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

// Inline "Required" helper
function validateRequired(inputs) {
  let ok = true;
  inputs.forEach(inp => {
    const el = document.getElementById(inp);
    const hint = el?.nextElementSibling;
    if (!el) return;
    const valid = Boolean(el.value && String(el.value).trim().length);
    if (!valid) {
      hint?.classList?.remove('hidden');
      ok = false;
    } else {
      hint?.classList?.add('hidden');
    }
  });
  return ok;
}

// Common DataTables options
const commonDT = {
  dom: 'Bfrtipl',
  buttons: ['csv', 'excel'],
  lengthMenu: [[10, 25, 50, -1], [10, 25, 50, 'All']],
  pageLength: 10,
  processing: true
};

// Fill/clear modals
function fillForm(fields, data = {}, modal) {
  fields.forEach(({ key, selector, disabledOnEdit }) => {
    const inp = document.getElementById(selector);
    if (!inp) return;
    inp.value = data[key] ?? '';
    inp.disabled = Boolean(data[key] && disabledOnEdit);
    inp.nextElementSibling?.classList?.add('hidden');
  });
  openModal(modal);
}
function clearForm(fields, modal) {
  fields.forEach(({ selector }) => {
    const inp = document.getElementById(selector);
    if (!inp) return;
    inp.value = '';
    inp.disabled = false;
    inp.nextElementSibling?.classList?.add('hidden');
  });
  closeModal(modal);
}

// Manage active section in sidebar
const LAST_SECTION = 'admin:lastSection';
function activateSection(id) {
  ['toolsSection','employeesSection','auditSection','toolverify'].forEach(sec => {
    const el = document.getElementById(sec);
    if (el) el.hidden = true;
  });

  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('active');
    a.removeAttribute('aria-current');
  });

  const section = document.getElementById(id);
  if (section) section.hidden = false;

  const nav = document.querySelector(`[data-target="${id}"]`);
  if (nav) {
    nav.classList.add('active');
    nav.setAttribute('aria-current', 'page');
    // update hash for deep-linking
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  }

  localStorage.setItem(LAST_SECTION, id);
}

// ============================
// Main Initialization
// ============================
document.addEventListener('DOMContentLoaded', () => {
  // —– Greeting —– (best-effort)
  (async function(){
    try {
      const sess = await fetchWithCsrf('/auth/whoami', { method:'GET' });
      const username = sess?.user?.name || sess?.user?.username || sess?.username;
      if (username) {
        const h = document.getElementById('sidebarGreeting');
        if (h) h.textContent = `Hello, ${username}!`;
      }
    } catch {}
  })();

  // —– Theme Toggle —–
  const modes = ['light','dark','neon'];
  const icons = { light:'☀️', dark:'🌙', neon:'⚡️' };
  let current = localStorage.getItem('admin:theme') || 'light';
  const themeBtn = document.getElementById('themeToggle');
  function applyTheme(m) {
    document.documentElement.classList.remove('theme-light','theme-dark','theme-neon','dark');
    if (m === 'dark')      document.documentElement.classList.add('dark','theme-dark');
    else if (m === 'neon') document.documentElement.classList.add('theme-neon');
    else                   document.documentElement.classList.add('theme-light');
    if (themeBtn) themeBtn.textContent = icons[m];
    localStorage.setItem('admin:theme', m);
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      current = modes[(modes.indexOf(current)+1) % modes.length];
      applyTheme(current);
    });
  }
  applyTheme(current);

  // —– Sidebar Navigation —–
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      activateSection(link.dataset.target);
    });
  });
  const hashSection = location.hash?.slice(1);
  activateSection(hashSection || localStorage.getItem(LAST_SECTION) || 'toolsSection');

  // —– Keyboard Shortcut: Ctrl+N → New Tool —–
  document.addEventListener('keydown', e => {
    const typing = !!e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (typing) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      document.getElementById('openToolModal')?.click();
      e.preventDefault();
    }
  });

  // —————————————————————————
  // DataTables Setup
  // —————————————————————————
  const toolsSpinner = document.getElementById('spinner-tools');
  const empSpinner   = document.getElementById('spinner-emp');
  const auditSpinner = document.getElementById('spinner-audit');

  const toolsTable = $('#toolsTable').DataTable({
    ...commonDT,
    ajax: {
      url:'/tools',
      dataSrc: (json) => Array.isArray(json) ? json : []
    },
    order: [[0, 'asc']],
    columns: [
      { data:'serialNumber' },
      { data:'slot' },
      { data:'torque' },
      { data:'classification', defaultContent:'' },
      { data:'status' },
      { data:'operatorName', defaultContent:'' },
      { data:'timestamp', render: ts => ts ? new Date(ts).toLocaleString() : '', defaultContent: '' },
      { data:null, orderable:false,
        defaultContent: `
          <button class="edit-tool btn-primary px-2 py-1 text-xs mr-1" aria-label="Edit tool">✎</button>
          <button class="delete-tool btn-danger px-2 py-1 text-xs" aria-label="Delete tool">🗑️</button>`
      }
    ]
  });
  toolsTable.on('processing.dt', (_e, _ctx, proc) => toolsSpinner?.classList.toggle('hidden', !proc));

  const employeesTable = $('#employeesTable').DataTable({
    ...commonDT,
    ajax: { url:'/employees', dataSrc:(json)=>Array.isArray(json)?json:[] },
    order: [[0, 'asc']],
    columns: [
      { data:'id' },
      { data:'name' },
      { data:'role' },
      { data:'building' },
      { data:'shift' },
      { data:null, orderable:false,
        defaultContent: `
          <button class="edit-emp btn-primary px-2 py-1 text-xs mr-1" aria-label="Edit employee">✎</button>
          <button class="delete-emp btn-danger px-2 py-1 text-xs" aria-label="Delete employee">🗑️</button>`
      }
    ],
    initComplete() {
      const api = this.api();
      const fld = document.getElementById('employeesFilter');
      if (fld) fld.addEventListener('input', debounce(e => api.search(e.target.value).draw(), 200));
    }
  });
  employeesTable.on('processing.dt', (_e, _ctx, proc) => empSpinner?.classList.toggle('hidden', !proc));

  const auditTable = $('#auditTable').DataTable({
    ...commonDT,
    ajax: { url:'/admin/audit-log', dataSrc:(json)=>Array.isArray(json)?json:[] },
    order: [[0, 'desc']],
    columns: [
      { data:'time', render: ts => ts ? new Date(ts).toLocaleString() : '' },
      { data:null, render: row =>
          row.serialNumber
            || row.employeeId
            || row.usernameCreated
            || row.usernameDeleted
            || ''
      },
      { data:'action' },
      { data:'performedBy' },
      { data:'changes', render: ch => Array.isArray(ch) ? ch.join(', ') : (ch || '') }
    ],
    initComplete() {
      const api = this.api();
      const fld = document.getElementById('auditFilter');
      if (fld) fld.addEventListener('input', debounce(e => api.search(e.target.value).draw(), 200));
    }
  });
  auditTable.on('processing.dt', (_e, _ctx, proc) => auditSpinner?.classList.toggle('hidden', !proc));

  // —————————————————————————
  // Real-Time Updates
  // —————————————————————————
  if (typeof window.io === 'function') {
    const socket = window.io({ withCredentials: true });
    socket.on('toolsUpdated',     debounce(() => { toolsTable.ajax.reload(null, false); }, 200));
    socket.on('employeesUpdated', debounce(() => { employeesTable.ajax.reload(null, false); }, 200));
    socket.on('auditUpdated',     debounce(() => { auditTable.ajax.reload(null, false); }, 200));
  }

  // —————————————————————————
  // Modals & CRUD Handlers
  // —————————————————————————
  const toolModal = document.getElementById('toolModal');
  const empModal  = document.getElementById('empModal');

  const toolFields = [
    { key:'serialNumber',       selector:'modalSerial',   disabledOnEdit:true },
    { key:'slot',               selector:'modalSlot' },
    { key:'torque',             selector:'modalTorque' },
    { key:'classification',     selector:'modalClass' },
    { key:'description',        selector:'modalDesc' },
    { key:'model',              selector:'modalModel' },
    { key:'calibrationStatus',  selector:'modalCalStat' },
    { key:'calibrationDate',    selector:'modalCalDate' },
    { key:'nextCalibrationDue', selector:'modalNextCal' }
  ];
  const empFields = [
    { key:'id',        selector:'modalEmpId',   disabledOnEdit:true },
    { key:'name',      selector:'modalEmpName' },
    { key:'role',      selector:'modalEmpRole' },
    { key:'building',  selector:'modalEmpBld' },
    { key:'shift',     selector:'modalEmpShift' }
  ];

  let releaseToolTrap = () => {};
  let releaseEmpTrap  = () => {};

  // Backdrop click to close
  [toolModal, empModal].forEach(m => {
    m?.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  document.getElementById('openToolModal')?.addEventListener('click', () => {
    clearForm(toolFields, toolModal);
    document.getElementById('toolModalTitle').textContent = 'Add Tool';
    fillForm(toolFields, {}, toolModal);
    releaseToolTrap = trapFocus(toolModal);
  });
  document.getElementById('cancelToolBtn')?.addEventListener('click', () => {
    clearForm(toolFields, toolModal);
    releaseToolTrap();
  });

  document.getElementById('openEmpModal')?.addEventListener('click', () => {
    clearForm(empFields, empModal);
    document.getElementById('empModalTitle').textContent = 'Add Employee';
    fillForm(empFields, {}, empModal);
    releaseEmpTrap = trapFocus(empModal);
  });
  document.getElementById('cancelEmpBtn')?.addEventListener('click', () => {
    clearForm(empFields, empModal);
    releaseEmpTrap();
  });

  document.getElementById('toolForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    if (!validateRequired(['modalSerial','modalSlot','modalTorque'])) return;

    try {
      const serialInp = document.getElementById('modalSerial');

      const payload = {};
      toolFields.forEach(({ key, selector }) => {
        const el = document.getElementById(selector);
        payload[key] = el?.value?.trim?.() ?? '';
      });

      // Endpoints: keep admin endpoints you already wired
      const url = serialInp.disabled ? '/admin/editTool' : '/admin/addTool';
      await fetchWithCsrf(url, { method:'POST', body: JSON.stringify(payload) });
      showToast(serialInp.disabled ? 'Tool updated' : 'Tool added');
      $('#toolsTable').DataTable().ajax.reload(null, false);
      clearForm(toolFields, toolModal);
      releaseToolTrap();
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    }
  });

  document.getElementById('empForm')?.addEventListener('submit', async e => {
    e.preventDefault();

    if (!validateRequired(['modalEmpId','modalEmpName'])) return;

    try {
      const idInp = document.getElementById('modalEmpId');

      const payload = {};
      empFields.forEach(({ key, selector }) => {
        const el = document.getElementById(selector);
        let v = el?.value?.trim?.() ?? '';
        if (key === 'shift') v = parseInt(v, 10);
        payload[key] = v;
      });

      // Keep your existing admin endpoints here as well
      const url = idInp.disabled ? '/admin/updateEmployee' : '/admin/addEmployee';
      await fetchWithCsrf(url, { method:'POST', body: JSON.stringify(payload) });
      showToast(idInp.disabled ? 'Employee updated' : 'Employee added');
      $('#employeesTable').DataTable().ajax.reload(null, false);
      clearForm(empFields, empModal);
      releaseEmpTrap();
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    }
  });

  $('#toolsTable')
    .on('click', '.edit-tool', function() {
      const data = $('#toolsTable').DataTable().row($(this).closest('tr')).data();
      clearForm(toolFields, toolModal);
      document.getElementById('toolModalTitle').textContent = 'Edit Tool';
      fillForm(toolFields, data, toolModal);
      releaseToolTrap = trapFocus(toolModal);
    })
    .on('click', '.delete-tool', async function() {
      if (!confirm('Remove this tool?')) return;
      const { serialNumber } = $('#toolsTable').DataTable().row($(this).closest('tr')).data();
      try {
        await fetchWithCsrf(`/admin/deleteTool/${encodeURIComponent(serialNumber)}`, { method:'DELETE' });
        showToast(`Removed ${serialNumber}`);
        $('#toolsTable').DataTable().ajax.reload(null, false);
      } catch (err) {
        showToast(err.message || 'Delete failed', 'error');
      }
    });

  $('#employeesTable')
    .on('click', '.edit-emp', function() {
      const data = $('#employeesTable').DataTable().row($(this).closest('tr')).data();
      clearForm(empFields, empModal);
      document.getElementById('empModalTitle').textContent = 'Edit Employee';
      fillForm(empFields, data, empModal);
      releaseEmpTrap = trapFocus(empModal);
    })
    .on('click', '.delete-emp', async function() {
      if (!confirm('Remove this employee?')) return;
      const { id } = $('#employeesTable').DataTable().row($(this).closest('tr')).data();
      try {
        await fetchWithCsrf(`/admin/deleteEmployee/${encodeURIComponent(id)}`, { method:'DELETE' });
        showToast(`Removed employee ${id}`);
        $('#employeesTable').DataTable().ajax.reload(null, false);
      } catch (err) {
        showToast(err.message || 'Delete failed', 'error');
      }
    });

  // —————————————————————————
  // TOOL VERIFICATION AUDIT TAB
  // —————————————————————————
  let cachedAllTools = [];
  async function fetchAllTools() {
    if (cachedAllTools.length) return cachedAllTools;
    try {
      const data = await fetchWithCsrf('/tools');
      cachedAllTools = Array.isArray(data) ? data : [];
      return cachedAllTools;
    } catch (err) {
      showToast(err.message || 'Failed to load tools', 'error');
      return [];
    }
  }

  const verificationInput   = document.getElementById('verificationInput');
  const verificationForm    = document.getElementById('verificationAuditForm');
  const verificationResults = document.getElementById('verificationAuditResults');
  const cancelVerification  = document.getElementById('cancelVerificationAudit');

  function clearVerificationResults() {
    if (verificationInput) verificationInput.value = '';
    if (verificationResults) verificationResults.innerHTML = '';
  }
  cancelVerification?.addEventListener('click', clearVerificationResults);

  // Normalize to uppercase trimmed for fair matches
  const normSerial = s => String(s || '').trim().toUpperCase();

  if (verificationForm && verificationInput && verificationResults) {
    verificationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = verificationInput.value.trim();
      if (!input) {
        verificationResults.innerHTML = '<div class="text-red-600">Please enter or scan serial numbers (one per line).</div>';
        return;
      }

      const scannedSerials = input.split(/\r?\n/).map(s => normSerial(s)).filter(Boolean);
      const toolData = await fetchAllTools();

      const inventorySerials = toolData.map(tool =>
        normSerial(tool.serialNumber || tool.SerialNumber || tool.ItemCode || '')
      ).filter(Boolean);

      const setInventory = new Set(inventorySerials);
      const found        = scannedSerials.filter(s => setInventory.has(s));
      const notFound     = scannedSerials.filter(s => !setInventory.has(s));

      const setScanned   = new Set(scannedSerials);
      const missingInScan = inventorySerials.filter(s => !setScanned.has(s));

      const count = (arr) => `<strong>${arr.length}</strong>`;
      let html = '';
      html += `<div><strong>✅ Matched (${count(found)}):</strong> <span class="text-green-800 break-words">${found.join(', ') || 'None'}</span></div>`;
      html += `<div><strong>❌ Not Found (${count(notFound)}):</strong> <span class="text-red-800 break-words">${notFound.join(', ') || 'None'}</span></div>`;
      html += `<div><strong>🟡 Missing From Scan (${count(missingInScan)}):</strong> <span class="text-yellow-700 break-words">${missingInScan.join(', ') || 'None'}</span></div>`;
      html += `<div class="mt-3 text-gray-500 text-xs">* "Not Found" = scanned but not in inventory. "Missing From Scan" = in inventory but not scanned.</div>`;
      verificationResults.innerHTML = html;

      // Export results button
      let exportBtn = document.getElementById('exportVerificationResults');
      if (exportBtn) exportBtn.remove();
      exportBtn = document.createElement('button');
      exportBtn.id = 'exportVerificationResults';
      exportBtn.className = 'btn-primary ml-2 mt-3';
      exportBtn.textContent = 'Export Results';
      exportBtn.addEventListener('click', () => {
        // UTF-8 BOM for Excel
        let csv = '\uFEFFType,Serial\n';
        const esc = (s) => `"${String(s).replace(/"/g,'""')}"`;
        found.forEach(s => { csv += `Matched,${esc(s)}\n`; });
        notFound.forEach(s => { csv += `NotFound,${esc(s)}\n`; });
        missingInScan.forEach(s => { csv += `MissingFromScan,${esc(s)}\n`; });
        const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `verification_results_${new Date().toISOString().slice(0,10)}_.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
      verificationResults.appendChild(exportBtn);

      // Log to backend (best-effort)
      try {
        const greeting = document.getElementById('sidebarGreeting')?.textContent || '';
        await fetchWithCsrf('/admin/logVerificationAudit', {
          method: 'POST',
          body: JSON.stringify({
            timestamp: Date.now(),
            found, notFound, missingInScan,
            user: greeting.replace(/^Hello,\s*/,'').replace(/!$/,'')
          })
        });
      } catch {}
    });
  }

  // Logout (use auth route for consistency)
  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    await fetchWithCsrf('/auth/logout', { method:'POST' });
    window.location.href = '/';
  });
});
