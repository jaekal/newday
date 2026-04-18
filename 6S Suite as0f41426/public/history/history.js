const esc = (s) => String(s || '').replace(/[&<>\"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const state = {
  currentAssignments: [],
  historyItems: [],
  submissionItems: [],
  acceptedIds: new Set(),
};

function formatDuration(ms) {
  if (!ms || ms < 0) return '-';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function durationClass(ms) {
  if (!ms) return '';
  if (ms > 8 * 3600000) return 'duration-danger';
  if (ms > 2 * 3600000) return 'duration-warn';
  return '';
}

function fmtDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function showSkeleton(id, visible) {
  const el = document.getElementById(id + '-skeleton');
  if (el) el.style.display = visible ? '' : 'none';
}

function showSection(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

async function api(url) {
  const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}

async function loadUser() {
  const j = await api('/auth/whoami');
  const user = j?.user;
  if (!user) {
    window.location.href = '/auth/login?next=/history/';
    return null;
  }
  const initials = (user.name || user.username || '?').split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userName').textContent = user.name || user.username || user.id;
      document.getElementById('userMeta').textContent = `Role: ${user.role || '?'} | Tech ID: ${user.techId || user.id || '?'}`;
  document.getElementById('userCard').style.display = '';
  return user;
}

function operatorIdFor(user) {
  return String(user?.techId || user?.username || user?.id || '').trim();
}

async function loadAcceptedIds(user) {
  const techId = operatorIdFor(user);
  const accepted = new Set(
    [techId, user?.id, user?.username]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (!techId) return accepted;

  try {
    const aliasData = await api(`/employees/aliases/${encodeURIComponent(techId)}`);
    const aliasIds = Array.isArray(aliasData?.ids) ? aliasData.ids : [];
    aliasIds.forEach((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) accepted.add(normalized);
    });
  } catch {
    // fallback to current session identifiers only
  }

  return accepted;
}

function matchesAcceptedId(value) {
  return state.acceptedIds.has(String(value || '').trim().toLowerCase());
}

function renderRows(tbody, items, kind) {
  tbody.innerHTML = items.map((item, idx) => item.render(idx, kind)).join('');
}

function openDetail(item) {
  const modal = document.getElementById('historyDetailModal');
  const subtitle = document.getElementById('historyDetailSubtitle');
  const meta = document.getElementById('historyDetailMeta');
  const content = document.getElementById('historyDetailContent');
  if (!modal || !subtitle || !meta || !content) return;

  subtitle.textContent = item.subtitle || '';
  meta.innerHTML = (item.meta || []).map(([label, value]) => `
    <div class="detail-block">
      <label>${esc(label)}</label>
      <div>${esc(value || '-')}</div>
    </div>
  `).join('');
  content.innerHTML = item.content || '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  const modal = document.getElementById('historyDetailModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function inspectionDetailContent(item) {
  const sections = [
    ['Cables Organized', item.responses?.cablesOrganized, [['Loose cable positions', item.responses?.looseCablePositions], ['Loose cable types', Array.isArray(item.responses?.looseCableTypes) ? item.responses.looseCableTypes.join(', ') : '']]],
    ['Cables Free of Damage', item.responses?.cablesUndamaged, [['Damaged cable positions', item.responses?.damagedCablePositions], ['Damaged cable types', Array.isArray(item.responses?.damagedCableTypes) ? item.responses.damagedCableTypes.join(', ') : '']]],
    ['Server Covers Installed Correctly', item.responses?.coversInstalled, [['Incorrect cover positions', item.responses?.incorrectCoverPositions]]],
    ['Server Covers Free of Damage', item.responses?.coversUndamaged, [['Damaged cover positions', item.responses?.damagedCoverPositions]]],
    ['Thumb Screws Tightened Correctly', item.responses?.thumbscrewsTight, [['Loose thumb screw positions', item.responses?.looseThumbscrewPositions]]],
    ['All Screws Installed', item.responses?.screwsInstalled, [['Missing screw positions', item.responses?.missingScrewPositions]]],
    ['Other Damages or Issues', item.responses?.otherIssues, []],
  ];

  return sections.map(([title, answer, details]) => `
    <div class="detail-section">
      <h4>${esc(title)}</h4>
      <p><strong>Answer:</strong> ${esc(answer || 'Not provided')}</p>
      ${details.map(([label, value]) => `<p><strong>${esc(label)}:</strong> ${esc(value || 'None')}</p>`).join('')}
    </div>
  `).join('');
}

async function loadCurrentAssignments(user) {
  showSkeleton('currentOut', true);
  const tbody = document.getElementById('currentOutBody');
  const empty = document.getElementById('currentOutEmpty');
  tbody.innerHTML = '';

  try {
    const [toolsRes, cartsRes, equipmentRes] = await Promise.all([
      api('/tools/api?status=being+used').catch(() => []),
      api('/esd-carts').catch(() => ({ carts: [] })),
      api('/asset-catalog/api/equipment?status=Checked+Out').catch(() => []),
    ]);

    const items = [];

    (toolsRes?.tools || toolsRes?.items || toolsRes || []).forEach((t) => {
      if (!matchesAcceptedId(t.operatorId)) return;
      if (String(t.status || '').toLowerCase() !== 'being used') return;
      items.push({
        type: 'Tool',
        identifier: t.serialNumber || t.code || '-',
        assignedAt: t.timestamp || t.updatedAt || '',
        subtitle: `Tool • ${fmtDate(t.timestamp || t.updatedAt)}`,
        meta: [['Type', 'Tool'], ['Identifier', t.serialNumber || t.code || '-'], ['Assigned', fmtDate(t.timestamp || t.updatedAt)]],
        content: `<div class="detail-section"><h4>Current Assignment</h4><p><strong>Model:</strong> ${esc(t.model || t.description || '-')}</p><p><strong>Status:</strong> ${esc(t.status || '-')}</p><p><strong>Operator ID:</strong> ${esc(t.operatorId || '-')}</p></div>`,
        render: (idx, kind) => {
          const ms = t.timestamp ? Date.now() - Date.parse(t.timestamp) : null;
          return `
            <tr class="history-row" data-kind="${kind}" data-index="${idx}">
              <td>${esc('Tool')}</td>
              <td><code>${esc(t.serialNumber || t.code || '-')}</code></td>
              <td>${fmtDate(t.timestamp || t.updatedAt)}</td>
              <td class="${durationClass(ms)}">${formatDuration(ms)}</td>
            </tr>
          `;
        },
      });
    });

    (cartsRes?.carts || []).forEach((c) => {
      if (!matchesAcceptedId(c.holder)) return;
      if (String(c.status || '').toLowerCase() !== 'checked_out') return;
      items.push({
        type: 'ESD Cart',
        identifier: c.id || '-',
        assignedAt: c.updatedAt || '',
        subtitle: `ESD Cart • ${fmtDate(c.updatedAt)}`,
        meta: [['Type', 'ESD Cart'], ['Identifier', c.id || '-'], ['Assigned', fmtDate(c.updatedAt)], ['Building', c.building || '-']],
        content: `<div class="detail-section"><h4>Current Assignment</h4><p><strong>Status:</strong> ${esc(c.status || '-')}</p><p><strong>Holder:</strong> ${esc(c.holder || '-')}</p></div>`,
        render: (idx, kind) => `
          <tr class="history-row" data-kind="${kind}" data-index="${idx}">
            <td>ESD Cart</td>
            <td><code>${esc(c.id || '-')}</code></td>
            <td>${fmtDate(c.updatedAt)}</td>
            <td>${formatDuration(c.updatedAt ? Date.now() - Date.parse(c.updatedAt) : null)}</td>
          </tr>
        `,
      });
    });

    (Array.isArray(equipmentRes) ? equipmentRes : []).forEach((asset) => {
      if (!matchesAcceptedId(asset.checkedOutBy)) return;
      if (String(asset.status || '').toLowerCase() !== 'checked out') return;
      items.push({
        type: 'Equipment',
        identifier: asset.tagNumber || asset.name || '-',
        assignedAt: asset.checkedOutAt || asset.updatedAt || '',
        subtitle: `Equipment • ${fmtDate(asset.checkedOutAt || asset.updatedAt)}`,
        meta: [['Type', 'Equipment'], ['Identifier', asset.tagNumber || asset.name || '-'], ['Assigned', fmtDate(asset.checkedOutAt || asset.updatedAt)]],
        content: `<div class="detail-section"><h4>Current Assignment</h4><p><strong>Name:</strong> ${esc(asset.name || '-')}</p><p><strong>Status:</strong> ${esc(asset.status || '-')}</p><p><strong>Checked out by:</strong> ${esc(asset.checkedOutBy || '-')}</p></div>`,
        render: (idx, kind) => `
          <tr class="history-row" data-kind="${kind}" data-index="${idx}">
            <td>Equipment</td>
            <td><code>${esc(asset.tagNumber || asset.name || '-')}</code></td>
            <td>${fmtDate(asset.checkedOutAt || asset.updatedAt)}</td>
            <td>${formatDuration((asset.checkedOutAt || asset.updatedAt) ? Date.now() - Date.parse(asset.checkedOutAt || asset.updatedAt) : null)}</td>
          </tr>
        `,
      });
    });

    state.currentAssignments = items.sort((a, b) => new Date(b.assignedAt || 0) - new Date(a.assignedAt || 0));
    showSkeleton('currentOut', false);
    showSection('currentOut');

    if (!state.currentAssignments.length) {
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    renderRows(tbody, state.currentAssignments, 'current');
  } catch {
    showSkeleton('currentOut', false);
    showSection('currentOut');
    empty.style.display = 'flex';
  }
}

async function loadHistory(user) {
  showSkeleton('history', true);
  const tbody = document.getElementById('historyBody');
  const empty = document.getElementById('historyEmpty');
  tbody.innerHTML = '';

  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const [toolLogsRes, cartLogsRes] = await Promise.all([
      api(`/tools/audit-log?since=${since}&limit=80`).catch(() => []),
      api('/esd-carts/audit').catch(() => []),
    ]);

    const toolLogs = (Array.isArray(toolLogsRes) ? toolLogsRes : (toolLogsRes?.items || toolLogsRes?.logs || []))
      .filter((log) => matchesAcceptedId(log.operatorId))
      .map((log) => ({
        type: 'Tool',
        identifier: log.serialNumber || '-',
        action: log.action || '-',
        at: log.timestamp || log.at,
        details: log.model || log.description || '-',
        subtitle: `Tool ${log.action || 'activity'} • ${fmtDate(log.timestamp || log.at)}`,
        meta: [['Type', 'Tool'], ['Identifier', log.serialNumber || '-'], ['Action', log.action || '-'], ['When', fmtDate(log.timestamp || log.at)]],
        content: `<div class="detail-section"><h4>Tool Activity</h4><p><strong>Model:</strong> ${esc(log.model || log.description || '-')}</p><p><strong>Operator ID:</strong> ${esc(log.operatorId || '-')}</p></div>`,
        render: (idx, kind) => {
          const actionClass = String(log.action).toLowerCase().includes('out') || String(log.action).toLowerCase().includes('checkout') ? 'pill-checkout' : 'pill-returned';
          return `
            <tr class="history-row" data-kind="${kind}" data-index="${idx}">
              <td>Tool</td>
              <td><code>${esc(log.serialNumber || '-')}</code></td>
              <td><span class="pill ${actionClass}">${esc(log.action || '-')}</span></td>
              <td>${fmtDate(log.timestamp || log.at)}</td>
              <td class="detail-copy">${esc(log.model || log.description || '-')}</td>
            </tr>
          `;
        },
      }));

    const cartLogs = (Array.isArray(cartLogsRes) ? cartLogsRes : [])
      .filter((log) => matchesAcceptedId(log.operatorId))
      .map((log) => ({
        type: 'ESD Cart',
        identifier: log.cartId || '-',
        action: log.action || '-',
        at: log.at,
        details: log.building || '-',
        subtitle: `ESD Cart ${log.action || 'activity'} • ${fmtDate(log.at)}`,
        meta: [['Type', 'ESD Cart'], ['Identifier', log.cartId || '-'], ['Action', log.action || '-'], ['When', fmtDate(log.at)]],
        content: `<div class="detail-section"><h4>Cart Activity</h4><p><strong>Building:</strong> ${esc(log.building || '-')}</p><p><strong>Operator ID:</strong> ${esc(log.operatorId || '-')}</p></div>`,
        render: (idx, kind) => {
          const actionClass = String(log.action).toLowerCase().includes('out') || String(log.action).toLowerCase().includes('checkout') ? 'pill-checkout' : 'pill-returned';
          return `
            <tr class="history-row" data-kind="${kind}" data-index="${idx}">
              <td>ESD Cart</td>
              <td><code>${esc(log.cartId || '-')}</code></td>
              <td><span class="pill ${actionClass}">${esc(log.action || '-')}</span></td>
              <td>${fmtDate(log.at)}</td>
              <td class="detail-copy">${esc(log.building || '-')}</td>
            </tr>
          `;
        },
      }));

    state.historyItems = [...toolLogs, ...cartLogs].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    showSkeleton('history', false);
    showSection('historyTable');

    if (!state.historyItems.length) {
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    renderRows(tbody, state.historyItems, 'history');
  } catch {
    showSkeleton('history', false);
    showSection('historyTable');
    empty.style.display = 'flex';
  }
}

async function loadSubmissions(user) {
  showSkeleton('tickets', true);
  const tbody = document.getElementById('ticketsBody');
  const empty = document.getElementById('ticketsEmpty');
  tbody.innerHTML = '';

  try {
    const techId = operatorIdFor(user);
    const data = await api(`/kiosk/my-items?techId=${encodeURIComponent(techId)}`);
    state.submissionItems = [
      ...(data?.tickets || []),
      ...(data?.suggestions || []),
      ...(data?.inspections || []),
    ].sort((a, b) => new Date(b.at || b.submittedAt || b.createdAt || 0) - new Date(a.at || a.submittedAt || a.createdAt || 0)).map((item) => {
      const typeLabel = item.type === 'inspection' ? 'Inspection' : (item.type === 'suggestion' ? 'Suggestion' : 'Ticket');
      const detail = item.type === 'inspection'
        ? [item.area, item.stage, item.rackModel, item.rackSn ? `Rack ${item.rackSn}` : ''].filter(Boolean).join(' | ')
        : (item.description || item.text || item.location || '-');
      const content = item.type === 'inspection'
        ? inspectionDetailContent(item)
        : `<div class="detail-section"><h4>${esc(typeLabel)} Detail</h4><p>${esc(detail)}</p>${item.taskId ? `<p><strong>Linked task:</strong> ${esc(item.taskId)}</p>` : ''}</div>`;
      return {
        ...item,
        subtitle: `${typeLabel} • ${fmtDate(item.at || item.submittedAt || item.createdAt)}`,
        meta: [
          ['Type', typeLabel],
          ['Status', item.status || 'submitted'],
          ['Submitted', fmtDate(item.at || item.submittedAt || item.createdAt)],
          ...(item.area ? [['Area', item.area]] : []),
          ...(item.stage ? [['Stage', item.stage]] : []),
          ...(item.rackModel ? [['Rack Model', item.rackModel]] : []),
          ...(item.rackSn ? [['Rack SN', item.rackSn]] : []),
        ],
        content,
        render: (idx, kind) => `
          <tr class="history-row" data-kind="${kind}" data-index="${idx}">
            <td>${esc(item.title || '(no title)')}</td>
            <td>${esc(typeLabel)}</td>
            <td><span class="pill pill-out">${esc(item.status || 'submitted')}</span></td>
            <td>${fmtDate(item.at || item.submittedAt || item.createdAt)}</td>
            <td class="detail-copy">${esc(detail)}</td>
          </tr>
        `,
      };
    });

    showSkeleton('tickets', false);
    showSection('ticketsTable');

    if (!state.submissionItems.length) {
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    renderRows(tbody, state.submissionItems, 'submission');
  } catch {
    showSkeleton('tickets', false);
    showSection('ticketsTable');
    empty.style.display = 'flex';
  }
}

function bindRowClicks() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('tr.history-row');
    if (!row) return;
    const kind = row.dataset.kind;
    const idx = Number(row.dataset.index);
    const list = kind === 'current' ? state.currentAssignments : (kind === 'history' ? state.historyItems : state.submissionItems);
    const item = list[idx];
    if (item) openDetail(item);
  });

  document.getElementById('historyDetailClose')?.addEventListener('click', closeDetail);
  document.getElementById('historyDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'historyDetailModal') closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

bindRowClicks();

const user = await loadUser();
if (user) {
  state.acceptedIds = await loadAcceptedIds(user);
  await Promise.all([
    loadCurrentAssignments(user),
    loadHistory(user),
    loadSubmissions(user),
  ]);
}
