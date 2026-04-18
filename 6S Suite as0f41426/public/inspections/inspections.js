const fmtDate = (iso) => {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
};
const esc = (s) => String(s || '').replace(/[&<>\"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

let state = { items: [], options: null };
let currentDetail = null;

function query() {
  const params = new URLSearchParams();
  const q = document.getElementById('inspectionSearch')?.value.trim() || '';
  const building = document.getElementById('inspectionBuilding')?.value || '';
  const shift = document.getElementById('inspectionShiftFilter')?.value || '';
  const techId = document.getElementById('inspectionTechId')?.value.trim() || '';
  const sku = document.getElementById('inspectionSku')?.value.trim() || '';
  const dateFrom = document.getElementById('inspectionDateFrom')?.value || '';
  const dateTo = document.getElementById('inspectionDateTo')?.value || '';
  if (q) params.set('q', q);
  if (building) params.set('building', building);
  if (shift) params.set('shift', shift);
  if (techId) params.set('techId', techId);
  if (sku) params.set('sku', sku);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  return params.toString();
}

async function api() {
  const res = await fetch(`/inspections/api?${query()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Failed to load inspection reports');
  return res.json();
}

function populateBuildingOptions(options, selected) {
  const sel = document.getElementById('inspectionBuilding');
  if (!sel) return;
  const current = selected || sel.value || '';
  const canViewAll = !!options?.canViewAllBuildings;
  const buildings = Array.isArray(options?.buildings) ? options.buildings : [];
  sel.innerHTML = `${canViewAll ? '<option value="">All buildings</option>' : ''}${buildings.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('')}`;
  sel.value = current || options?.assignedBuilding || '';
  if (!canViewAll) sel.disabled = true;
}

function renderRows() {
  const tbody = document.getElementById('inspectionRows');
  const empty = document.getElementById('inspectionEmpty');
  const count = document.getElementById('inspectionCount');
  const scope = document.getElementById('inspectionScope');
  if (!tbody || !empty || !count || !scope) return;

  const items = state.items || [];
  count.textContent = `${items.length} report${items.length === 1 ? '' : 's'}`;
  const scopeParts = [
    document.getElementById('inspectionBuilding')?.value || 'All buildings',
    document.getElementById('inspectionShiftFilter')?.value ? `Shift ${document.getElementById('inspectionShiftFilter').value}` : '',
    document.getElementById('inspectionTechId')?.value.trim() ? `Tech ${document.getElementById('inspectionTechId').value.trim()}` : '',
    document.getElementById('inspectionSku')?.value.trim() || '',
    document.getElementById('inspectionDateFrom')?.value ? `From ${document.getElementById('inspectionDateFrom').value}` : '',
    document.getElementById('inspectionDateTo')?.value ? `To ${document.getElementById('inspectionDateTo').value}` : '',
  ].filter(Boolean);
  scope.textContent = scopeParts.join(' • ');

  if (!items.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  tbody.innerHTML = items.map((item, idx) => `
    <tr data-index="${idx}">
      <td>${fmtDate(item.submittedAt)}</td>
      <td>
        <div>${esc(item.operatorName || item.operatorId || '-')}</div>
        <div class="meta">${esc(item.techId || item.operatorId || '-')}</div>
      </td>
      <td>${esc(item.building || '-')}</td>
      <td><span class="pill">Shift ${esc(item.shift || '-')}</span></td>
      <td>
        <div>${esc(item.area || '-')}</div>
        <div class="meta">${esc(item.stage || '-')}</div>
      </td>
      <td>
        <div>${esc(item.rackModel || '-')}</div>
        <div class="meta">Rack ${esc(item.rackSn || '-')} • Index ${esc(item.index || '-')}</div>
      </td>
    </tr>
  `).join('');
}

function answerValue(item, keys) {
  for (const key of keys) {
    const value = item.responses?.[key];
    if (Array.isArray(value) && value.length) return value.join(', ');
    if (value) return String(value);
  }
  return 'None';
}

function openDetail(item) {
  const modal = document.getElementById('inspectionDetailModal');
  const meta = document.getElementById('inspectionDetailMeta');
  const responses = document.getElementById('inspectionDetailResponses');
  const subtitle = document.getElementById('inspectionDetailSubtitle');
  if (!modal || !meta || !responses || !subtitle) return;

  currentDetail = item;
  subtitle.textContent = `${fmtDate(item.submittedAt)} • ${item.operatorName || item.operatorId || '-'} • ${item.building || '-'} • Shift ${item.shift || '-'}`;
  meta.innerHTML = [
    ['Area', item.area],
    ['Stage', item.stage],
    ['Index', item.index],
    ['Rack SN', item.rackSn],
    ['Rack Model', item.rackModel],
    ['Tech ID', item.techId || item.operatorId],
  ].map(([label, value]) => `<div class="detail-card"><label>${esc(label)}</label><div>${esc(value || '-')}</div></div>`).join('');

  const sections = [
    {
      title: 'Cables Organized',
      answer: answerValue(item, ['cablesOrganized']),
      details: [
        ['Loose cable positions', answerValue(item, ['looseCablePositions'])],
        ['Loose cable types', answerValue(item, ['looseCableTypes'])],
      ],
    },
    {
      title: 'Cables Free of Damage',
      answer: answerValue(item, ['cablesUndamaged']),
      details: [
        ['Damaged cable positions', answerValue(item, ['damagedCablePositions'])],
        ['Damaged cable types', answerValue(item, ['damagedCableTypes'])],
      ],
    },
    {
      title: 'Server Covers Installed Correctly',
      answer: answerValue(item, ['coversInstalled']),
      details: [['Incorrect cover positions', answerValue(item, ['incorrectCoverPositions'])]],
    },
    {
      title: 'Server Covers Free of Damage',
      answer: answerValue(item, ['coversUndamaged']),
      details: [['Damaged cover positions', answerValue(item, ['damagedCoverPositions'])]],
    },
    {
      title: 'Thumb Screws Tightened Correctly',
      answer: answerValue(item, ['thumbscrewsTight']),
      details: [['Loose thumb screw positions', answerValue(item, ['looseThumbscrewPositions'])]],
    },
    {
      title: 'All Screws Installed',
      answer: answerValue(item, ['screwsInstalled']),
      details: [['Missing screw positions', answerValue(item, ['missingScrewPositions'])]],
    },
    {
      title: 'Other Damages or Issues',
      answer: answerValue(item, ['otherIssues']),
      details: [],
    },
  ];

  responses.innerHTML = sections.map((section) => `
    <div class="response-item">
      <h4>${esc(section.title)}</h4>
      <p><strong>Answer:</strong> ${esc(section.answer)}</p>
      ${section.details.map(([label, value]) => `<p><strong>${esc(label)}:</strong> ${esc(value)}</p>`).join('')}
    </div>
  `).join('');

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDetail() {
  const modal = document.getElementById('inspectionDetailModal');
  if (!modal) return;
  currentDetail = null;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

async function load() {
  const data = await api();
  state.items = data.items || [];
  state.options = data.options || null;
  populateBuildingOptions(data.options || {}, data.filters?.building || '');
  const shiftSel = document.getElementById('inspectionShiftFilter');
  if (shiftSel) shiftSel.value = data.filters?.shift || '';
  const techIdInput = document.getElementById('inspectionTechId');
  if (techIdInput) techIdInput.value = data.filters?.techId || '';
  const skuInput = document.getElementById('inspectionSku');
  if (skuInput) skuInput.value = data.filters?.sku || '';
  const dateFromInput = document.getElementById('inspectionDateFrom');
  if (dateFromInput) dateFromInput.value = data.filters?.dateFrom || '';
  const dateToInput = document.getElementById('inspectionDateTo');
  if (dateToInput) dateToInput.value = data.filters?.dateTo || '';
  renderRows();
}

function download(url) {
  window.location.href = url;
}

document.getElementById('inspectionRefresh')?.addEventListener('click', load);
document.getElementById('inspectionSearch')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
document.getElementById('inspectionTechId')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
document.getElementById('inspectionSku')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
document.getElementById('inspectionBuilding')?.addEventListener('change', load);
document.getElementById('inspectionShiftFilter')?.addEventListener('change', load);
document.getElementById('inspectionDateFrom')?.addEventListener('change', load);
document.getElementById('inspectionDateTo')?.addEventListener('change', load);
document.getElementById('inspectionExport')?.addEventListener('click', () => {
  download(`/inspections/api/export?${query()}`);
});
document.getElementById('inspectionRows')?.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-index]');
  if (!row) return;
  const item = state.items[Number(row.dataset.index)];
  if (item) openDetail(item);
});
document.getElementById('inspectionDetailExport')?.addEventListener('click', () => {
  if (!currentDetail?.id) return;
  download(`/inspections/api/${encodeURIComponent(currentDetail.id)}/export`);
});
document.getElementById('inspectionDetailClose')?.addEventListener('click', closeDetail);
document.getElementById('inspectionDetailModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'inspectionDetailModal') closeDetail();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

load().catch(() => {
  const empty = document.getElementById('inspectionEmpty');
  if (empty) { empty.hidden = false; empty.textContent = 'Unable to load inspection reports.'; }
});
