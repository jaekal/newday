//public/screwdriver/render.js

import { apiCheckout, apiReturn } from './api.js';
import { state } from './state.js';
import { fetchAndRenderAll } from './loader.js';
import { getTorqueBucket, formatDuration } from './helpers.js';

let durationTimer = null;

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}

function getActiveBuilding() {
  return (document.getElementById('buildingFilter')?.value || state.filters?.building || '').trim();
}

function getBuildingScopedTools() {
  const tools = Array.isArray(state.allTools) ? state.allTools : [];
  const building = getActiveBuilding();
  if (!building || building === 'all') return tools;
  return tools.filter((tool) => (tool.building || 'Bldg-350') === building);
}

// ── KPI bar update (recommendation #7 + #4) ──────────────────────────────────
export function updateKpiBar() {
  const tools = getBuildingScopedTools();
  const avail    = tools.filter(t => t.status === 'in inventory').length;
  const out      = tools.filter(t => t.status === 'being used').length;
  const calDue   = tools.filter(t => {
    if (!t.nextCalibrationDue) return false;
    const days = Math.ceil((new Date(t.nextCalibrationDue) - Date.now()) / 86400000);
    return days <= 14;
  }).length;
  const overdue8h = tools.filter(t => {
    if (t.status !== 'being used' || !t.timestamp) return false;
    return (Date.now() - Date.parse(t.timestamp)) >= 8 * 3600000;
  }).length;

  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setKpi('kpi-avail', avail);
  setKpi('kpi-out',   out);
  setKpi('kpi-cal',   calDue);

  // Colour-code out KPI if anything is 8h+
  const outEl = document.getElementById('kpi-out-card');
  if (outEl) outEl.className = 'sd-kpi-card' + (overdue8h > 0 ? ' sd-kpi--danger' : out > 0 ? ' sd-kpi--warn' : '');
  const calEl = document.getElementById('kpi-cal-card');
  if (calEl) calEl.className = 'sd-kpi-card' + (calDue > 0 ? ' sd-kpi--warn' : '');

  // Tab badge for Tools tab (#4)
  const toolBadge = document.getElementById('toolsCheckedBadge');
  if (toolBadge) {
    toolBadge.textContent = out;
    toolBadge.style.display = out > 0 ? '' : 'none';
    toolBadge.style.background = overdue8h > 0 ? 'var(--danger-bg)' : 'var(--warn-bg)';
    toolBadge.style.color      = overdue8h > 0 ? 'var(--danger)' : 'var(--warn)';
    toolBadge.style.borderColor= overdue8h > 0 ? 'var(--danger)' : 'var(--warn)';
  }
}

export function updateSummaryPanel() {
  const panel = document.getElementById('summaryPanel');
  if (!panel) return;
  const tools = getBuildingScopedTools();
  panel.innerHTML = `
    <strong>Total Tools:</strong> ${tools.length}<br>
    <strong>Available:</strong> ${tools.filter(t => t.status === 'in inventory').length}<br>
    <strong>Checked Out:</strong> ${tools.filter(t => t.status === 'being used').length}<br>
  `;
}

export function populateTorqueFilter() {
  const sel = document.getElementById('torqueFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Torques</option>';
  const torques = Array.from(new Set((state.allTools || []).map(t => t.torque).filter(v => v !== '' && v !== null && v !== undefined)))
    .sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  torques.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
  if (current && torques.includes(current)) sel.value = current;
}

// ── Overdue holds panel (recommendation #11) ─────────────────────────────────
export function updateOverduePanel() {
  const panel = document.getElementById('overduePanel');
  const list  = document.getElementById('overdueList');
  if (!panel || !list) return;

  const overdue = getBuildingScopedTools().filter(t => {
    if (t.status !== 'being used' || !t.timestamp) return false;
    return (Date.now() - Date.parse(t.timestamp)) >= 5 * 3600000;
  }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const hdr = document.getElementById('overdueCount');
  if (hdr) hdr.textContent = overdue.length ? `${overdue.length} tool${overdue.length > 1 ? 's' : ''} 5h+` : '';

  panel.style.display = overdue.length ? '' : 'none';
  list.innerHTML = '';
  overdue.forEach(t => {
    const ms    = Date.now() - Date.parse(t.timestamp);
    const hours = (ms / 3600000).toFixed(1);
    const opId  = (t.operatorId || '').toLowerCase();
    const opName = state.employeeMap?.[opId] || t.operatorName || t.operatorId || '—';
    const shift = state.employeeShift?.[opId] || 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700">${esc(t.serialNumber || '?')}</td>
      <td><span class="shift-dot shift-${esc(shift)}" title="Shift ${esc(shift)}"></span>${esc(opName)}</td>
      <td style="color:var(--danger);font-weight:700">${hours}h</td>
      <td>${state.isAdmin ? `<button class="btn-return btn-sm" data-serial="${esc(t.serialNumber)}" style="font-size:.72rem;padding:.18rem .45rem">Return</button>` : ''}</td>`;
    list.appendChild(tr);
  });

  // Admin return from overdue panel
  list.querySelectorAll('[data-serial]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await apiReturn(btn.dataset.serial); await fetchAndRenderAll(); }
      catch (err) { alert(err.message || 'Return failed'); }
    });
  });
}

function getTierStateClass(tierTools) {
  const total = tierTools.length;
  const checkedOut = tierTools.filter(t => t.status === 'being used').length;

  if (!total) return 'tier-all-available';
  if (checkedOut === 0) return 'tier-all-available';
  if (checkedOut === total) return 'tier-all-out';
  return 'tier-partial-out';
}

export function renderTools() {
  const container = document.getElementById('toolTiers');
  if (!container) return;
  container.innerHTML = '';

  const tools = state.filteredTools || [];
  const viewMode = localStorage.getItem('viewToggle') || document.getElementById('viewToggle')?.value || 'grid';

  const perTier = 14;
  const tierCount = Math.ceil(tools.length / perTier);
  let openTiers = JSON.parse(localStorage.getItem('openTiers') || '[]');
  if (!Array.isArray(openTiers)) openTiers = [0];
  if (openTiers.length === 0) openTiers = [0];

  const frag = document.createDocumentFragment();

  for (let i = 0; i < tierCount; i++) {
    const tierTools = tools.slice(i * perTier, (i + 1) * perTier);
    const opened = openTiers.includes(i);

    const totalCount = tierTools.length;
    const availableCount = tierTools.filter(t => t.status === 'in inventory').length;
    const outCount = tierTools.filter(t => t.status === 'being used').length;

    const tierStateClass = getTierStateClass(tierTools);

    const tierBox = document.createElement('section');
    tierBox.className = `tier-box ${tierStateClass}`;
    tierBox.dataset.tier = String(i + 1);

    const header = document.createElement('div');
    header.className = 'tier-header';
    header.innerHTML = `
      <div class="tier-header-main">
        <span class="tier-title">Tier ${i + 1}</span>
        <span class="tier-summary">
          (${totalCount} total, ${availableCount} avail, ${outCount} out)
        </span>
      </div>
      <button class="arrow" aria-label="Toggle tier ${i + 1}" aria-expanded="${opened}" type="button">
        ${opened ? '▲' : '▼'}
      </button>
    `;

    header.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains('arrow')) return;
      toggleTier(i);
    });

    const content = document.createElement('div');
    content.className = 'tier-content';
    content.style.display = opened ? 'block' : 'none';

    const wrapper = document.createElement('div');
    wrapper.className = viewMode === 'grid' ? 'tool-grid' : 'tool-list';

    if (viewMode === 'list') {
      const thead = document.createElement('div');
      thead.className = 'tool-list-header';
      thead.innerHTML = `
        <span>Serial</span><span>Type</span><span>Torque</span>
        <span>Status</span><span>Operator</span>
        <span>Duration</span><span>Cal Due</span><span>Action</span>`;
      wrapper.appendChild(thead);
    }

    const subFrag = document.createDocumentFragment();
    tierTools.forEach(tool => subFrag.appendChild(renderToolCard(tool, viewMode)));
    wrapper.appendChild(subFrag);
    content.appendChild(wrapper);

    tierBox.appendChild(header);
    tierBox.appendChild(content);
    frag.appendChild(tierBox);
  }

  container.appendChild(frag);

  clearInterval(durationTimer);
  durationTimer = setInterval(updateDurations, 30000);
  updateDurations();
  updateSummaryPanel();
  updateKpiBar();
  updateOverduePanel();
}

function toggleTier(index) {
  const tierBoxes = document.querySelectorAll('.tier-box');
  const tierBox = tierBoxes[index];
  if (!tierBox) return;

  const content = tierBox.querySelector('.tier-content');
  const arrow = tierBox.querySelector('.tier-header .arrow');
  if (!content || !arrow) return;

  let openTiers = JSON.parse(localStorage.getItem('openTiers') || '[]');
  if (!Array.isArray(openTiers)) openTiers = [0];

  const isOpen = openTiers.includes(index);

  if (isOpen) {
    content.style.display = 'none';
    arrow.textContent = '▼';
    arrow.setAttribute('aria-expanded', 'false');
    openTiers = openTiers.filter(i => i !== index);
  } else {
    content.style.display = 'block';
    arrow.textContent = '▲';
    arrow.setAttribute('aria-expanded', 'true');
    openTiers.push(index);
  }

  localStorage.setItem('openTiers', JSON.stringify(openTiers));
}

// ── Cal pill helper (recommendation #5) ──────────────────────────────────────
function calPillHtml(tool) {
  if (!tool.nextCalibrationDue) return '';
  const days = Math.ceil((new Date(tool.nextCalibrationDue) - Date.now()) / 86400000);
  const date  = new Date(tool.nextCalibrationDue).toLocaleDateString(undefined, { dateStyle: 'medium' });
  if (days <= 0)   return `<span class="cal-pill cal-pill--expired"  title="Cal expired: ${date}">Cal expired</span>`;
  if (days <= 7)   return `<span class="cal-pill cal-pill--due"      title="Cal due: ${date}">Cal ${days}d</span>`;
  if (days <= 14)  return `<span class="cal-pill cal-pill--soon"     title="Cal due: ${date}">Cal ${days}d</span>`;
  return '';
}

function setInlineCheckoutOpen(card, isOpen) {
  const form = card.querySelector('.inline-checkout-form');
  const footerBtn = card.querySelector('.card-footer .btn-checkout, .card-footer .btn-return');
  if (form) {
    form.style.display = isOpen ? '' : 'none';
    form.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }
  if (footerBtn && footerBtn.classList.contains('btn-checkout')) {
    footerBtn.classList.toggle('is-cancel', isOpen);
    footerBtn.textContent = isOpen ? 'Cancel' : 'Checkout';
    footerBtn.setAttribute('aria-label', `${isOpen ? 'Cancel' : 'Checkout'} ${card.dataset.serial || ''}`.trim());
    footerBtn.style.background = isOpen ? 'var(--danger, #c0362c)' : '';
    footerBtn.style.borderColor = isOpen ? 'var(--danger, #c0362c)' : '';
    footerBtn.style.color = isOpen ? '#fff' : '';
  }
}

// ── Tool card (grid or list row) ─────────────────────────────────────────────
function renderToolCard(tool, viewMode = 'grid') {
  const id = tool.serialNumber || 'unknown';

  if (viewMode === 'list') {
    return renderToolListRow(tool, id);
  }

  const card = document.createElement('div');
  card.className = [
    'tool-box',
    tool.status === 'in inventory' ? 'available' : '',
    tool.status === 'being used' ? 'checked-out' : ''
  ].join(' ').trim();
  card.dataset.serial = id;

  if (tool.nextCalibrationDue) {
    const days = Math.ceil((new Date(tool.nextCalibrationDue) - Date.now()) / 86400000);
    if (days <= 0) card.classList.add('expired');
    else if (days <= 7) card.classList.add('warning');
  }

  const opId   = (tool.operatorId || '').toLowerCase();
  const shift  = state.employeeShift?.[opId] || 1;
  const opName = state.employeeMap?.[opId] || tool.operatorName || 'Unknown';
  const torqueBucket = getTorqueBucket(tool.torque);

  card.innerHTML = `
    <div class="status-badge ${tool.status === 'in inventory' ? 'available' : 'checked-out'}">
      ${tool.status === 'in inventory' ? 'Available' : 'Checked Out'}
    </div>
    <input type="checkbox" class="bulk-check" data-id="${esc(id)}" aria-label="Select ${esc(id)}" />

    <div class="card-body">
      <div class="icon-badge" title="${esc(tool.classification || '')}">
        ${getClassificationIcon(tool.classification)}
      </div>
      <div class="tool-serial"><strong>${esc(id)}</strong></div>

      ${tool.status === 'being used' ? `
        <div class="operator shift-${esc(shift)}" title="Operator: ${esc(opName)}">
          ${esc(opName)}
        </div>` : `<div class="operator" aria-hidden="true"></div>`}

      ${tool.timestamp ? `
        <div class="duration" data-ts="${esc(tool.timestamp)}">
          ${formatDuration(tool.timestamp)}
        </div>` : `<div class="duration" aria-hidden="true"></div>`}

      ${tool.slot ? `<div class="slot-badge">${esc(tool.slot)}</div>` : ''}

      <div class="card-badges-row">
        ${tool.torque ? `<div class="torque-badge ${torqueBucket ? `torque--${torqueBucket}` : ''}">${esc(tool.torque)}</div>` : ''}
        ${calPillHtml(tool)}
      </div>

      <div class="tool-details tool-details--collapsed">
        ${tool.classification ? `Class: ${esc(tool.classification)}<br>` : ''}
      </div>
    </div>

    <div class="card-footer">
      ${tool.status === 'being used'
        ? `<button class="btn-return" aria-label="Return ${esc(id)}">Return</button>`
        : `<button class="btn-checkout" aria-label="Checkout ${esc(id)}">Checkout</button>`
      }
      <button class="toggle-icon" aria-expanded="false" aria-label="Toggle details">▼</button>
    </div>

    <div class="inline-checkout-form" style="display:none" aria-hidden="true">
      <input type="text" class="inline-op-input" placeholder="Operator ID" autocomplete="off"
             value="${esc(sessionStorage.getItem('sd-last-op') || '')}"/>
      <div style="display:flex;gap:4px;margin-top:4px">
        <button class="inline-confirm btn-checkout" style="flex:1">✓ Confirm</button>
      </div>
    </div>
  `;

  bindCardEvents(card, tool);
  return card;
}

// ── List row (recommendation #9) ─────────────────────────────────────────────
function renderToolListRow(tool, id) {
  const row = document.createElement('div');
  row.className = 'tool-list-row' +
    (tool.status === 'being used' ? ' checked-out' : ' available');
  row.dataset.serial = id;

  const opId   = (tool.operatorId || '').toLowerCase();
  const shift  = state.employeeShift?.[opId] || 1;
  const opName = state.employeeMap?.[opId] || tool.operatorName || '—';
  const torqueBucket = getTorqueBucket(tool.torque);

  let durClass = '';
  if (tool.timestamp) {
    const h = (Date.now() - Date.parse(tool.timestamp)) / 3600000;
    durClass = h >= 5 ? 'dur-red' : h >= 2 ? 'dur-amber' : 'dur-green';
  }

  // Cal due column
  let calText = '—', calClass = '';
  if (tool.nextCalibrationDue) {
    const days = Math.ceil((new Date(tool.nextCalibrationDue) - Date.now()) / 86400000);
    if (days <= 0)  { calText = 'Expired'; calClass = 'dur-red'; }
    else if (days <= 7) { calText = `${days}d`; calClass = 'dur-amber'; }
    else { calText = new Date(tool.nextCalibrationDue).toLocaleDateString(undefined, { dateStyle: 'short' }); }
  }

  row.innerHTML = `
    <span class="tool-serial"><strong>${esc(id)}</strong></span>
    <span>${getClassificationIcon(tool.classification)}</span>
    <span>${tool.torque ? `<span class="torque-badge ${torqueBucket ? `torque--${torqueBucket}` : ''}">${esc(tool.torque)}</span>` : '—'}</span>
    <span>
      <span class="status-badge ${tool.status === 'in inventory' ? 'available' : 'checked-out'}" style="font-size:.7rem;padding:.1rem .4rem">
        ${tool.status === 'in inventory' ? 'Available' : 'Out'}
      </span>
    </span>
    <span class="${tool.status === 'being used' ? `shift-${esc(shift)}` : ''}">${tool.status === 'being used' ? esc(opName) : '—'}</span>
    <span class="${durClass}">${tool.timestamp ? formatDuration(tool.timestamp) : '—'}</span>
    <span class="${calClass}">${calText}</span>
    <span>
      ${tool.status === 'being used'
        ? `<button class="btn-return btn-sm" data-serial="${esc(id)}" style="font-size:.72rem;padding:.18rem .45rem">Return</button>`
        : `<button class="btn-checkout btn-sm" data-serial="${esc(id)}" style="font-size:.72rem;padding:.18rem .45rem">Checkout</button>`
      }
    </span>`;

  // List row button events
  row.querySelector('.btn-return, .btn-checkout')?.addEventListener('click', async (e) => {
    const serial = e.currentTarget.dataset.serial;
    if (e.currentTarget.classList.contains('btn-return')) {
      try { await apiReturn(serial); await fetchAndRenderAll(); }
      catch (err) { alert(err.message || 'Return failed'); }
    } else {
      // Pre-fill from last used operator; prompt only if none stored
      const stored = sessionStorage.getItem('sd-last-op') || '';
      const op = stored || prompt('Enter Operator ID:')?.trim().toLowerCase();
      if (!op || !serial) return;
      sessionStorage.setItem('sd-last-op', op);
      try { await apiCheckout(serial, op); await fetchAndRenderAll(); }
      catch (err) { alert(err.message || 'Checkout failed'); }
    }
  });

  return row;
}

// ── Card events (recommendation #3 — inline checkout form) ───────────────────
function bindCardEvents(card, tool) {
  card.addEventListener('click', async e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target) return;

    // ── Return — single click, no prompt ──────────────────────────────
    if (target.tagName === 'BUTTON' && target.classList.contains('btn-return') &&
        !target.classList.contains('inline-confirm')) {
      e.stopPropagation();
      try { await apiReturn(tool.serialNumber); await fetchAndRenderAll(); }
      catch (err) { alert(err.message || 'Return failed'); }
      return;
    }

    // ── Checkout — show inline form, don't prompt ─────────────────────
    if (target.tagName === 'BUTTON' && target.classList.contains('btn-checkout') &&
        !target.classList.contains('inline-confirm')) {
      e.stopPropagation();
      const form = card.querySelector('.inline-checkout-form');
      if (!form) return;
      const isOpen = form.style.display !== 'none';
      setInlineCheckoutOpen(card, !isOpen);
      if (!isOpen) form.querySelector('.inline-op-input')?.focus();
      return;
    }

    // ── Inline confirm checkout ───────────────────────────────────────
    if (target.classList.contains('inline-confirm')) {
      e.stopPropagation();
      const form = card.querySelector('.inline-checkout-form');
      const opInput = form?.querySelector('.inline-op-input');
      const op = opInput?.value.trim().toLowerCase();
      if (!op) { opInput?.focus(); return; }
      sessionStorage.setItem('sd-last-op', op);
      try {
        await apiCheckout(tool.serialNumber, op);
        setInlineCheckoutOpen(card, false);
        await fetchAndRenderAll();
      } catch (err) { alert(err.message || 'Checkout failed'); }
      return;
    }

    if (target.matches('input.bulk-check')) return;

    // ── Toggle details ────────────────────────────────────────────────
    if (target.classList.contains('toggle-icon')) {
      const expanded = card.classList.toggle('expanded');
      const details  = card.querySelector('.tool-details--collapsed');
      if (details) details.style.display = expanded ? '' : 'none';
      target.textContent = expanded ? '▲' : '▼';
      target.setAttribute('aria-expanded', String(expanded));
    }
  });

  // Allow Enter to confirm inline checkout
  card.querySelector('.inline-op-input')?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    card.querySelector('.inline-confirm')?.click();
  });
}

function getClassificationIcon(classification) {
  try {
    if (typeof window !== 'undefined' && window.suiteIcons?.classification) {
      const html = window.suiteIcons.classification(classification, 14);
      if (html) return html;
    }
  } catch { /* noop */ }
  switch ((classification || '').toLowerCase()) {
    case 'manual':   return '🪛';
    case 'wired':    return '🔌';
    case 'wireless': return '🔋';
    default:         return '';
  }
}

export function updateDurations() {
  document.querySelectorAll('.tool-box').forEach(card => {
    const durEl = card.querySelector('.duration');
    if (!durEl) return;
    const ts = durEl.getAttribute('data-ts');
    if (!ts) return;

    const elapsedMs = Date.now() - Date.parse(ts);
    const hours = elapsedMs / 3600000;

    card.classList.remove('duration-2h', 'duration-5h', 'duration-8h');
    if (hours >= 8)      card.classList.add('duration-8h');
    else if (hours >= 5) card.classList.add('duration-5h');
    else if (hours >= 2) card.classList.add('duration-2h');

    const h = Math.floor(elapsedMs / 3600000);
    const m = Math.floor((elapsedMs % 3600000) / 60000);
    durEl.textContent = `${h}h ${m}m`;
  });
}

// ── Surgical patch for a single card (recommendation #12) ────────────────────
export function patchToolCard(updatedTool) {
  const id  = updatedTool?.serialNumber;
  if (!id) return false;
  const card = document.querySelector(`.tool-box[data-serial="${CSS.escape(id)}"]`);
  if (!card) return false;

  const opId   = (updatedTool.operatorId || '').toLowerCase();
  const shift  = state.employeeShift?.[opId] || 1;
  const opName = state.employeeMap?.[opId] || updatedTool.operatorName || 'Unknown';

  // Status badge
  const badge = card.querySelector('.status-badge');
  if (badge) {
    const isOut = updatedTool.status === 'being used';
    badge.className = `status-badge ${isOut ? 'checked-out' : 'available'}`;
    badge.textContent = isOut ? 'Checked Out' : 'Available';
  }

  // Card class
  card.classList.toggle('available',    updatedTool.status === 'in inventory');
  card.classList.toggle('checked-out',  updatedTool.status === 'being used');

  // Operator
  const opEl = card.querySelector('.operator');
  if (opEl) {
    if (updatedTool.status === 'being used') {
      opEl.className = `operator shift-${shift}`;
      opEl.title = `Operator: ${opName}`;
      opEl.textContent = opName;
    } else {
      opEl.className = 'operator';
      opEl.removeAttribute('title');
      opEl.textContent = '';
    }
  }

  // Duration
  const durEl = card.querySelector('.duration');
  if (durEl) {
    if (updatedTool.timestamp && updatedTool.status === 'being used') {
      durEl.setAttribute('data-ts', updatedTool.timestamp);
      durEl.textContent = formatDuration(updatedTool.timestamp);
    } else {
      durEl.removeAttribute('data-ts');
      durEl.textContent = '';
    }
  }

  // Action button
  const footerBtn = card.querySelector('.card-footer .btn-checkout, .card-footer .btn-return');
  if (footerBtn) {
    const isOut = updatedTool.status === 'being used';
    footerBtn.className = isOut ? 'btn-return' : 'btn-checkout';
    footerBtn.textContent = isOut ? 'Return' : 'Checkout';
    footerBtn.setAttribute('aria-label', `${isOut ? 'Return' : 'Checkout'} ${id}`);
  }

  // Close inline form if open
  const form = card.querySelector('.inline-checkout-form');
  if (form) setInlineCheckoutOpen(card, false);

  // Update state entry
  const idx = (state.allTools || []).findIndex(t => t.serialNumber === id);
  if (idx !== -1) state.allTools[idx] = { ...state.allTools[idx], ...updatedTool };

  return true;
}
