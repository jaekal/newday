/**
 * public/js/projects/projects.js  — DOMAIN-AWARE VERSION
 * ═══════════════════════════════════════════════════════
 * Extends the unified projects page to also serve the
 * Daily / Weekly Audits board.
 *
 * A top-level "domain" tab row switches between:
 *   • Projects  — domain='project'  (original behaviour)
 *   • Audits    — domain='audit'    (replaces audits/audits.html)
 *
 * When in Audit mode:
 *   - Board lanes are the same four buckets (todo/doing/blocked/done)
 *   - List view shows audit-specific columns (kind, shift, template flag)
 *   - Toolbar shows "Generate Today / This Week" + template management
 *   - Filters still work (search, bucket, quick-filter)
 *   - All drag-drop, detail panel, and Socket.IO wiring reuse the same code
 *   - Audit detail panel shows additional fields: kind, shiftMode, weekMode,
 *     checklist items, and notes
 *
 * API surface used:
 *   GET/POST/PUT/DELETE  /projects/api  (projects)
 *   GET                  /audits/api    (audit instances, ?kind=daily|weekly)
 *   GET                  /audits/api/templates
 *   POST                 /audits/api/template
 *   POST                 /audits/api/move
 *   PUT                  /audits/api/:id
 *   DELETE               /audits/api/:id
 *   POST                 /audits/instantiate/daily
 *   POST                 /audits/instantiate/weekly
 *
 * Drop this file in at:  public/js/projects/projects.js
 * It replaces the previous version completely.
 */

'use strict';

/* ══════════════════════════════════════════════
   1. CONSTANTS & HELPERS
══════════════════════════════════════════════ */

const PROJECTS_API = '/projects/api';
const AUDITS_API   = '/audits/api';

// Shift state for the generate modal (audit domain)
let _auditUserShift = null;       // shift from employee record
let _auditSelShift  = null;       // shift selected in the modal
let _genTemplates   = [];
let _genCheckedIds  = new Set();
let _projectTemplates = [];
let _projectCheckedIds = new Set();
let _ownerDirectory = [];
let _ownerDirectoryLoaded = false;
const TODAY_ISO    = new Date().toISOString().slice(0, 10);
const PAGE_DEFAULT = 30;
const URL_DOMAIN = (() => {
  try {
    const value = new URLSearchParams(window.location.search).get('domain');
    return value === 'audit' || value === 'project' ? value : '';
  } catch {
    return '';
  }
})();

const BUCKETS       = ['todo', 'doing', 'blocked', 'done'];
const BUCKET_LABELS = { todo:'To Do', doing:'In Progress', blocked:'Blocked', done:'Done' };
const ACTIVE_BUILDING = (typeof window.getBuilding === 'function' && window.getBuilding()) || localStorage.getItem('suite.building.v1') || 'Bldg-350';
const ASSIGNABLE_OWNER_ROLES = new Set(['lead', 'coordinator']);
const TOOL_VERIFY_TEMPLATE_IDS = new Set(['catalog:audit:screwdriver-and-drill-audit']);
const TORQUE_IMPORT_TEMPLATE_IDS = new Set(['catalog:audit:weekly-torque-calibration']);
const TOOL_VERIFY_CLASSIFICATIONS = ['manual', 'wired', 'wireless'];

const $ = (sel, r = document) => r.querySelector(sel);
const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

const formatBuildingLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'current building';
  return raw.startsWith('Bldg-') ? `Building ${raw.slice(5)}` : raw;
};

function isToolVerifyAudit(task = {}) {
  return Boolean(
    task?.meta?.moduleTool === 'tool-verify' ||
    TOOL_VERIFY_TEMPLATE_IDS.has(String(task?.meta?.templateInstance || '')) ||
    String(task?.title || '').toLowerCase().includes('screwdriver and drill audit')
  );
}

function isTorqueImportAudit(task = {}) {
  return Boolean(
    task?.meta?.moduleTool === 'torque-import' ||
    TORQUE_IMPORT_TEMPLATE_IDS.has(String(task?.meta?.templateInstance || '')) ||
    String(task?.title || '').toLowerCase().includes('torque calibration')
  );
}

function parseSerialInput(raw = '') {
  return [...new Set(
    String(raw)
      .split(/[\s,;]+/)
      .map((part) => String(part || '').trim().replace(/\u00A0/g, ' ').replace(/[\s-]+/g, '').toUpperCase())
      .filter(Boolean)
  )];
}

function getSelectedToolVerifyClasses() {
  return Array.from(document.querySelectorAll('#dp-tool-verify-classes .pj-qchip.active'))
    .map((btn) => btn.dataset.classification)
    .filter(Boolean);
}

function updateToolVerifyCompleteButton(verification) {
  const btn = $('#dp-tool-verify-complete');
  if (!btn) return;
  const bucket = String(_currentTask?.bucket || '');
  const canComplete = Boolean(
    verification?.allConfirmed &&
    !verification?.completedAt &&
    (bucket === 'doing' || bucket === 'blocked')
  );
  btn.disabled = !canComplete;
  btn.textContent = verification?.completedAt ? 'Audit Completed' : 'Complete Audit';
}

function renderToolVerifyResult(verification) {
  const wrap = $('#dp-tool-verify-result');
  if (!wrap) return;
  if (!verification) {
    wrap.innerHTML = '<div style="font-size:.85rem;color:var(--fg-muted)">Run verification to compare scanned serial numbers against the expected inventory list.</div>';
    updateToolVerifyCompleteButton(null);
    return;
  }
  const statusClass = verification.allConfirmed ? 'ok' : 'warn';
  const statusText = verification.allConfirmed
    ? 'All expected tools were confirmed and no unexpected serials were found.'
    : 'Verification found missing or unexpected serial numbers that need follow-up.';
  const listHtml = (title, items, formatter = (value) => esc(value)) => `
    <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem;background:var(--surface)">
      <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.45rem">${esc(title)} (${items.length})</div>
      ${items.length
        ? `<ul style="margin:0;padding-left:1rem;font-size:.84rem">${items.map((item) => `<li>${formatter(item)}</li>`).join('')}</ul>`
        : '<div style="font-size:.8rem;color:var(--fg-muted)">None</div>'}
    </div>
  `;
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.55rem;margin-bottom:.75rem">
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${verification.expectedCount}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Expected tools</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${verification.confirmedCount}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Confirmed</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${verification.missingCount}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Missing</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${verification.unexpectedCount}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Not in inventory</span></div>
    </div>
    <div class="tool-verify-status-${statusClass}" style="margin-bottom:.75rem;padding:.65rem .8rem;border-radius:var(--radius-sm);border:1px solid ${verification.allConfirmed ? 'var(--ok)' : 'var(--warn)'};background:${verification.allConfirmed ? 'var(--ok-bg)' : 'var(--warn-bg)'};color:${verification.allConfirmed ? 'var(--ok)' : 'var(--warn)'};font-size:.84rem;font-weight:600">${esc(statusText)}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem">
      ${listHtml('Missing', verification.missing || [])}
      ${listHtml('Not In Inventory', verification.unexpected || [])}
      ${listHtml('Confirmed', verification.confirmed || [])}
      ${listHtml('Duplicate Scans', verification.duplicateScans || [], (item) => `${esc(item.serialNumber)} (${item.count}x)`)}
    </div>
    <div style="margin-top:.75rem;font-size:.8rem;color:var(--fg-muted)">
      Checked for ${esc((verification.classifications || []).join(', ') || TOOL_VERIFY_CLASSIFICATIONS.join(', '))} in ${esc(verification.building || ACTIVE_BUILDING)}.
      ${verification.scannedAt ? ` Last run: ${esc(new Date(verification.scannedAt).toLocaleString())}.` : ''}
      ${verification.completedAt ? ` Audit completed: ${esc(new Date(verification.completedAt).toLocaleString())}.` : ''}
    </div>
  `;
  updateToolVerifyCompleteButton(verification);
}

function updateTorqueImportCompleteButton(torqueImport) {
  const btn = $('#dp-torque-complete');
  if (!btn) return;
  const bucket = String(_currentTask?.bucket || '');
  const canComplete = Boolean(
    torqueImport?.allInSpec &&
    !torqueImport?.completedAt &&
    (bucket === 'doing' || bucket === 'blocked')
  );
  btn.disabled = !canComplete;
  btn.textContent = torqueImport?.completedAt ? 'Audit Completed' : 'Complete Audit';
}

function renderTorqueImportResult(torqueImport) {
  const wrap = $('#dp-torque-result');
  if (!wrap) return;
  if (!torqueImport) {
    wrap.innerHTML = '<div style="font-size:.85rem;color:var(--fg-muted)">Import a DRTQ <code>.rtf</code> file to record the torque tester run for this audit.</div>';
    updateTorqueImportCompleteButton(null);
    return;
  }
  const summary = torqueImport.summary || {};
  const maxLimit = summary.maximumTorqueLimit || {};
  const minLimit = summary.minimumTorqueLimit || {};
  const statusTone = torqueImport.allInSpec ? 'var(--ok)' : 'var(--warn)';
  const statusBg = torqueImport.allInSpec ? 'var(--ok-bg)' : 'var(--warn-bg)';
  const statusText = torqueImport.allInSpec
    ? 'Imported run is within the configured torque limits.'
    : 'Imported run has readings outside the allowed range or a non-zero fail count.';
  const warnings = Array.isArray(torqueImport.warnings) ? torqueImport.warnings : [];
  const history = Array.isArray(_currentTask?.meta?.torqueImportHistory) ? _currentTask.meta.torqueImportHistory : [];
  const rows = (torqueImport.readings || []).slice(0, 25)
    .map((reading) => `<tr><td>${reading.index}</td><td>${reading.peak}</td></tr>`)
    .join('');
  const historyHtml = history.length
    ? `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem;background:var(--surface);margin-top:.75rem">
        <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.45rem">Import History</div>
        <div style="display:grid;gap:.45rem">
          ${history.map((entry, idx) => `
            <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:flex-start;padding:.45rem .55rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:${idx === 0 ? 'var(--surface-strong)' : 'var(--surface)'}">
              <div style="font-size:.82rem">
                <div><strong>${esc(entry.fileName || 'Imported export')}</strong></div>
                <div style="color:var(--fg-muted)">${esc(entry.summary?.date || '—')} ${esc(entry.summary?.time || '')} ${entry.summary?.job ? `· ${esc(entry.summary.job)}` : ''}</div>
              </div>
              <div style="font-size:.78rem;text-align:right;color:${entry.allInSpec ? 'var(--ok)' : 'var(--warn)'}">
                <div>${entry.allInSpec ? 'In Spec' : 'Needs Review'}</div>
                <div style="color:var(--fg-muted)">${entry.readingCount || 0} readings</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`
    : '';
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.55rem;margin-bottom:.75rem">
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${torqueImport.readingCount || 0}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Readings</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${minLimit.value ?? '—'}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Min limit ${esc(minLimit.unit || '')}</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${maxLimit.value ?? '—'}</strong><span style="font-size:.78rem;color:var(--fg-muted)">Max limit ${esc(maxLimit.unit || '')}</span></div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem;background:var(--surface)"><strong style="display:block;font-size:1.1rem">${summary.percentageNotOk ?? 0}%</strong><span style="font-size:.78rem;color:var(--fg-muted)">Not OK</span></div>
    </div>
    <div style="margin-bottom:.75rem;padding:.65rem .8rem;border-radius:var(--radius-sm);border:1px solid ${statusTone};background:${statusBg};color:${statusTone};font-size:.84rem;font-weight:600">${esc(statusText)}</div>
    ${warnings.length ? `<div style="margin-bottom:.75rem;padding:.65rem .8rem;border-radius:var(--radius-sm);border:1px solid var(--warn);background:var(--warn-bg);color:var(--warn);font-size:.82rem">${warnings.map((warning) => `<div>${esc(warning)}</div>`).join('')}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;margin-bottom:.75rem">
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem;background:var(--surface)">
        <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.45rem">Run Details</div>
        <div style="font-size:.84rem;display:grid;gap:.2rem">
          <div><strong>File:</strong> ${esc(torqueImport.fileName || 'Imported export')}</div>
          <div><strong>Job:</strong> ${esc(summary.job || '—')}</div>
          <div><strong>Date:</strong> ${esc(summary.date || '—')} ${esc(summary.time || '')}</div>
          <div><strong>Unit S/N:</strong> ${esc(summary.unitSerialNumber || '—')}</div>
          <div><strong>Direction:</strong> ${esc(summary.measurementDirection || '—')}</div>
          <div><strong>Transducer:</strong> ${esc(summary.transducer || '—')}</div>
        </div>
      </div>
      <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem;background:var(--surface)">
        <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.45rem">Statistics</div>
        <div style="font-size:.84rem;display:grid;gap:.2rem">
          <div><strong>Min recorded:</strong> ${esc(summary.minimumRecorded?.raw || '—')}</div>
          <div><strong>Max recorded:</strong> ${esc(summary.maximumRecorded?.raw || '—')}</div>
          <div><strong>Sigma:</strong> ${esc(summary.sigma ?? '—')}</div>
          <div><strong>Cp:</strong> ${esc(summary.cp ?? '—')}</div>
          <div><strong>Cpk:</strong> ${esc(summary.cpk ?? '—')}</div>
          <div><strong>Above max / below min:</strong> ${esc(summary.readingsAboveMaximum ?? 0)} / ${esc(summary.readingsBelowMinimum ?? 0)}</div>
        </div>
      </div>
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem;background:var(--surface)">
      <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.45rem">Imported Readings${torqueImport.readingCount > 25 ? ' (first 25 shown)' : ''}</div>
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:.82rem"><thead><tr><th style="text-align:left;padding:.3rem;border-bottom:1px solid var(--border)">#</th><th style="text-align:left;padding:.3rem;border-bottom:1px solid var(--border)">Peak</th></tr></thead><tbody>${rows}</tbody></table>` : '<div style="font-size:.8rem;color:var(--fg-muted)">No readings parsed.</div>'}
    </div>
    <div style="margin-top:.75rem;font-size:.8rem;color:var(--fg-muted)">
      Imported ${torqueImport.importedAt ? esc(new Date(torqueImport.importedAt).toLocaleString()) : ''}${torqueImport.importedBy ? ` by ${esc(torqueImport.importedBy)}` : ''}.
      ${torqueImport.completedAt ? ` Audit completed ${esc(new Date(torqueImport.completedAt).toLocaleString())}.` : ''}
    </div>
    ${historyHtml}
  `;
  updateTorqueImportCompleteButton(torqueImport);
}

function exportTorqueImportCsv(torqueImport) {
  if (!torqueImport) return;
  const summary = torqueImport.summary || {};
  const lines = [
    ['File', torqueImport.fileName || ''],
    ['Imported At', torqueImport.importedAt || ''],
    ['Imported By', torqueImport.importedBy || ''],
    ['Job', summary.job || ''],
    ['Date', summary.date || ''],
    ['Time', summary.time || ''],
    ['Unit Serial Number', summary.unitSerialNumber || ''],
    ['Transducer', summary.transducer || ''],
    ['Measurement Direction', summary.measurementDirection || ''],
    ['Minimum Torque Limit', summary.minimumTorqueLimit?.raw || ''],
    ['Maximum Torque Limit', summary.maximumTorqueLimit?.raw || ''],
    ['Threshold Torque Limit', summary.thresholdTorqueLimit?.raw || ''],
    ['Percentage Not OK', summary.percentageNotOk ?? ''],
    [],
    ['Reading #', 'Peak'],
    ...(torqueImport.readings || []).map((reading) => [reading.index, reading.peak]),
  ];
  const csv = lines
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(torqueImport.fileName || 'torque-import').replace(/\.rtf$/i, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

function syncToolVerifyModule(task) {
  const tab = $('#dp-toolverify-tab');
  const section = $('#tab-toolverify');
  if (!section || !tab) return;
  const enabled = task?.domain === 'audit' && isToolVerifyAudit(task);
  tab.style.display = enabled ? '' : 'none';
  section.style.display = enabled ? '' : 'none';
  if (!enabled) {
    if ($('#dp-tool-verify-scans')) $('#dp-tool-verify-scans').value = '';
    renderToolVerifyResult(null);
    if ($('#detailPanel')?.classList.contains('open')) switchDetailTab('overview');
    return;
  }
  const verification = task?.meta?.toolVerify || null;
  if ($('#dp-tool-verify-scans')) $('#dp-tool-verify-scans').value = '';
  document.querySelectorAll('#dp-tool-verify-classes .pj-qchip').forEach((btn) => {
    const activeClasses = verification?.classifications?.length ? verification.classifications : TOOL_VERIFY_CLASSIFICATIONS;
    btn.classList.toggle('active', activeClasses.includes(btn.dataset.classification));
  });
  renderToolVerifyResult(verification);
}

function syncTorqueImportModule(task) {
  const tab = $('#dp-torqueimport-tab');
  const section = $('#tab-torqueimport');
  if (!section || !tab) return;
  const enabled = task?.domain === 'audit' && isTorqueImportAudit(task);
  tab.style.display = enabled ? '' : 'none';
  section.style.display = enabled ? '' : 'none';
  if (!enabled) {
    if ($('#dp-torque-file')) $('#dp-torque-file').value = '';
    renderTorqueImportResult(null);
    if ($('#detailPanel')?.classList.contains('open')) switchDetailTab('overview');
    return;
  }
  renderTorqueImportResult(task?.meta?.torqueImport || null);
}

const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toISOString().slice(0, 10);
};

const parseDateOnlyLocal = iso => {
  const raw = String(iso || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const d = new Date(raw);
  return isNaN(+d) ? null : d;
};

const relativeDay = iso => {
  if (!iso) return null;
  const d = parseDateOnlyLocal(iso); if (!d) return { label:String(iso), cls:'due-ok' };
  d.setHours(0,0,0,0);
  const t = new Date(); t.setHours(0,0,0,0);
  const diff = Math.floor((d.getTime() - t.getTime()) / 86_400_000);
  if (diff < -1)  return { label:`Overdue ${Math.abs(diff)}d`, cls:'due-overdue' };
  if (diff === -1) return { label:'Overdue 1 day',  cls:'due-overdue' };
  if (diff === 0)  return { label:'Due today',       cls:'due-soon' };
  if (diff === 1)  return { label:'Due tomorrow',    cls:'due-soon' };
  if (diff <= 7)   return { label:`Due in ${diff}d`, cls:'due-soon' };
  return { label:fmtDate(iso), cls:'due-ok' };
};

function describeActivityEvent(ev = {}) {
  const actor = ev.actorLabel || ev.actorName || ev.actorId || 'System';
  const action = String(ev.action || '').toLowerCase();
  if (action === 'move') {
    const from = ev.fromBucketLabel || BUCKET_LABELS[ev.fromBucket] || ev.fromBucket || 'Unknown';
    const to = ev.toBucketLabel || BUCKET_LABELS[ev.toBucket] || ev.toBucket || 'Unknown';
    return { message: `${actor} moved this card to ${to}`, detail: `From ${from} to ${to}` };
  }
  if (action === 'reassign') {
    const from = ev.fromOwnerLabel || ev.fromOwnerName || ev.fromOwnerId || 'Unassigned';
    const to = ev.toOwnerLabel || ev.toOwnerName || ev.toOwnerId || 'Unassigned';
    return { message: `${actor} reassigned ownership`, detail: `From ${from} to ${to}` };
  }
  if (action === 'create') return { message: `${actor} created this card`, detail: '' };
  if (action === 'instantiate') return { message: `${actor} generated this task`, detail: '' };
  if (action === 'update') return { message: `${actor} updated this card`, detail: '' };
  return { message: ev.msg || `${actor} recorded activity`, detail: '' };
}

const initials = name =>
  String(name || '').trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase()||'').join('');

const avatarColors = ['#dbeafe:#1d4ed8','#dcfce7:#166534','#ede9fe:#5b21b6','#fef3c7:#92400e','#fce7f3:#9d174d'];
const avatarColor  = name => { const [bg,fg] = avatarColors[(name||'').charCodeAt(0)%avatarColors.length].split(':'); return {bg,fg}; };

function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a),ms); }; }

function normalizeShiftValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.toUpperCase() === 'WKND') return 'WKND';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatShiftLabel(value, { withPrefix = true } = {}) {
  const normalized = normalizeShiftValue(value);
  if (normalized == null) return '—';
  if (normalized === 'WKND') return 'WKND';
  return withPrefix ? `Shift ${normalized}` : String(normalized);
}

function currentOwnerOption() {
  const id = state.user?.id || state.user?.username || '';
  const name = state.user?.name || id;
  const role = String(state.user?.role || '').toLowerCase();
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : 'User';
  return id ? { id, name, role, label: `${name} (${id}) - ${roleLabel}` } : null;
}

function ensureOwnerDatalist() {
  if ($('#pjOwnerOptions')) return $('#pjOwnerOptions');
  const list = document.createElement('datalist');
  list.id = 'pjOwnerOptions';
  document.body.appendChild(list);
  return list;
}

function renderOwnerDatalist() {
  const list = ensureOwnerDatalist();
  list.innerHTML = _ownerDirectory.map((owner) => `<option value="${esc(owner.label)}"></option>`).join('');
}

function ownerMatchesValue(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!target) return null;
  return _ownerDirectory.find((owner) => (
    [owner.label, owner.name, owner.id, `${owner.name} (${owner.id})`]
      .filter(Boolean)
      .some((candidate) => String(candidate).trim().toLowerCase() === target)
  )) || null;
}

async function ensureOwnerDirectoryLoaded() {
  if (_ownerDirectoryLoaded) return _ownerDirectory;
  try {
    const owners = await apiFetch('/projects/api/owners');
    _ownerDirectory = Array.isArray(owners)
      ? owners.filter((owner) => owner?.id && ASSIGNABLE_OWNER_ROLES.has(String(owner.role || '').toLowerCase()))
      : [];
    renderOwnerDatalist();
  } catch {
    _ownerDirectory = [];
  } finally {
    _ownerDirectoryLoaded = true;
  }
  return _ownerDirectory;
}

function setOwnerInputValue(input, owner, { rememberOriginal = false } = {}) {
  if (!input) return;
  const label = owner?.label || owner?.name || owner?.id || '';
  input.value = label;
  input.dataset.ownerId = owner?.id || '';
  input.dataset.ownerName = owner?.name || '';
  input.dataset.ownerLabel = owner?.label || label;
  if (rememberOriginal) {
    input.dataset.originalOwnerId = input.dataset.ownerId;
    input.dataset.originalOwnerName = input.dataset.ownerName;
    input.dataset.originalOwnerLabel = input.dataset.ownerLabel;
  }
}

function wireOwnerInput(input, { defaultToCurrent = false } = {}) {
  if (!input) return;
  input.setAttribute('list', 'pjOwnerOptions');
  ensureOwnerDatalist();
  ensureOwnerDirectoryLoaded().catch(() => {});
  if (defaultToCurrent && !input.value.trim()) {
    const current = currentOwnerOption();
    if (current) setOwnerInputValue(input, current, { rememberOriginal: true });
  }
  const syncOwner = () => {
    const match = ownerMatchesValue(input.value);
    if (match) {
      setOwnerInputValue(input, match);
      return;
    }
    if (input.value.trim() === input.dataset.originalOwnerLabel) {
      input.dataset.ownerId = input.dataset.originalOwnerId || '';
      input.dataset.ownerName = input.dataset.originalOwnerName || '';
      input.dataset.ownerLabel = input.dataset.originalOwnerLabel || input.value.trim();
      return;
    }
    input.dataset.ownerId = '';
    input.dataset.ownerName = '';
    input.dataset.ownerLabel = input.value.trim();
  };
  if (input.dataset.ownerWired !== 'true') {
    input.addEventListener('input', syncOwner);
    input.addEventListener('change', syncOwner);
    input.dataset.ownerWired = 'true';
  }
}

function resolveOwnerFromInput(input, { required = false } = {}) {
  if (!input) return currentOwnerOption();
  const currentValue = input.value.trim();
  const matched = ownerMatchesValue(currentValue);
  if (matched) {
    setOwnerInputValue(input, matched);
    return matched;
  }
  if (currentValue && currentValue === input.dataset.originalOwnerLabel && input.dataset.originalOwnerId) {
    return {
      id: input.dataset.originalOwnerId,
      name: input.dataset.originalOwnerName || input.dataset.originalOwnerLabel || currentValue,
      label: input.dataset.originalOwnerLabel || currentValue,
    };
  }
  if (!currentValue) {
    const current = currentOwnerOption();
    if (current) {
      setOwnerInputValue(input, current);
      return current;
    }
  }
  if (required) throw new Error('Select an owner from the coordinator/lead list.');
  return null;
}

function confirmBuildingScope(actionLabel) {
  const assigned = state.user?.building || '';
  if (!assigned || assigned === ACTIVE_BUILDING) return true;
  return window.confirm(`You are assigned to ${assigned.replace('Bldg-','Building ')} but are about to ${actionLabel} in ${ACTIVE_BUILDING.replace('Bldg-','Building ')}. Continue?`);
}

function notify(msg, type = 'info') {
  if (window.Notyf) { const n = new window.Notyf({duration:3000,position:{x:'right',y:'bottom'}}); type==='error'?n.error(msg):n.success(msg); return; }
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:1rem;right:1rem;z-index:9999;padding:.65rem 1rem;border-radius:.5rem;color:var(--accent-contrast);font-size:.85rem;background:${type==='error'?'#dc2626':'#16a34a'};pointer-events:none`;
  el.textContent = msg; document.body.appendChild(el); setTimeout(()=>el.remove(),3200);
}

/* ══════════════════════════════════════════════
   2. STATE
══════════════════════════════════════════════ */

const state = {
  domain: URL_DOMAIN || localStorage.getItem('pj-domain') || 'project', // 'project' | 'audit'
  view:   localStorage.getItem('pj-view')   || 'board',

  items:[], total:0, totalPages:1,
  page:1, limit:PAGE_DEFAULT,
  sortField:'createdAt', sortDir:'desc',

  // Shared filters
  q:'', bucket:'', category:'', priority:'', source:'',
  auditKind: '',    // 'daily' | 'weekly' | ''
  qFilter: null,

  selected: new Set(),
  user: null,
  canManage: false,
  facets: { categories:{}, buckets:{} },
};

/* ══════════════════════════════════════════════
   3. API
══════════════════════════════════════════════ */

let _fetchCtrl = null;

// Read the session-bound CSRF token. middleware/csrf.js writes it to a
// non-HttpOnly XSRF-TOKEN cookie on every response, and EJS-rendered pages
// also expose it via <meta name="csrf-token">. Either source is valid.
function _csrfToken() {
  try {
    const meta = document.querySelector('meta[name="csrf-token"]')?.content;
    if (meta) return String(meta);
  } catch {}
  try {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  } catch { return ''; }
}

const _UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function apiFetch(url, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  // Merge caller-supplied headers with a CSRF header for unsafe methods.
  // Without this every write (move/create/update/delete) is rejected by
  // the global CSRF middleware and the server returns 403, which is what
  // produced the cluster of "POST /projects/api/move 403" errors.
  const headers = { ...(opts.headers || {}) };
  if (_UNSAFE_METHODS.has(method)) {
    const tok = _csrfToken();
    if (tok && !headers['X-CSRF-Token'] && !headers['x-csrf-token']) {
      headers['X-CSRF-Token'] = tok;
    }
  }
  const r = await fetch(url, { credentials:'include', ...opts, headers });
  if (!r.ok) { const e = await r.json().catch(()=>({})); throw Object.assign(new Error(e?.message||`${r.status}`),{status:r.status}); }
  return r.json();
}

async function apiList() {
  if (state.domain === 'audit') return apiListAudits();
  const usp = new URLSearchParams();
  usp.set('domain','project'); usp.set('includeFacets','1');
  usp.set('page',String(state.page)); usp.set('limit',String(state.limit));
  usp.set('building', ACTIVE_BUILDING);
  if (state.q)      usp.set('q',state.q);
  if (state.bucket) usp.set('bucket',state.bucket);
  if (state.category) usp.set('category',state.category);
  usp.set('sort',`${state.sortField}:${state.sortDir}`);
  if (_fetchCtrl) _fetchCtrl.abort();
  _fetchCtrl = new AbortController();
  const r = await fetch(`${PROJECTS_API}?${usp}`,{credentials:'include',signal:_fetchCtrl.signal});
  if (!r.ok) throw new Error(`List failed: ${r.status}`);
  return r.json();
}

async function apiListAudits() {
  const usp = new URLSearchParams();
  usp.set('building', ACTIVE_BUILDING);
  if (state.auditKind) usp.set('kind', state.auditKind);
  if (state.q)         usp.set('q', state.q);
  if (_fetchCtrl) _fetchCtrl.abort();
  _fetchCtrl = new AbortController();
  const r = await fetch(`${AUDITS_API}?${usp}`,{credentials:'include',signal:_fetchCtrl.signal});
  if (!r.ok) throw new Error(`Audit list failed: ${r.status}`);
  const items = await r.json();
  // audits API returns flat array, not paginated object
  return { items: Array.isArray(items)?items:[], total: Array.isArray(items)?items.length:0, totalPages:1, facets:{categories:{},buckets:{}} };
}

function apiForDomain() { return state.domain === 'audit' ? AUDITS_API : PROJECTS_API; }

async function apiCreate(payload) {
  if (!confirmBuildingScope('create a task')) throw new Error('Cancelled');
  return apiFetch(apiForDomain(), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload, building: ACTIVE_BUILDING})});
}
async function apiPut(id, patch)  {
  if (!confirmBuildingScope('update a task')) throw new Error('Cancelled');
  return apiFetch(`${apiForDomain()}/${encodeURIComponent(id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...patch, building: patch?.building || ACTIVE_BUILDING})});
}
async function apiMove(id, bucket){ return apiFetch(`${apiForDomain()}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,bucket})}); }
async function apiDelete(id)      { return apiFetch(`${apiForDomain()}/${encodeURIComponent(id)}`,{method:'DELETE'}); }
async function apiCreateTemplate(payload){
  if (!confirmBuildingScope('create an audit template')) throw new Error('Cancelled');
  return apiFetch('/audits/api/template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload, building: ACTIVE_BUILDING})});
}
async function apiProjectTemplates(){ return apiFetch('/projects/api/templates?catalogOnly=1'); }
async function apiCreateProjectTemplate(payload){
  if (!confirmBuildingScope('create a project template')) throw new Error('Cancelled');
  return apiFetch('/projects/api/template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload, building: ACTIVE_BUILDING})});
}
async function apiInstantiateProjects(payload){
  if (!confirmBuildingScope('generate project tasks')) throw new Error('Cancelled');
  return apiFetch('/projects/instantiate/selective',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload, building: ACTIVE_BUILDING})});
}

/* ══════════════════════════════════════════════
   4. LOAD + REFRESH
══════════════════════════════════════════════ */

let _loading = false;

async function refresh({ resetPage=false }={}) {
  if (_loading) return;
  _loading = true;
  if (resetPage) state.page = 1;
  showLoading(true);
  try {
    const data = await apiList();
    let items = data.items || [];
    state.total      = data.total || items.length;
    state.totalPages = data.totalPages || 1;
    state.facets     = data.facets || {categories:{},buckets:{}};
    items = clientFilter(items);
    state.items = items;
    updateCategoryDropdown();
    renderCurrentView();
    updateMetricsBar();
    updateBoardMeta();
    updateBulkBar();
  } catch(err) {
    if (err?.name==='AbortError') return;
    console.error(err); notify('Failed to load.','error');
  } finally {
    _loading = false;
    showLoading(false);
  }
}

function clientFilter(items) {
  const {priority,source,qFilter,user,bucket} = state;
  return items.filter(t => {
    if (priority) { if ((t.meta?.priority||t.priority||'').toLowerCase()!==priority) return false; }
    if (source)   { if ((t.source||'').toLowerCase()!==source) return false; }
    if (state.domain==='audit' && bucket) { if ((t.bucket||'todo')!==bucket) return false; }
    if (qFilter==='overdue') { if (!t.dueDate||t.dueDate>=TODAY_ISO||t.bucket==='done') return false; }
    if (qFilter==='myCards') {
      const me = (user?.name||user?.id||'').toLowerCase();
      if (!me) return true;
      const team  = (t.meta?.team||[]).map(x=>String(x).toLowerCase());
      const owner = (t.meta?.owner||'').toLowerCase();
      if (!team.includes(me)&&!owner.includes(me)) return false;
    }
    if (qFilter==='kiosk') { if ((t.source||'').toLowerCase()!=='kiosk') return false; }
    if (qFilter==='high')  { if ((t.meta?.priority||t.priority||'').toLowerCase()!=='high') return false; }
    if (qFilter==='torque') {
      if (!(state.domain === 'audit' && isTorqueImportAudit(t))) return false;
    }
    if (qFilter==='torqueNeedsReview') {
      if (!(state.domain === 'audit' && isTorqueImportAudit(t) && !t.meta?.torqueImport?.allInSpec)) return false;
    }
    return true;
  });
}

function syncPrimaryActions() {
  const isAudit = state.domain === 'audit';
  const btnNew = $('#btnNew');
  const emptyBtn = $('#emptyNewBtn');
  if (btnNew) btnNew.textContent = isAudit ? '+ New Audit' : '+ New Project';
  if (emptyBtn) emptyBtn.textContent = isAudit ? '+ New Audit' : '+ New Project';
}

function showLoading(on) {
  const loading = $('#loadingState'), board = $('#boardView'), list = $('#listView'), empty = $('#emptyState');
  if (on) { loading.style.display=''; board.style.display='none'; list.style.display='none'; empty.style.display='none'; }
  else {
    loading.style.display='none';
    syncPrimaryActions();
    if (state.items.length===0) {
      empty.style.display='flex';
      const hasF = state.q||state.bucket||state.category||state.priority||state.source||state.qFilter||state.auditKind;
      $('#emptyTitle').textContent = hasF
        ? (state.domain==='audit' ? 'No matching audits' : 'No matching projects')
        : (state.domain==='audit' ? 'No audits yet' : 'No projects yet');
      $('#emptyBody').textContent = hasF
        ? 'Try clearing some filters.'
        : (state.domain==='audit'
          ? 'Create a new audit template or generate audit tasks to get started.'
          : 'Create a new project to get started.');
    } else renderViewContainers();
  }
  const rc = $('#resultCount');
  if (rc) rc.textContent = on?'':`${state.items.length} result${state.items.length!==1?'s':''}`;
}

function renderViewContainers() {
  const isBoard = state.view==='board';
  $('#boardView').style.display  = isBoard?'':'none';
  $('#listView').style.display   = isBoard?'none':'';
  $('#emptyState').style.display = 'none';
}

function renderCurrentView() {
  if (state.view==='board') renderBoard(); else renderList();
}

/* ══════════════════════════════════════════════
   5. DOMAIN TAB
══════════════════════════════════════════════ */

function injectDomainTabs() {
  // Insert a domain-switch row above the filter bar
  const filterBar = $('#filterBar');
  if (!filterBar || $('#domainTabs')) return;

  const tabs = document.createElement('div');
  tabs.id = 'domainTabs';
  tabs.className = 'pj-domain-tabs';
  tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label','Domain');
  tabs.innerHTML = `
    <button class="pj-dtab-top${state.domain==='project'?' active':''}" data-domain="project" role="tab" aria-selected="${state.domain==='project'}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      Projects
    </button>
    <button class="pj-dtab-top${state.domain==='audit'?' active':''}" data-domain="audit" role="tab" aria-selected="${state.domain==='audit'}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      Audits
    </button>
  `;
  filterBar.parentNode.insertBefore(tabs, filterBar);

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-domain]');
    if (!btn) return;
    const domain = btn.dataset.domain;
    if (domain === state.domain) return;
    state.domain = domain;
    localStorage.setItem('pj-domain', domain);
    $$('.pj-dtab-top', tabs).forEach(b => {
      b.classList.toggle('active', b.dataset.domain===domain);
      b.setAttribute('aria-selected', String(b.dataset.domain===domain));
    });
    // Reset filters that don't carry across domains
    state.bucket=''; state.category=''; state.qFilter=null; state.auditKind='';
    $$('[data-qfilter]').forEach(c=>c.classList.remove('active'));
    $('#filterBucket').value=''; $('#filterCategory').value='';
    updateAuditToolbar();
    refresh({ resetPage:true });
  });
}

function updateAuditToolbar() {
  syncPrimaryActions();
  const auditBar = $('#auditToolbar');
  if (auditBar) auditBar.style.display = state.domain==='audit' ? '' : 'none';
  const projectBar = $('#projectToolbar');
  if (projectBar) projectBar.style.display = state.domain==='project' ? '' : 'none';
  const kindWrap = $('#auditKindWrap');
  if (kindWrap) kindWrap.style.display = state.domain==='audit' ? '' : 'none';
  const projectOnlyBtns = $$('[data-project-only]');
  projectOnlyBtns.forEach(el => { el.style.display = state.domain==='audit' ? 'none' : ''; });
}

function injectAuditToolbar() {
  if ($('#auditToolbar')) return;
  const bar = document.createElement('div');
  bar.id = 'auditToolbar';
  bar.className = 'pj-audit-toolbar';
  bar.style.display = state.domain==='audit' ? '' : 'none';
  const icClip = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>';
  const icDown = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  bar.innerHTML = `
    <button id="btnGenerate"    class="pj-btn-primary" type="button" style="display:inline-flex;align-items:center;gap:.35rem">${icClip} Generate Tasks</button>
    <button id="btnNewTemplate" class="pj-btn-ghost"   type="button" data-manage>+ New Template</button>
    <a      id="btnAuditPdfAll" class="pj-btn-ghost"   href="/audits/export/all.csv" download style="display:inline-flex;align-items:center;gap:.35rem">${icDown} Export CSV</a>
  `;
  const filterBar = $('#filterBar');
  filterBar.parentNode.insertBefore(bar, filterBar.nextSibling);

  bar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btnGenerate')    openGenerateModal();
    if (btn.id === 'btnNewTemplate') openTemplateModal();
  });

  function applyManageVis() {
    $$('[data-manage]', bar).forEach(el => { el.style.display = state.canManage ? '' : 'none'; });
  }
  applyManageVis();
  const origLoad = window._afterUserLoad;
  window._afterUserLoad = () => { origLoad?.(); applyManageVis(); };

  // Seed shift from employee record once
  _seedAuditShift();
}

function injectProjectToolbar() {
  if ($('#projectToolbar')) return;
  const bar = document.createElement('div');
  bar.id = 'projectToolbar';
  bar.className = 'pj-audit-toolbar';
  bar.style.display = state.domain==='project' ? '' : 'none';
  const icClip = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>';
  bar.innerHTML = `
    <button id="btnProjectGenerate" class="pj-btn-primary" type="button" style="display:inline-flex;align-items:center;gap:.35rem">${icClip} Generate Tasks</button>
    <button id="btnProjectTemplate" class="pj-btn-ghost" type="button" data-manage>+ New Template</button>
  `;
  const filterBar = $('#filterBar');
  filterBar.parentNode.insertBefore(bar, filterBar.nextSibling);

  bar.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'btnProjectGenerate') openProjectGenerateModal();
    if (btn.id === 'btnProjectTemplate') openProjectTemplateModal();
  });

  function applyManageVis() {
    $$('[data-manage]', bar).forEach(el => { el.style.display = state.canManage ? '' : 'none'; });
  }
  applyManageVis();
  const origLoad = window._afterUserLoad;
  window._afterUserLoad = () => { origLoad?.(); applyManageVis(); };
}
async function _seedAuditShift() {
  if (_auditUserShift !== null) return; // already seeded
  try {
    const j = await apiFetch('/auth/whoami');
    const techId = j.user?.techId || j.user?.id;
    if (techId) {
      const emps = await apiFetch('/employees');
      const list = Array.isArray(emps) ? emps : (emps.items || emps.employees || []);
      const emp = list.find(e => String(e.id || e.techId || '') === String(techId));
      if (emp?.shift) {
        _auditUserShift = normalizeShiftValue(emp.shift);
        _auditSelShift  = _auditUserShift;
      }
    }
  } catch {}
}

/* ── Generate Modal (shift-aware, checkbox-driven) ─────────────────────── */

function openGenerateModal() {
  _genCheckedIds = new Set();
  _auditSelShift = _auditUserShift || null;
  _ensureGenerateModal();
  _renderGenShiftPicker();
  _loadGenTemplates();
  $('#generateModal').classList.add('open');
  $('#generateModal').setAttribute('aria-hidden', 'false');
}

function closeGenerateModal() {
  $('#generateModal')?.classList.remove('open');
  $('#generateModal')?.setAttribute('aria-hidden', 'true');
}

function _ensureGenerateModal() {
  if ($('#generateModal')) return;
  const m = document.createElement('div');
  m.id = 'generateModal';
  m.className = 'pj-modal-backdrop';
  m.setAttribute('aria-hidden', 'true');
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-labelledby', 'genModalTitle');
  m.innerHTML = `<div class="pj-modal" style="max-height:88vh;display:flex;flex-direction:column">
    <h3 class="pj-modal-title" id="genModalTitle" style="display:flex;align-items:center;gap:.45rem"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/></svg> Generate Audit Tasks</h3>

    <div style="margin-bottom:.85rem">
      <div class="pj-dlabel" style="margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.05em">1. Select Shift</div>
      <div id="genShiftPicker" style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button class="gen-shift-btn" data-shift="1" type="button">Shift 1</button>
        <button class="gen-shift-btn" data-shift="2" type="button">Shift 2</button>
        <button class="gen-shift-btn" data-shift="3" type="button">Shift 3</button>
        <button class="gen-shift-btn" data-shift="WKND" type="button">WKND</button>
      </div>
      <div id="genShiftNote" style="font-size:.77rem;color:var(--fg-muted);margin-top:.35rem"></div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:.5rem 0"/>
    <div class="pj-dlabel" style="margin:.1rem 0 .45rem;text-transform:uppercase;letter-spacing:.05em">2. Choose Audits To Start</div>

    <div id="genTplListWrap" style="flex:1;overflow-y:auto;min-height:80px">
      <div style="font-size:.82rem;color:var(--fg-muted);text-align:center;padding:1.5rem">Loading templates…</div>
    </div>

    <div class="pj-modal-actions" style="justify-content:space-between;margin-top:.75rem">
      <span id="genSelectedCount" style="font-size:.82rem;color:var(--fg-muted)">Select a shift to begin</span>
      <div style="display:flex;gap:.5rem">
        <button id="genModalCancel" class="pj-btn-ghost"    type="button">Cancel</button>
        <button id="genModalSubmit" class="pj-btn-primary"  type="button">Start Selected Audits</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  $('#genModalTitle').textContent = 'Start Audit Tasks';
  const shiftPanel = $('#genShiftPicker')?.parentElement;
  if (shiftPanel && !$('#genIntro', m)) {
    const intro = document.createElement('div');
    intro.id = 'genIntro';
    intro.style.cssText = 'font-size:.84rem;color:var(--fg-muted);margin:.1rem 0 .9rem';
    intro.textContent = 'Choose the shift you are starting, then select the recurring audit tasks to place on the board for that shift.';
    m.querySelector('.pj-modal')?.insertBefore(intro, shiftPanel);
  }

  // Inject CSS for the generate modal elements (tag-pills, tpl-rows etc)
  if (!$('#genModalStyles')) {
    const style = document.createElement('style');
    style.id = 'genModalStyles';
    style.textContent = `
      .gen-shift-panel{padding:.8rem .9rem;border:1px solid var(--border);border-radius:.7rem;background:var(--surface)}
      .gen-shift-btn{padding:.3rem .75rem;border-radius:999px;border:1.5px solid var(--border);background:var(--surface-strong);color:var(--fg-muted);font-size:.82rem;font-weight:700;cursor:pointer;transition:all .12s}
      .gen-shift-btn.active{border-color:var(--accent);background:var(--accent);color:var(--accent-contrast)}
      .gen-tpl-group{margin-bottom:.85rem}
      .gen-tpl-group-hd{display:flex;align-items:center;justify-content:space-between;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--fg-muted);padding:.2rem 0;border-bottom:1px solid var(--border);margin-bottom:.3rem}
      .gen-check-all{font-size:.72rem;color:var(--accent);cursor:pointer;font-weight:600;text-transform:none;letter-spacing:0}
      .gen-tpl-row{display:flex;align-items:flex-start;gap:.6rem;padding:.55rem .5rem;border-radius:.55rem;cursor:pointer;transition:background .1s,border-color .1s;border:1px solid transparent}
      .gen-tpl-row:hover{background:var(--surface-strong)}
      .gen-tpl-row.is-disabled{opacity:.55;cursor:not-allowed;background:var(--surface)}
      .gen-tpl-row.is-disabled:hover{background:var(--surface)}
      .gen-tpl-row.is-selected{border-color:var(--accent);background:color-mix(in srgb, var(--accent) 10%, var(--surface-strong) 90%)}
      .gen-tpl-row input[type=checkbox]{width:1rem;height:1rem;margin-top:.15rem;flex-shrink:0;accent-color:var(--accent)}
      .gen-tpl-row label{cursor:pointer;flex:1}
      .gen-tpl-name{font-size:.87rem;font-weight:600}
      .gen-tpl-desc{font-size:.76rem;color:var(--fg-muted);margin-top:.08rem}
      .gen-tpl-hint{font-size:.72rem;color:var(--fg-muted);margin-top:.18rem}
    `;
    document.head.appendChild(style);
  }

  // Wire events
  m.addEventListener('click', e => { if (e.target === m) closeGenerateModal(); });
  $('#genModalCancel').addEventListener('click', closeGenerateModal);
  $('#genShiftPicker').addEventListener('click', e => {
    const btn = e.target.closest('.gen-shift-btn');
    if (!btn) return;
    const s = normalizeShiftValue(btn.dataset.shift);
    _auditSelShift = String(_auditSelShift) === String(s) ? null : s;
    _renderGenShiftPicker();
    _renderGenTemplates();
  });
  $('#genModalSubmit').addEventListener('click', _submitGenerate);
}

function _renderGenShiftPicker() {
  $$('.gen-shift-btn', $('#genShiftPicker')).forEach(btn => {
    btn.classList.toggle('active', String(normalizeShiftValue(btn.dataset.shift)) === String(_auditSelShift));
  });
  $('#genShiftNote').textContent = _auditSelShift
    ? `${formatShiftLabel(_auditSelShift)} selected. The audits you check below will be started for this shift and added to the board.`
    : 'Select your shift first. Audit checkboxes stay locked until a shift is chosen.';
}

async function _loadGenTemplates() {
  $('#genTplListWrap').innerHTML = '<div style="font-size:.82rem;color:var(--fg-muted);text-align:center;padding:1.5rem">Loading templates…</div>';
  try { _genTemplates = await apiFetch(AUDITS_API + '/templates'); } catch { _genTemplates = []; }
  _renderGenTemplates();
}

function _renderGenTemplates() {
  const wrap = $('#genTplListWrap');
  if (!_genTemplates.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--fg-muted);font-size:.87rem">No templates defined yet.<br>Use "+ New Template" to create some.</div>';
    _updateGenCount(); return;
  }
  const groups = { daily:[], weekly:[], monthly:[] };
  for (const t of _genTemplates) {
    const k = (t.kind||'daily').toLowerCase();
    if (groups[k]) groups[k].push(t); else groups.daily.push(t);
  }
  const kindLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly' };
  wrap.innerHTML = '';
  for (const [kind, items] of Object.entries(groups)) {
    if (!items.length) continue;
    const grp = document.createElement('div'); grp.className = 'gen-tpl-group';
    const hd  = document.createElement('div'); hd.className  = 'gen-tpl-group-hd';
    hd.innerHTML = `<span>${kindLabel[kind]}</span><span class="gen-check-all" data-kind="${kind}">Select all</span>`;
    grp.appendChild(hd);
    for (const tpl of items) {
      const noShift    = !_auditSelShift;
      const row = document.createElement('div'); row.className = 'gen-tpl-row';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.id=`gen-chk-${tpl.id}`; chk.value=tpl.id;
      chk.checked = _genCheckedIds.has(tpl.id); chk.disabled = noShift;
      row.classList.toggle('is-disabled', noShift);
      row.classList.toggle('is-selected', chk.checked);
      chk.addEventListener('change', () => {
        if(chk.checked) _genCheckedIds.add(tpl.id); else _genCheckedIds.delete(tpl.id);
        row.classList.toggle('is-selected', chk.checked);
        _updateGenCount();
      });
      const lbl = document.createElement('label'); lbl.htmlFor = chk.id;
      lbl.innerHTML = `<div class="gen-tpl-name">${esc(tpl.title)}</div>${tpl.meta?.moduleToolLabel?`<div class="gen-tpl-hint" style="color:var(--accent);font-weight:700">${esc(tpl.meta.moduleToolLabel)}</div>`:''}${tpl.description?`<div class="gen-tpl-desc">${esc(tpl.description)}</div>`:''}${noShift?'<div class="gen-tpl-hint">Choose a shift above to enable this audit.</div>':''}`;
      row.appendChild(chk); row.appendChild(lbl); grp.appendChild(row);
    }
    // select-all
    hd.querySelector('.gen-check-all').addEventListener('click', () => {
      if (!_auditSelShift) return;
      const kindItems = _genTemplates.filter(t => (t.kind||'daily') === kind);
      const eligible  = kindItems;
      const allOn     = eligible.every(t => _genCheckedIds.has(t.id));
      eligible.forEach(t => { if(allOn) _genCheckedIds.delete(t.id); else _genCheckedIds.add(t.id); });
      _renderGenTemplates();
    });
    wrap.appendChild(grp);
  }
  // restore check state after re-render
  $$('input[type=checkbox]', wrap).forEach(chk => { if(_genCheckedIds.has(chk.value)) chk.checked=true; });
  _updateGenCount();
}

function _updateGenCount() {
  const el = $('#genSelectedCount');
  if (!el) return;
  if (!_auditSelShift) {
    el.textContent = 'Select a shift to begin';
    return;
  }
  el.textContent = `${_genCheckedIds.size} audit${_genCheckedIds.size===1?'':'s'} ready to start for ${formatShiftLabel(_auditSelShift)}`;
}

async function _submitGenerate() {
  if (!_auditSelShift) { notify('Select your shift first.', 'warn'); return; }
  if (!_genCheckedIds.size) { notify('Select at least one template.', 'warn'); return; }
  if (!confirmBuildingScope('generate audit tasks')) return;
  const btn = $('#genModalSubmit'); btn.disabled=true; btn.textContent='Starting...';
  const selectedCount = _genCheckedIds.size;
  try {
    const result = await apiFetch('/audits/instantiate/selective', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ templateIds:[..._genCheckedIds], building: ACTIVE_BUILDING, ...(_auditSelShift?{shift:_auditSelShift}:{}) }),
    });
    closeGenerateModal();
    refresh();
    const createdCount = Number(result?.created || 0);
    const duplicateCount = Math.max(0, selectedCount - createdCount);
    const scopeLabel = `${formatShiftLabel(_auditSelShift)} in ${formatBuildingLabel(ACTIVE_BUILDING)}`;
    if (createdCount === 0) {
      notify(`No audits were created. All selected audits already exist for ${scopeLabel}.`, 'warn');
    } else if (duplicateCount > 0) {
      notify(`${createdCount} audit task(s) started for ${scopeLabel}. ${duplicateCount} already existed for that same building and shift.`, 'warn');
    } else {
      notify(`${createdCount} audit task(s) started for ${scopeLabel}.`);
    }
  } catch(err) { notify(err.message || 'Generate failed.', 'error'); }
  finally { btn.disabled=false; btn.textContent='Start Selected Audits'; }
}

function injectAuditKindFilter() {
  const mainFilters = $('.pj-filters__main');
  if (!mainFilters || $('#auditKindWrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'auditKindWrap';
  wrap.style.display = state.domain==='audit' ? '' : 'none';
  wrap.innerHTML = `
    <select id="auditKind" class="pj-select" aria-label="Audit kind">
      <option value="">All (daily + weekly)</option>
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
    </select>
  `;
  mainFilters.appendChild(wrap);
  wrap.querySelector('#auditKind').addEventListener('change', e => {
    state.auditKind = e.target.value;
    refresh({ resetPage:true });
  });
}

/* ══════════════════════════════════════════════
   6. FILTERS
══════════════════════════════════════════════ */

function initFilters() {
  const searchEl = $('#filterSearch'), bucketEl = $('#filterBucket'), catEl = $('#filterCategory'),
        priEl = $('#filterPriority'), srcEl = $('#filterSource');
  const onFilter = debounce(()=>{ state.page=1; refresh(); },250);
  searchEl.addEventListener('input',  e=>{ state.q=e.target.value.trim(); onFilter(); });
  bucketEl.addEventListener('change', e=>{ state.bucket=e.target.value; refresh({resetPage:true}); });
  catEl.addEventListener('change',    e=>{ state.category=e.target.value; refresh({resetPage:true}); });
  priEl.addEventListener('change',    e=>{ state.priority=e.target.value; refresh({resetPage:true}); });
  srcEl.addEventListener('change',    e=>{ state.source=e.target.value; refresh({resetPage:true}); });
  $$('[data-qfilter]').forEach(chip=>{
    chip.addEventListener('click',()=>{
      const qf = chip.dataset.qfilter;
      if (state.qFilter===qf){ state.qFilter=null; chip.classList.remove('active'); }
      else { $$('[data-qfilter]').forEach(c=>c.classList.remove('active')); state.qFilter=qf; chip.classList.add('active'); }
      state.page=1; refresh();
    });
  });
  $('#btnClearFilters').addEventListener('click', clearFilters);
  $('#emptyNewBtn').addEventListener('click', openPrimaryCreateAction);
}

function syncFilterUiFromState() {
  const searchEl = $('#filterSearch');
  if (searchEl && state.q) searchEl.value = state.q;
  const bucketEl = $('#filterBucket');
  if (bucketEl && state.bucket) bucketEl.value = state.bucket;
  if (state.qFilter) {
    $$('[data-qfilter]').forEach((c) => {
      c.classList.toggle('active', c.dataset.qfilter === state.qFilter);
    });
  }
}

function clearFilters() {
  state.q=''; state.bucket=''; state.category=''; state.priority=''; state.source=''; state.qFilter=null; state.auditKind='';
  $$('#filterSearch,#filterBucket,#filterCategory,#filterPriority,#filterSource').forEach(el=>{ el.value=''; });
  const ak = $('#auditKind'); if (ak) ak.value='';
  $$('[data-qfilter]').forEach(c=>c.classList.remove('active'));
  refresh({resetPage:true});
}

function updateCategoryDropdown() {
  if (state.domain==='audit') return; // audits don't use category facets
  const sel = $('#filterCategory'), current = sel.value;
  const cats = Object.keys(state.facets.categories||{}).sort();
  while (sel.options.length>1) sel.remove(1);
  cats.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
  sel.value = cats.includes(current)?current:'';
  state.category = sel.value;
}

/* ══════════════════════════════════════════════
   7. BOARD RENDERER (shared for both domains)
══════════════════════════════════════════════ */

const WIP_LIMITS = { todo:0, doing:5, blocked:0, done:0 };

function renderBoard() {
  renderViewContainers();
  const board = $('#kanbanBoard');
  const byBucket = {todo:[],doing:[],blocked:[],done:[]};
  for (const t of state.items) byBucket[t.bucket||'todo']?.push(t);
  const scrolls = {};
  $$('.pj-lane-body',board).forEach(lb=>{ const b=lb.closest('.pj-lane')?.dataset.bucket; if(b) scrolls[b]=lb.scrollTop; });
  board.innerHTML = '';
  for (const bucket of BUCKETS) board.appendChild(buildLane(bucket, byBucket[bucket]||[]));
  setupDragDrop();
  Object.entries(scrolls).forEach(([b,s])=>{ const lb=$(`[data-bucket="${b}"] .pj-lane-body`,board); if(lb) lb.scrollTop=s; });
}

function buildLane(bucket, tasks) {
  const limit = WIP_LIMITS[bucket]||0, count = tasks.length, atLimit = limit>0&&count>=limit;
  const lane = document.createElement('div');
  lane.className = `pj-lane${bucket==='blocked'?' pj-lane--blocked':''}${bucket==='done'?' pj-lane--done':''}`;
  lane.dataset.bucket = bucket;
  const hdr = document.createElement('div'); hdr.className='pj-lane-header';
  const nm  = document.createElement('div'); nm.className='pj-lane-name';
  if (bucket === 'blocked' && window.suiteIcons?.icons?.ban) {
    nm.style.display = 'flex';
    nm.style.alignItems = 'center';
    nm.style.gap = '.35rem';
    nm.innerHTML = `${window.suiteIcons.icons.ban(14)}<span>${BUCKET_LABELS[bucket]}</span>`;
  } else if (bucket === 'done' && window.suiteIcons?.icons?.check) {
    nm.style.display = 'flex';
    nm.style.alignItems = 'center';
    nm.style.gap = '.35rem';
    nm.innerHTML = `${window.suiteIcons.icons.check(14)}<span>${BUCKET_LABELS[bucket]}</span>`;
  } else {
    nm.textContent = BUCKET_LABELS[bucket];
  }
  const bdg = document.createElement('div'); bdg.className='pj-lane-badges';
  const cnt = document.createElement('span'); cnt.className='pj-lane-count'; cnt.textContent=count; bdg.appendChild(cnt);
  if (limit>0) {
    const wip=document.createElement('span');
    wip.className=`pj-wip-badge ${atLimit?'pj-wip-full':count>=limit*.8?'pj-wip-warn':'pj-wip-ok'}`;
    wip.title=`WIP limit: ${limit}`; wip.textContent=`${count}/${limit}`; bdg.appendChild(wip);
  }
  hdr.appendChild(nm); hdr.appendChild(bdg); lane.appendChild(hdr);
  const body=document.createElement('div'); body.className='pj-lane-body'; body.dataset.bucket=bucket;
  if (!tasks.length) {
    const emp=document.createElement('div'); emp.className='pj-lane-empty';
    emp.textContent=bucket==='done'?'Nothing completed yet':'Drop cards here'; body.appendChild(emp);
  } else { for (const t of tasks) body.appendChild(buildCard(t)); }
  lane.appendChild(body);
  return lane;
}

function buildCard(task) {
  const bucket   = task.bucket||'todo';
  const isAudit  = task.domain==='audit';
  const dueInfo  = task.dueDate?relativeDay(task.dueDate):null;
  const isOverdue= dueInfo?.cls==='due-overdue'&&bucket!=='done';
  const priority = (task.meta?.priority||task.priority||'').toLowerCase();
  const source   = (task.source||'').toLowerCase();
  const team     = Array.isArray(task.meta?.team)?task.meta.team:[];
  const owner    = task.ownerLabel||task.meta?.ownerLabel||task.meta?.owner||'';
  const items    = Array.isArray(task.meta?.items)?task.meta.items:[];
  const doneItems= items.filter(i=>i.done).length;
  const ageMs    = task.updatedAt?Date.now()-new Date(task.updatedAt).getTime():0;
  const ageDays  = Math.floor(ageMs/86_400_000);
  const ageCls   = ageDays>7?'age-stale':ageDays>3?'age-aging':'age-fresh';
  const blockReason = task.meta?.blockReason||'';

  let cls='pj-card';
  if (isOverdue) cls+=' pj-card--overdue';
  else if (dueInfo?.cls==='due-soon') cls+=' pj-card--due-soon';
  if (bucket==='blocked') { cls+=' pj-card--blocked'; if(ageDays>4) cls+=' pj-card--blocked-stale'; }
  if (state.selected.has(task.id)) cls+=' selected';

  const card=document.createElement('div');
  card.className=cls; card.dataset.id=task.id;
  // Only managers can move cards; leaving draggable=true for read-only roles
  // generated 403s on every accidental drop.
  card.draggable = !!state.canManage;
  card.tabIndex=0;
  card.setAttribute('role','button');
  card.setAttribute('aria-label',`${task.title||'Untitled'}, ${BUCKET_LABELS[bucket]}`);

  // Top: checkbox + title + badges
  const top=document.createElement('div'); top.className='pj-card-top';
  const cb=document.createElement('input'); cb.type='checkbox'; cb.className='pj-card-checkbox'; cb.checked=state.selected.has(task.id);
  cb.addEventListener('change',e=>{ e.stopPropagation(); if(e.target.checked) state.selected.add(task.id); else state.selected.delete(task.id); updateBulkBar(); card.classList.toggle('selected',e.target.checked); });
  const titleEl=document.createElement('div'); titleEl.className='pj-card-title'; titleEl.textContent=task.title||'(untitled)';
  top.appendChild(cb); top.appendChild(titleEl);

  // Audit kind badge
  if (isAudit && task.kind) {
    const kb=document.createElement('span'); kb.className='pj-kind-badge'; kb.dataset.kind=task.kind;
    kb.textContent=task.kind==='daily'?'Daily':'Weekly'; top.appendChild(kb);
  }
  if (isAudit && isToolVerifyAudit(task)) {
    const tb=document.createElement('span'); tb.className='pj-kind-badge'; tb.style.background='color-mix(in srgb, var(--accent) 12%, var(--surface))'; tb.style.color='var(--accent)'; tb.style.borderColor='var(--accent)';
    tb.textContent='Tool Verify'; top.appendChild(tb);
  }
  if (isAudit && isTorqueImportAudit(task)) {
    const tb=document.createElement('span'); tb.className='pj-kind-badge'; tb.style.background='color-mix(in srgb, var(--warn) 12%, var(--surface))'; tb.style.color='var(--warn)'; tb.style.borderColor='var(--warn)';
    tb.textContent='Torque Import'; top.appendChild(tb);
    if (task.meta?.torqueImport?.allInSpec) {
      const sb=document.createElement('span'); sb.className='pj-kind-badge'; sb.style.background='color-mix(in srgb, var(--ok) 12%, var(--surface))'; sb.style.color='var(--ok)'; sb.style.borderColor='var(--ok)';
      sb.textContent='In Spec'; top.appendChild(sb);
    }
  }
  if (priority && priority!=='none') {
    const pb=document.createElement('span'); pb.className=`pj-priority-badge pri-${priority}`;
    pb.textContent=priority.charAt(0).toUpperCase()+priority.slice(1); top.appendChild(pb);
  }
  card.appendChild(top);

  // Meta chips
  const meta=document.createElement('div'); meta.className='pj-card-meta';
  if (!isAudit && source && source!=='manual') {
    const sc=document.createElement('span'); sc.className=`pj-source-chip src-${source}`;
    const srcHtml = typeof window !== 'undefined' && window.suiteIcons?.projectSourceHtml?.(source);
    if (srcHtml) sc.innerHTML = srcHtml;
    else sc.textContent = source === 'kiosk' ? 'Kiosk' : source === 'expiration' ? 'Calibration' : source;
    meta.appendChild(sc);
  }
  if (!isAudit) { const cat=task.category||task.meta?.category; if(cat){ const cc=document.createElement('span'); cc.className='pj-category-chip'; cc.textContent=cat; meta.appendChild(cc); } }
  if (isAudit && task.shift) { const sh=document.createElement('span'); sh.className='pj-source-chip'; sh.textContent=`Shift ${task.shift}`; meta.appendChild(sh); }
  if (meta.children.length) card.appendChild(meta);

  // Due
  if (dueInfo) { const de=document.createElement('div'); de.className=`pj-card-due ${dueInfo.cls}`; de.textContent=dueInfo.label; card.appendChild(de); }

  // Block reason
  if (bucket==='blocked'&&blockReason) {
    const br=document.createElement('div'); br.className='pj-block-reason';
    if (window.suiteIcons?.icons?.ban) {
      const ic=document.createElement('span'); ic.setAttribute('aria-hidden','true'); ic.innerHTML=window.suiteIcons.icons.ban(14);
      const tx=document.createElement('span'); tx.textContent=blockReason;
      br.append(ic, tx);
    } else br.textContent=blockReason;
    card.appendChild(br);
  }

  // Footer
  const footer=document.createElement('div'); footer.className='pj-card-footer';
  const allNames=[owner,...team].filter(Boolean).slice(0,3);
  if (allNames.length) {
    const avRow=document.createElement('div'); avRow.className='pj-card-avatars';
    allNames.forEach(n=>{ const av=document.createElement('div'); av.className='pj-avatar'; const {bg,fg}=avatarColor(n); av.style.background=bg; av.style.color=fg; av.textContent=initials(n); av.title=n; avRow.appendChild(av); });
    footer.appendChild(avRow);
  } else footer.appendChild(document.createElement('span'));
  if (items.length>0) {
    const pw=document.createElement('div'); pw.className='pj-progress-wrap'; const pct=Math.round(doneItems/items.length*100);
    pw.innerHTML=`<div class="pj-progress-track"><div class="pj-progress-fill" style="width:${pct}%"></div></div><div class="pj-progress-label">${doneItems}/${items.length}</div>`;
    footer.appendChild(pw);
  }
  const dot=document.createElement('div'); dot.className=`pj-age-dot ${ageCls}`; dot.title=`${ageDays}d in lane`; footer.appendChild(dot);
  card.appendChild(footer);

  card.addEventListener('click', e=>{ if(e.target===cb)return; openDetailPanel(task); });
  card.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openDetailPanel(task); } });
  if (state.canManage) {
    card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain',task.id); e.dataTransfer.effectAllowed='move'; requestAnimationFrame(()=>card.classList.add('dragging')); });
    card.addEventListener('dragend', ()=>card.classList.remove('dragging'));
  }
  return card;
}

function setupDragDrop() {
  // Read-only roles don't get drop zones wired; prevents accidental drops
  // from firing a /move request that the server will 403.
  if (!state.canManage) return;
  $$('.pj-lane-body').forEach(body=>{
    const targetBucket=body.dataset.bucket||body.closest('[data-bucket]')?.dataset.bucket;
    body.addEventListener('dragenter',e=>{e.preventDefault();body.closest('.pj-lane')?.classList.add('drag-over');});
    body.addEventListener('dragover', e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
    body.addEventListener('dragleave',e=>{ if(!body.contains(e.relatedTarget)) body.closest('.pj-lane')?.classList.remove('drag-over'); });
    body.addEventListener('drop',async e=>{
      e.preventDefault(); body.closest('.pj-lane')?.classList.remove('drag-over');
      const id=e.dataTransfer.getData('text/plain'); if(!id||!targetBucket) return;
      const task=state.items.find(t=>t.id===id); if(!task||task.bucket===targetBucket) return;
      const limit=WIP_LIMITS[targetBucket];
      if (limit>0&&state.items.filter(t=>t.bucket===targetBucket).length>=limit) { notify(`"${BUCKET_LABELS[targetBucket]}" is at WIP limit (${limit}).`,'error'); return; }
      if (targetBucket==='blocked') {
        const reason=await promptBlockReason();
        task.bucket=targetBucket; if(reason) task.meta={...(task.meta||{}),blockReason:reason,blockedAt:new Date().toISOString()};
        renderBoard();
        try { await apiMove(id,targetBucket); if(reason) await apiPut(id,{meta:task.meta}); } catch { notify('Move failed.','error'); refresh(); }
        return;
      }
      task.bucket=targetBucket;
      if (task.meta?.blockReason&&targetBucket!=='blocked') task.meta={...task.meta,blockReason:'',blockedAt:null};
      renderBoard();
      try { await apiMove(id,targetBucket); } catch { notify('Move failed.','error'); refresh(); }
    });
  });
}

/* ══════════════════════════════════════════════
   8. LIST RENDERER  (domain-aware columns)
══════════════════════════════════════════════ */

function renderList() {
  renderViewContainers();
  if (state.domain==='audit') { renderListAudit(); return; }
  const tbody=$('#listBody'); tbody.innerHTML='';
  const items=[...state.items].sort((a,b)=>{
    const dir=state.sortDir==='asc'?1:-1;
    return String(a[state.sortField]??'').localeCompare(String(b[state.sortField]??''))*dir;
  });
  for (const task of items) tbody.appendChild(buildListRow(task));
  renderPager();
}

function buildListRow(task) {
  const tr=document.createElement('tr'); tr.dataset.id=task.id; if(state.selected.has(task.id)) tr.classList.add('selected');
  const dueInfo=task.dueDate?relativeDay(task.dueDate):null;
  const priority=(task.meta?.priority||task.priority||'').toLowerCase();
  const owner=task.ownerLabel||task.meta?.ownerLabel||task.meta?.owner||''; const team=Array.isArray(task.meta?.team)?task.meta.team:[];
  const allNames=[owner,...team].filter(Boolean); const source=(task.source||'').toLowerCase();
  const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=state.selected.has(task.id);
  cb.addEventListener('change',e=>{ if(e.target.checked){state.selected.add(task.id);tr.classList.add('selected');}else{state.selected.delete(task.id);tr.classList.remove('selected');} updateBulkBar(); });
  const tdCheck=document.createElement('td'); tdCheck.appendChild(cb);
  const tdTitle=document.createElement('td'); tdTitle.style.maxWidth='260px';
  tdTitle.innerHTML=`<span style="font-weight:600">${esc(task.title||'(untitled)')}</span>`;
  if(task.description){const s=document.createElement('div');s.style.cssText='font-size:.75rem;color:var(--fg-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px';s.textContent=task.description;tdTitle.appendChild(s);}
  const tdBucket=document.createElement('td'); tdBucket.innerHTML=`<span class="pj-bucket-pill bkt-${esc(task.bucket||'todo')}">${esc(BUCKET_LABELS[task.bucket||'todo'])}</span>`;
  const tdCat=document.createElement('td'); tdCat.textContent=task.category||task.meta?.category||'—';
  const tdPri=document.createElement('td');
  if(priority&&priority!=='none') tdPri.innerHTML=`<span class="pj-priority-badge pri-${esc(priority)}">${esc(priority.charAt(0).toUpperCase()+priority.slice(1))}</span>`;
  else tdPri.textContent='—';
  const tdDue=document.createElement('td');
  if(dueInfo) tdDue.innerHTML=`<span class="${dueInfo.cls}">${esc(dueInfo.label)}</span>`; else tdDue.textContent='—';
  const tdAssignee=document.createElement('td');
  if(allNames.length){ const r=document.createElement('div');r.style.cssText='display:flex;gap:2px;align-items:center';allNames.slice(0,2).forEach(n=>{const av=document.createElement('div');av.className='pj-avatar';const{bg,fg}=avatarColor(n);av.style.cssText=`background:${bg};color:${fg};margin-left:0`;av.textContent=initials(n);av.title=n;r.appendChild(av);});if(allNames.length>2){const m=document.createElement('span');m.style.cssText='font-size:.7rem;color:var(--fg-muted);margin-left:2px';m.textContent=`+${allNames.length-2}`;r.appendChild(m);}tdAssignee.appendChild(r);}else tdAssignee.textContent='—';
  const tdSource=document.createElement('td');
  if (source && source !== 'manual') {
    const chipHtml = window.suiteIcons?.projectSourceHtml?.(source);
    tdSource.innerHTML = chipHtml
      ? `<span class="pj-source-chip src-${esc(source)}">${chipHtml}</span>`
      : `<span class="pj-source-chip src-${esc(source)}">${esc(source)}</span>`;
  } else tdSource.textContent = source || '—';
  const tdOpened=document.createElement('td'); tdOpened.style.whiteSpace='nowrap'; tdOpened.textContent=fmtDate(task.createdAt);
  [tdCheck,tdTitle,tdBucket,tdCat,tdPri,tdDue,tdAssignee,tdSource,tdOpened].forEach(td=>tr.appendChild(td));
  tr.addEventListener('click',e=>{ if(e.target.type==='checkbox') return; openDetailPanel(task); });
  return tr;
}

function renderListAudit() {
  // Audit-specific list with different columns
  const listView=$('#listView');
  listView.innerHTML = `
    <table class="pj-table" role="grid" aria-label="Audits list" style="width:100%">
      <thead>
        <tr>
          <th class="pj-th-check"><input type="checkbox" id="selectAll"/></th>
          <th>Title</th>
          <th>Kind</th>
          <th>Lane</th>
          <th>Shift / Mode</th>
          <th>Due Date</th>
          <th>Opened</th>
        </tr>
      </thead>
      <tbody id="listBody"></tbody>
    </table>
    <div class="pj-pager" id="pager"></div>`;
  $('#selectAll')?.addEventListener('change',e=>{
    if(e.target.checked) state.items.forEach(t=>state.selected.add(t.id)); else state.selected.clear();
    renderListAudit(); updateBulkBar();
  });
  const tbody=$('#listBody');
  for (const task of state.items) {
    const tr=document.createElement('tr'); tr.dataset.id=task.id; if(state.selected.has(task.id)) tr.classList.add('selected');
    const dueInfo=task.dueDate?relativeDay(task.dueDate):null;
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=state.selected.has(task.id);
    cb.addEventListener('change',e=>{ if(e.target.checked){state.selected.add(task.id);tr.classList.add('selected');}else{state.selected.delete(task.id);tr.classList.remove('selected');}updateBulkBar();});
    const tdCb=document.createElement('td');tdCb.appendChild(cb);
    const tdTitle=document.createElement('td');tdTitle.innerHTML=`<span style="font-weight:600">${esc(task.title||'(untitled)')}</span>${isToolVerifyAudit(task)?'<div style="margin-top:.2rem"><span class="pj-kind-badge" style="background:color-mix(in srgb, var(--accent) 12%, var(--surface));color:var(--accent);border-color:var(--accent)">Tool Verify</span></div>':''}${isTorqueImportAudit(task)?`<div style="margin-top:.2rem"><span class="pj-kind-badge" style="background:color-mix(in srgb, var(--warn) 12%, var(--surface));color:var(--warn);border-color:var(--warn)">Torque Import</span>${task.meta?.torqueImport?.allInSpec?'<span class="pj-kind-badge" style="margin-left:.35rem;background:color-mix(in srgb, var(--ok) 12%, var(--surface));color:var(--ok);border-color:var(--ok)">In Spec</span>':''}</div>`:''}`;
    const tdKind=document.createElement('td');tdKind.innerHTML=`<span class="pj-kind-badge" data-kind="${esc(task.kind||'')}">${esc(task.kind||'—')}</span>`;
    const tdBucket=document.createElement('td');tdBucket.innerHTML=`<span class="pj-bucket-pill bkt-${esc(task.bucket||'todo')}">${esc(BUCKET_LABELS[task.bucket||'todo'])}</span>`;
    const tdMode=document.createElement('td');tdMode.textContent=(task.shiftMode||task.weekMode||(task.shift!=null?formatShiftLabel(task.shift):'—'));
    const tdDue=document.createElement('td');if(dueInfo)tdDue.innerHTML=`<span class="${dueInfo.cls}">${esc(dueInfo.label)}</span>`;else tdDue.textContent='—';
    const tdOp=document.createElement('td');tdOp.style.whiteSpace='nowrap';tdOp.textContent=fmtDate(task.createdAt);
    [tdCb,tdTitle,tdKind,tdBucket,tdMode,tdDue,tdOp].forEach(td=>tr.appendChild(td));
    tr.addEventListener('click',e=>{if(e.target.type==='checkbox')return;openDetailPanel(task);});
    tbody.appendChild(tr);
  }
}

/* ══════════════════════════════════════════════
   9. PAGER
══════════════════════════════════════════════ */

function renderPager() {
  const pager=$('#pager'); if(!pager)return; pager.innerHTML='';
  const {page,totalPages,total,limit}=state;
  if(totalPages<=1&&state.items.length===0)return;
  const prev=document.createElement('button');prev.className='pj-pager-btn';prev.textContent='← Prev';prev.disabled=page<=1;prev.addEventListener('click',()=>{state.page--;refresh();});pager.appendChild(prev);
  const lo=Math.max(1,page-2),hi=Math.min(totalPages,page+2);
  for(let p=lo;p<=hi;p++){const btn=document.createElement('button');btn.className=`pj-pager-btn${p===page?' current':''}`;btn.textContent=p;const pg=p;btn.addEventListener('click',()=>{state.page=pg;refresh();});pager.appendChild(btn);}
  const next=document.createElement('button');next.className='pj-pager-btn';next.textContent='Next →';next.disabled=page>=totalPages;next.addEventListener('click',()=>{state.page++;refresh();});pager.appendChild(next);
  const info=document.createElement('span');info.className='pj-pager-info';info.textContent=`Page ${page} / ${totalPages} · ${total} items`;pager.appendChild(info);
}

/* ══════════════════════════════════════════════
   10. METRICS BAR
══════════════════════════════════════════════ */

function updateMetricsBar() {
  const overdue=state.items.filter(t=>t.dueDate&&t.dueDate<TODAY_ISO&&t.bucket!=='done').length;
  const blocked=state.items.filter(t=>t.bucket==='blocked').length;
  const torqueAudits = state.domain === 'audit' ? state.items.filter((t) => isTorqueImportAudit(t)).length : 0;
  const torqueNeedsReview = state.domain === 'audit'
    ? state.items.filter((t) => isTorqueImportAudit(t) && !t.meta?.torqueImport?.allInSpec).length
    : 0;
  $('#m-total').textContent=state.total; $('#m-overdue').textContent=overdue; $('#m-blocked').textContent=blocked;
  $('#m-torque').textContent=torqueAudits; $('#m-torque-review').textContent=torqueNeedsReview;
  $('#met-overdue').style.display=overdue>0?'':'none'; $('#met-blocked').style.display=blocked>0?'':'none';
  $('#met-torque').style.display=state.domain==='audit'&&torqueAudits>0?'':'none';
  $('#met-torque-review').style.display=state.domain==='audit'&&torqueNeedsReview>0?'':'none';
}

function updateBoardMeta() {
  const el=$('#boardMeta'); if(!el)return;
  const parts=[];
  if(state.domain==='audit') parts.push(state.auditKind||'All audits');
  if(state.q) parts.push(`"${state.q}"`);
  if(state.bucket) parts.push(BUCKET_LABELS[state.bucket]);
  if(state.qFilter) parts.push({overdue:'Overdue',myCards:'My Cards',kiosk:'Kiosk',high:'High priority',torque:'Torque Audits',torqueNeedsReview:'Torque Review'}[state.qFilter]||state.qFilter);
  el.textContent=parts.length?`Filtered: ${parts.join(' · ')}`:state.domain==='audit'?`${state.total} audit${state.total!==1?'s':''}`: `${state.total} project${state.total!==1?'s':''}`;
}

/* ══════════════════════════════════════════════
   11. DETAIL PANEL  (domain-aware)
══════════════════════════════════════════════ */

let _currentTask=null;

function openDetailPanel(task) {
  _currentTask=task;
  const srcMap={kiosk:'Kiosk ticket',expiration:'Calibration queue',system:'System',manual:'Manual'};
  $('#dp-source-badge').textContent=task.domain==='audit'?`${task.kind||'audit'} audit`:(srcMap[task.source]||task.source||'');
  $('#dp-title').textContent=task.title||'(untitled)';
  $('#dp-title-input').value=task.title||'';
  $('#dp-bucket').value=task.bucket||'todo';
  $('#dp-priority').value=task.meta?.priority||task.priority||'';
  $('#dp-due').value=task.dueDate?task.dueDate.slice(0,10):'';
  $('#dp-category').value=task.category||task.meta?.category||'';
  $('#dp-desc').value=task.description||task.meta?.description||'';
  setOwnerInputValue($('#dp-owner'), {
    id: task.ownerId || task.meta?.ownerId || '',
    name: task.ownerName || task.meta?.ownerName || task.ownerLabel || task.meta?.ownerLabel || task.meta?.owner || '',
    label: task.ownerLabel || task.meta?.ownerLabel || task.meta?.owner || '',
  }, { rememberOriginal: true });
  wireOwnerInput($('#dp-owner'));
  $('#dp-dept').value=task.meta?.department||'';
  $('#dp-team').value=Array.isArray(task.meta?.team)?task.meta.team.join(', '):(task.meta?.team||'');
  $('#dp-blockreason').value=task.meta?.blockReason||'';
  $('#dp-blockreason-wrap').style.display=task.bucket==='blocked'?'':'none';

  // Audit-specific fields panel
  const auditFields=$('#dp-audit-fields');
  if (auditFields) {
    auditFields.style.display=task.domain==='audit'?'':'none';
    if(task.domain==='audit'){
      const df=$('#dp-audit-kind'); if(df) df.textContent=task.kind||'—';
      const sm=$('#dp-audit-shiftmode'); if(sm) sm.textContent=task.shiftMode||task.weekMode||'—';
      const sn=$('#dp-audit-shift'); if(sn) sn.textContent=task.shift!=null?formatShiftLabel(task.shift):'—';
    }
  }
  const toolVerifyWrap = $('#dp-tool-verify-link');
  if (toolVerifyWrap) toolVerifyWrap.style.display = 'none';
  syncToolVerifyModule(task);
  syncTorqueImportModule(task);

  // 6S chips
  const sixS=task.meta?.sixS||[];
  $$('#dp-sixs-chips .pj-chip-toggle input').forEach(cb=>{cb.checked=sixS.includes(cb.value);});

  // Activity tab
  const actLog=task.meta?.activity||[]; const logEl=$('#dp-activity-log'); logEl.innerHTML='';
  if(!actLog.length){const e=document.createElement('div');e.className='pj-activity-empty';e.textContent='No activity recorded yet.';logEl.appendChild(e);}
  else{
    [...actLog].reverse().forEach(ev=>{
      const desc = describeActivityEvent(ev);
      const row=document.createElement('div');
      row.className='pj-activity-item';
      row.innerHTML=`<div class="pj-activity-dot"></div><div class="pj-activity-content"><div class="pj-activity-msg">${esc(desc.message)}</div>${desc.detail?`<div class="pj-activity-detail">${esc(desc.detail)}</div>`:''}<div class="pj-activity-time">${ev.at?new Date(ev.at).toLocaleString():''}</div></div>`;
      logEl.appendChild(row);
    });
  }

  switchDetailTab('overview');
  $('#detailPanel').classList.add('open'); $('#detailPanel').setAttribute('aria-hidden','false');
  $('#panelOverlay').classList.add('open'); $('#panelOverlay').setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>$('#dp-title-input').focus());
}

function closeDetailPanel() {
  if ($('#dp-tool-verify-scans')) $('#dp-tool-verify-scans').value = '';
  if ($('#dp-torque-file')) $('#dp-torque-file').value = '';
  $('#detailPanel').classList.remove('open'); $('#detailPanel').setAttribute('aria-hidden','true');
  $('#panelOverlay').classList.remove('open'); $('#panelOverlay').setAttribute('aria-hidden','true');
  _currentTask=null;
}

function switchDetailTab(tabName) {
  $$('.pj-dtab').forEach(btn=>{const on=btn.dataset.tab===tabName;btn.classList.toggle('active',on);btn.setAttribute('aria-selected',String(on));});
  $$('.pj-dtab-panel').forEach(panel=>{panel.style.display=panel.id===`tab-${tabName}`?'':'none';panel.classList.toggle('active',panel.id===`tab-${tabName}`);});
}

async function saveDetailPanel() {
  if(!_currentTask) return;
  const title=$('#dp-title-input').value.trim();
  if(!title){notify('Title is required.','error');return;}
  const sixSChecked=$$('#dp-sixs-chips .pj-chip-toggle input:checked').map(cb=>cb.value);
  const team=$('#dp-team').value.split(',').map(s=>s.trim()).filter(Boolean);
  const newBucket=$('#dp-bucket').value;
  const blockReason=newBucket==='blocked'?$('#dp-blockreason').value.trim():'';
  let owner;
  try {
    owner = resolveOwnerFromInput($('#dp-owner'), { required: true });
  } catch (err) {
    notify(err.message || 'Owner is required.','error');
    return;
  }
  const patch={
    title,description:$('#dp-desc').value.trim(),bucket:newBucket,dueDate:$('#dp-due').value||'',
    category:$('#dp-category').value.trim(),
    ownerId: owner?.id || '',
    ownerName: owner?.name || '',
    ownerLabel: owner?.label || '',
    meta:{...(_currentTask.meta||{}),priority:$('#dp-priority').value,owner:owner?.label || '',
      department:$('#dp-dept').value.trim(),team,sixS:sixSChecked,blockReason,
      blockedAt:newBucket==='blocked'?(_currentTask.meta?.blockedAt||new Date().toISOString()):null,
    },
  };
  $('#dp-save').textContent='Saving…'; $('#dp-save').disabled=true;
  try{ await apiPut(_currentTask.id,patch); notify('Saved.'); closeDetailPanel(); await refresh(); }
  catch(err){ notify(err.message||'Save failed.','error'); }
  finally{ $('#dp-save').textContent='Save Changes'; $('#dp-save').disabled=false; }
}

function initDetailPanel() {
  $('#dp-close').addEventListener('click',closeDetailPanel);
  $('#dp-cancel').addEventListener('click',closeDetailPanel);
  $('#panelOverlay').addEventListener('click',closeDetailPanel);
  $('#dp-save').addEventListener('click',saveDetailPanel);
  $('#dp-delete').addEventListener('click',async()=>{
    if(!_currentTask||!confirm(`Delete "${_currentTask.title}"?`)) return;
    try{await apiDelete(_currentTask.id);notify('Deleted.');closeDetailPanel();await refresh();}
    catch(err){notify(err.message||'Delete failed.','error');}
  });
  $$('.pj-dtab').forEach(btn=>btn.addEventListener('click',()=>switchDetailTab(btn.dataset.tab)));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&$('#detailPanel').classList.contains('open')) closeDetailPanel(); });
  $('#dp-bucket').addEventListener('change',e=>{ $('#dp-blockreason-wrap').style.display=e.target.value==='blocked'?'':'none'; });

  // Inject audit-specific read-only fields into overview tab
  const overviewGrid=$('#tab-overview .pj-detail-grid');
  if (overviewGrid && !$('#dp-audit-fields')) {
    const af=document.createElement('div'); af.id='dp-audit-fields'; af.className='span-2'; af.style.display='none';
    af.innerHTML=`<div class="pj-detail-grid">
      <div class="pj-dfield"><label class="pj-dlabel">Kind</label><div id="dp-audit-kind" class="pj-dinput" style="background:var(--surface-strong)">—</div></div>
      <div class="pj-dfield"><label class="pj-dlabel">Shift / Mode</label><div id="dp-audit-shiftmode" class="pj-dinput" style="background:var(--surface-strong)">—</div></div>
      <div class="pj-dfield"><label class="pj-dlabel">Shift #</label><div id="dp-audit-shift" class="pj-dinput" style="background:var(--surface-strong)">—</div></div>
    </div>`;
    overviewGrid.insertBefore(af, overviewGrid.querySelector('#dp-blockreason-wrap') || overviewGrid.lastChild);
    const priRow=$('#dp-priority')?.closest('.pj-dfield'); if(priRow) priRow.id='dp-priority-row';
  }

  $('#dp-tool-verify-classes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pj-qchip');
    if (!btn) return;
    btn.classList.toggle('active');
    if (!getSelectedToolVerifyClasses().length) btn.classList.add('active');
  });

  $('#dp-tool-verify-clear')?.addEventListener('click', () => {
    const scans = $('#dp-tool-verify-scans');
    if (scans) scans.value = '';
  });

  $('#dp-tool-verify-run')?.addEventListener('click', async () => {
    if (!_currentTask) return;
    const serialNumbers = parseSerialInput($('#dp-tool-verify-scans')?.value || '');
    const classifications = getSelectedToolVerifyClasses();
    if (!classifications.length) {
      notify('Select at least one tool classification.', 'error');
      return;
    }
    const btn = $('#dp-tool-verify-run');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    try {
      const result = await apiFetch(`/audits/api/${encodeURIComponent(_currentTask.id)}/tool-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumbers, classifications }),
      });
      _currentTask = result.task || _currentTask;
      if (result?.verification?.scannedSerials && $('#dp-tool-verify-scans')) {
        $('#dp-tool-verify-scans').value = '';
      }
      if ((_currentTask.bucket || 'todo') !== 'done') {
        const movePatch = {
          bucket: 'doing',
          meta: {
            ...(_currentTask.meta || {}),
            ...(String(_currentTask.bucket || '') === 'blocked'
              ? { blockReason: '', blockedAt: null }
              : {}),
          },
        };
        const moved = await apiPut(_currentTask.id, movePatch);
        if (moved?.task) _currentTask = moved.task;
        else _currentTask = { ..._currentTask, bucket: 'doing', meta: movePatch.meta };
        $('#dp-bucket').value = 'doing';
        $('#dp-blockreason-wrap').style.display = 'none';
      }
      renderToolVerifyResult(result.verification);
      await refresh();
      notify('Tool verification complete.');
    } catch (err) {
      notify(err.message || 'Tool verification failed.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify Scan';
    }
  });

  $('#dp-tool-verify-complete')?.addEventListener('click', async () => {
    if (!_currentTask) return;
    const verification = _currentTask.meta?.toolVerify;
    if (!verification?.allConfirmed) {
      notify('Run a successful verification before completing this audit.', 'error');
      return;
    }
    const btn = $('#dp-tool-verify-complete');
    btn.disabled = true;
    btn.textContent = 'Completing...';
    try {
      const updatedVerification = {
        ...verification,
        completedAt: new Date().toISOString(),
        completedBy: state.user?.name || state.user?.username || state.user?.id || '',
      };
      const result = await apiFetch(`/audits/api/${encodeURIComponent(_currentTask.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket: 'done',
          meta: {
            ...(_currentTask.meta || {}),
            toolVerify: updatedVerification,
          },
        }),
      });
      _currentTask = result.task || _currentTask;
      notify('Audit marked complete.');
      closeDetailPanel();
      await refresh();
    } catch (err) {
      notify(err.message || 'Could not complete audit.', 'error');
      updateToolVerifyCompleteButton(verification);
    }
  });

  $('#dp-torque-clear')?.addEventListener('click', () => {
    const input = $('#dp-torque-file');
    if (input) input.value = '';
  });

  $('#dp-torque-export')?.addEventListener('click', () => {
    const torqueImport = _currentTask?.meta?.torqueImport;
    if (!torqueImport) {
      notify('Import a torque file first.', 'error');
      return;
    }
    exportTorqueImportCsv(torqueImport);
  });

  $('#dp-torque-run')?.addEventListener('click', async () => {
    if (!_currentTask) return;
    const input = $('#dp-torque-file');
    const file = input?.files?.[0];
    if (!file) {
      notify('Choose a DRTQ .rtf file to import.', 'error');
      return;
    }
    const btn = $('#dp-torque-run');
    btn.disabled = true;
    btn.textContent = 'Importing...';
    try {
      const content = await file.text();
      const result = await apiFetch(`/audits/api/${encodeURIComponent(_currentTask.id)}/torque-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, content }),
      });
      _currentTask = result.task || _currentTask;
      if ((_currentTask.bucket || 'todo') !== 'done') {
        const movePatch = {
          bucket: 'doing',
          meta: {
            ...(_currentTask.meta || {}),
            ...(String(_currentTask.bucket || '') === 'blocked'
              ? { blockReason: '', blockedAt: null }
              : {}),
          },
        };
        const moved = await apiPut(_currentTask.id, movePatch);
        if (moved?.task) _currentTask = moved.task;
        else _currentTask = { ..._currentTask, bucket: 'doing', meta: movePatch.meta };
        $('#dp-bucket').value = 'doing';
        $('#dp-blockreason-wrap').style.display = 'none';
      }
      if (input) input.value = '';
      renderTorqueImportResult(result.torqueImport);
      await refresh();
      notify('Torque file imported.');
    } catch (err) {
      notify(err.message || 'Torque import failed.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Import Torque File';
    }
  });

  $('#dp-torque-complete')?.addEventListener('click', async () => {
    if (!_currentTask) return;
    const torqueImport = _currentTask.meta?.torqueImport;
    if (!torqueImport?.allInSpec) {
      notify('Only in-spec torque imports can complete this audit.', 'error');
      return;
    }
    const btn = $('#dp-torque-complete');
    btn.disabled = true;
    btn.textContent = 'Completing...';
    try {
      const updatedTorqueImport = {
        ...torqueImport,
        completedAt: new Date().toISOString(),
        completedBy: state.user?.name || state.user?.username || state.user?.id || '',
      };
      const result = await apiFetch(`/audits/api/${encodeURIComponent(_currentTask.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket: 'done',
          meta: {
            ...(_currentTask.meta || {}),
            torqueImport: updatedTorqueImport,
          },
        }),
      });
      _currentTask = result.task || _currentTask;
      notify('Torque audit marked complete.');
      closeDetailPanel();
      await refresh();
    } catch (err) {
      notify(err.message || 'Could not complete torque audit.', 'error');
      updateTorqueImportCompleteButton(torqueImport);
    }
  });
}

/* ══════════════════════════════════════════════
   12. TEMPLATE MODAL  (Audits only)
══════════════════════════════════════════════ */

function openProjectGenerateModal() {
  _projectCheckedIds = new Set();
  _ensureProjectGenerateModal();
  _seedProjectTimeframe();
  _loadProjectTemplates();
  $('#projectGenerateModal').classList.add('open');
  $('#projectGenerateModal').setAttribute('aria-hidden', 'false');
}

function closeProjectGenerateModal() {
  $('#projectGenerateModal')?.classList.remove('open');
  $('#projectGenerateModal')?.setAttribute('aria-hidden', 'true');
}

function _ensureProjectGenerateModal() {
  if ($('#projectGenerateModal')) return;
  const m = document.createElement('div');
  m.id = 'projectGenerateModal';
  m.className = 'pj-modal-backdrop';
  m.setAttribute('aria-hidden', 'true');
  m.setAttribute('role', 'dialog');
  m.innerHTML = `<div class="pj-modal" style="max-height:88vh;display:flex;flex-direction:column">
    <h3 class="pj-modal-title">Generate Project Tasks</h3>
    <div style="font-size:.85rem;color:var(--fg-muted);margin-bottom:.75rem">
      Select larger-scope project templates and define the timeframe for this run.
    </div>
    <div class="pj-detail-grid" style="margin-bottom:.85rem">
      <div class="pj-dfield"><label class="pj-dlabel">Start Date</label><input id="pg-start" class="pj-dinput" type="date"/></div>
      <div class="pj-dfield"><label class="pj-dlabel">Target Date</label><input id="pg-target" class="pj-dinput" type="date"/></div>
      <div class="pj-dfield span-2">
        <label class="pj-dlabel">Quick Timeframe</label>
        <div id="pgQuickRange" style="display:flex;gap:.45rem;flex-wrap:wrap">
          <button class="pj-btn-ghost" type="button" data-range="daily">Daily</button>
          <button class="pj-btn-ghost" type="button" data-range="weekly">Weekly</button>
          <button class="pj-btn-ghost" type="button" data-range="quarterly">Quarterly</button>
        </div>
      </div>
    </div>
    <div id="pgTplListWrap" style="flex:1;overflow-y:auto;min-height:120px"><div style="font-size:.82rem;color:var(--fg-muted);text-align:center;padding:1.5rem">Loading templates...</div></div>
    <div class="pj-modal-actions" style="justify-content:space-between;margin-top:.75rem">
      <span id="pgSelectedCount" style="font-size:.82rem;color:var(--fg-muted)">0 selected</span>
      <div style="display:flex;gap:.5rem">
        <button id="pgCancel" class="pj-btn-ghost" type="button">Cancel</button>
        <button id="pgSubmit" class="pj-btn-primary" type="button">Generate Selected</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) closeProjectGenerateModal(); });
  $('#pgCancel').addEventListener('click', closeProjectGenerateModal);
  $('#pgSubmit').addEventListener('click', _submitProjectGenerate);
  $('#pgQuickRange').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    _applyProjectTimeframePreset(btn.dataset.range);
  });
}

function _seedProjectTimeframe() {
  const today = new Date();
  const start = $('#pg-start');
  const target = $('#pg-target');
  if (start && !start.value) start.value = today.toISOString().slice(0, 10);
  if (target && !target.value) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    target.value = nextWeek.toISOString().slice(0, 10);
  }
}

function _applyProjectTimeframePreset(range) {
  const start = $('#pg-start');
  const target = $('#pg-target');
  if (!start || !target) return;
  const base = start.value ? new Date(`${start.value}T12:00:00`) : new Date();
  if (Number.isNaN(+base)) return;
  const next = new Date(base);
  if (range === 'daily') next.setDate(next.getDate() + 1);
  if (range === 'weekly') next.setDate(next.getDate() + 7);
  if (range === 'quarterly') next.setMonth(next.getMonth() + 3);
  if (!start.value) start.value = new Date().toISOString().slice(0, 10);
  target.value = next.toISOString().slice(0, 10);
}

async function _loadProjectTemplates() {
  $('#pgTplListWrap').innerHTML = '<div style="font-size:.82rem;color:var(--fg-muted);text-align:center;padding:1.5rem">Loading templates...</div>';
  try { _projectTemplates = await apiProjectTemplates(); } catch { _projectTemplates = []; }
  _renderProjectTemplates();
}

function _renderProjectTemplates() {
  const wrap = $('#pgTplListWrap');
  if (!_projectTemplates.length) {
    wrap.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--fg-muted);font-size:.87rem">No project templates defined yet.<br>Use "+ New Template" to create some.</div>';
    _updateProjectGenCount();
    return;
  }
  wrap.innerHTML = '';
  const grouped = { daily: [], weekly: [], biweekly: [], monthly: [], 'on-demand': [], uncategorized: [] };
  for (const tpl of _projectTemplates) {
    const key = String(tpl.meta?.repeatCadence || '').toLowerCase();
    if (grouped[key]) grouped[key].push(tpl);
    else grouped.uncategorized.push(tpl);
  }
  const labels = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', 'on-demand': 'On Demand', uncategorized: 'Other' };
  for (const key of ['daily','weekly','biweekly','monthly','on-demand','uncategorized']) {
    const items = grouped[key];
    if (!items.length) continue;
    const section = document.createElement('div');
    section.style.marginBottom = '.85rem';
    section.innerHTML = `<div style="font-size:.78rem;font-weight:700;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.05em;margin:0 0 .45rem">${labels[key]}</div>`;
    for (const tpl of items) {
      const row = document.createElement('div');
      row.className = 'gen-tpl-row';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.id=`pg-chk-${tpl.id}`; chk.value=tpl.id;
      chk.checked = _projectCheckedIds.has(tpl.id);
      chk.addEventListener('change',()=>{ if(chk.checked) _projectCheckedIds.add(tpl.id); else _projectCheckedIds.delete(tpl.id); _updateProjectGenCount(); });
      const lbl = document.createElement('label'); lbl.htmlFor = chk.id;
      const tags = [
        tpl.meta?.area ? `<span class="gen-tag gen-tag-shift">${esc(tpl.meta.area)}</span>` : '',
      ].filter(Boolean);
      lbl.innerHTML = `<div class="gen-tpl-name">${esc(tpl.title)}</div>${tpl.meta?.objective?`<div class="gen-tpl-desc">${esc(tpl.meta.objective)}</div>`:''}<div class="gen-tpl-tags">${tags.join('')}</div>`;
      row.appendChild(chk);
      row.appendChild(lbl);
      section.appendChild(row);
    }
    wrap.appendChild(section);
  }
  _updateProjectGenCount();
}

function _updateProjectGenCount() {
  const el = $('#pgSelectedCount');
  if (el) el.textContent = `${_projectCheckedIds.size} selected`;
}

async function _submitProjectGenerate() {
  if (!_projectCheckedIds.size) { notify('Select at least one template.','error'); return; }
  const startDate = ($('#pg-start')?.value || '').trim();
  const targetDate = ($('#pg-target')?.value || '').trim();
  if (!startDate || !targetDate) { notify('Choose a start date and target date.','error'); return; }
  const btn = $('#pgSubmit');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  const selectedCount = _projectCheckedIds.size;
  try {
    const result = await apiInstantiateProjects({
      templateIds: [..._projectCheckedIds],
      startDate,
      targetDate,
    });
    closeProjectGenerateModal();
    await refresh({ resetPage:true });
    const createdCount = Number(result?.created || 0);
    const duplicateCount = Math.max(0, selectedCount - createdCount);
    const scopeLabel = `${formatBuildingLabel(ACTIVE_BUILDING)} from ${startDate} to ${targetDate}`;
    if (createdCount === 0) {
      notify(`No project tasks were created. All selected tasks already exist for ${scopeLabel}.`, 'warn');
    } else if (duplicateCount > 0) {
      notify(`${createdCount} project task(s) generated for ${scopeLabel}. ${duplicateCount} already existed for that same building and timeframe.`, 'warn');
    } else {
      notify(`${createdCount} project task(s) generated for ${scopeLabel}.`);
    }
  } catch (err) {
    notify(err.message || 'Generation failed.','error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Selected';
  }
}

function openProjectTemplateModal() {
  if ($('#projectTemplateModal')) { $('#projectTemplateModal').classList.add('open'); return; }
  const modal = document.createElement('div');
  modal.id='projectTemplateModal'; modal.className='pj-modal-backdrop'; modal.setAttribute('aria-hidden','false'); modal.setAttribute('role','dialog');
  modal.innerHTML=`<div class="pj-modal">
    <h3 class="pj-modal-title">New Project Template</h3>
    <div class="pj-detail-grid" style="margin-top:.75rem">
      <div class="pj-dfield span-2"><label class="pj-dlabel">Template Title *</label><input id="pt-title" class="pj-dinput" type="text" placeholder="e.g. Prepare monthly 6S purchase order"/></div>
      <div class="pj-dfield span-2"><label class="pj-dlabel">Default Scope / Objective</label><textarea id="pt-objective" class="pj-dinput pj-dinput-ta" rows="3"></textarea></div>
      <div class="pj-dfield"><label class="pj-dlabel">Area / Line / Building</label><input id="pt-area" class="pj-dinput" type="text"/></div>
      <div class="pj-dfield"><label class="pj-dlabel">Repeat Cadence</label><select id="pt-repeat" class="pj-dinput"><option value="">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="on-demand">On Demand</option></select></div>
      <div class="pj-dfield span-2"><label class="pj-dlabel">Notes</label><textarea id="pt-notes" class="pj-dinput pj-dinput-ta" rows="2"></textarea></div>
    </div>
    <div class="pj-modal-actions" style="margin-top:.85rem">
      <button id="pt-cancel" class="pj-btn-ghost" type="button">Cancel</button>
      <button id="pt-save" class="pj-btn-primary" type="button">Create Template</button>
    </div>
    <div id="pt-err" style="color:var(--danger);font-size:.82rem;margin-top:.35rem;display:none"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.classList.add('open');
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
  $('#pt-cancel').addEventListener('click',()=>modal.classList.remove('open'));
  $('#pt-save').addEventListener('click',async()=>{
    const title=$('#pt-title').value.trim();
    if(!title){$('#pt-err').textContent='Title required.';$('#pt-err').style.display='';return;}
    try {
      await apiCreateProjectTemplate({
        title,
        ownerId: state.user?.name || state.user?.id || '',
        ownerName: state.user?.name || state.user?.id || '',
        ownerLabel: state.user?.name || state.user?.id || '',
        meta: {
          objective: ($('#pt-objective').value || '').trim(),
          area: ($('#pt-area').value || '').trim(),
          notes: ($('#pt-notes').value || '').trim(),
          repeatCadence: ($('#pt-repeat').value || '').trim(),
        },
      });
      notify('Project template created.');
      modal.classList.remove('open');
      if($('#projectGenerateModal')?.classList.contains('open')) _loadProjectTemplates();
    } catch (err) {
      $('#pt-err').textContent = err.message || 'Failed.';
      $('#pt-err').style.display = '';
    }
  });
}
function openTemplateModal() {
  if ($('#templateModal')) { $('#templateModal').classList.add('open'); return; }
  const modal = document.createElement('div');
  modal.id='templateModal'; modal.className='pj-modal-backdrop'; modal.setAttribute('aria-hidden','false'); modal.setAttribute('role','dialog');
  modal.innerHTML=`<div class="pj-modal">
    <h3 class="pj-modal-title">New Audit Template</h3>
    <div class="pj-detail-grid" style="margin-top:.75rem">
      <div class="pj-dfield span-2"><label class="pj-dlabel">Title *</label><input id="tpl-title" class="pj-dinput" type="text" placeholder="e.g. ESD Cart Inspection"/></div>
      <div class="pj-dfield span-2"><label class="pj-dlabel">Description</label><textarea id="tpl-desc" class="pj-dinput pj-dinput-ta" rows="2"></textarea></div>
      <div class="pj-dfield"><label class="pj-dlabel">Kind</label><select id="tpl-kind" class="pj-dinput"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
      <div class="pj-dfield" id="tpl-shiftmode-wrap"><label class="pj-dlabel">Shift mode</label><select id="tpl-shiftmode" class="pj-dinput"><option value="once">Once per day</option><option value="per-shift">Per shift</option></select></div>
      <div class="pj-dfield" id="tpl-weekmode-wrap" style="display:none"><label class="pj-dlabel">Frequency</label><select id="tpl-weekmode" class="pj-dinput"><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option></select></div>
    </div>
    <div class="pj-modal-actions" style="margin-top:.85rem">
      <button id="tpl-cancel" class="pj-btn-ghost" type="button">Cancel</button>
      <button id="tpl-save"   class="pj-btn-primary" type="button">Create Template</button>
    </div>
    <div id="tpl-err" style="color:var(--danger);font-size:.82rem;margin-top:.35rem;display:none"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.classList.add('open');
  modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
  $('#tpl-cancel').addEventListener('click',()=>modal.classList.remove('open'));
  $('#tpl-kind').addEventListener('change',e=>{
    $('#tpl-shiftmode-wrap').style.display=e.target.value==='daily'?'':'none';
    $('#tpl-weekmode-wrap').style.display=e.target.value==='weekly'?'':'none';
  });
  $('#tpl-save').addEventListener('click',async()=>{
    const title=$('#tpl-title').value.trim(); if(!title){$('#tpl-err').textContent='Title required.';$('#tpl-err').style.display='';return;}
    const kind=$('#tpl-kind').value;
    const payload={title,description:$('#tpl-desc').value.trim(),kind,
      ...(kind==='daily'?{shiftMode:$('#tpl-shiftmode').value}:{}),
      ...(kind==='weekly'?{weekMode:$('#tpl-weekmode').value}:{}),
    };
    // Re-open the generate modal template list if it's open
    try{ await apiCreateTemplate(payload); notify('Template created.'); modal.classList.remove('open'); refresh();
      if($('#generateModal')?.classList.contains('open')) loadTemplatesIntoModal();
    }
    catch(err){$('#tpl-err').textContent=err.message||'Failed.';$('#tpl-err').style.display='';}
  });
}

/* ══════════════════════════════════════════════
   13. BLOCK REASON MODAL
══════════════════════════════════════════════ */

let _blockResolve=null;
function promptBlockReason(){return new Promise(resolve=>{_blockResolve=resolve;$('#blockModal').classList.add('open');$('#blockModal').setAttribute('aria-hidden','false');$('#blockCategory').focus();});}
function initBlockModal(){
  const close=reason=>{$('#blockModal').classList.remove('open');$('#blockModal').setAttribute('aria-hidden','true');$('#blockCategory').value='';$('#blockDetail').value='';if(_blockResolve){_blockResolve(reason);_blockResolve=null;}};
  $('#blockSkip').addEventListener('click',()=>close(''));
  $('#blockConfirm').addEventListener('click',()=>{const cat=$('#blockCategory').value,det=$('#blockDetail').value.trim();close(cat?(det?`${cat}: ${det}`:cat):det||'');});
  $('#blockModal').addEventListener('click',e=>{if(e.target===$('#blockModal'))close('');});
}

/* ══════════════════════════════════════════════
   14. INTAKE WIZARD  (Projects only)
══════════════════════════════════════════════ */

function openAuditCreateModal() {
  if ($('#auditCreateModal')) {
    $('#ac-title').value = '';
    $('#ac-desc').value = '';
    $('#ac-kind').value = 'daily';
    $('#ac-due').value = '';
    $('#ac-shift').value = '';
    $('#ac-priority').value = '';
    $('#ac-category').value = '';
    $('#ac-err').style.display = 'none';
    const current = currentOwnerOption();
    if (current) setOwnerInputValue($('#ac-owner'), current, { rememberOriginal: true });
    $('#ac-shift')?.closest('.pj-dfield')?.style.setProperty('display', '');
    $('#auditCreateModal').classList.add('open');
    return;
  }
  const modal = document.createElement('div');
  modal.id = 'auditCreateModal';
  modal.className = 'pj-modal-backdrop';
  modal.setAttribute('aria-hidden', 'false');
  modal.setAttribute('role', 'dialog');
  modal.innerHTML = `<div class="pj-modal">
    <h3 class="pj-modal-title">New Audit</h3>
    <div class="pj-detail-grid" style="margin-top:.75rem">
      <div class="pj-dfield span-2"><label class="pj-dlabel">Title *</label><input id="ac-title" class="pj-dinput" type="text" placeholder="e.g. Weekend area inspection"/></div>
      <div class="pj-dfield span-2"><label class="pj-dlabel">Description</label><textarea id="ac-desc" class="pj-dinput pj-dinput-ta" rows="3"></textarea></div>
      <div class="pj-dfield"><label class="pj-dlabel">Kind</label><select id="ac-kind" class="pj-dinput"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
      <div class="pj-dfield"><label class="pj-dlabel">Due Date</label><input id="ac-due" class="pj-dinput" type="date"/></div>
      <div class="pj-dfield"><label class="pj-dlabel">Shift</label><select id="ac-shift" class="pj-dinput"><option value="">None</option><option value="1">Shift 1</option><option value="2">Shift 2</option><option value="3">Shift 3</option><option value="WKND">WKND</option></select></div>
      <div class="pj-dfield"><label class="pj-dlabel">Category</label><input id="ac-category" class="pj-dinput" type="text" placeholder="e.g. Safety"/></div>
      <div class="pj-dfield"><label class="pj-dlabel">Priority</label><select id="ac-priority" class="pj-dinput"><option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
      <div class="pj-dfield span-2"><label class="pj-dlabel">Owner</label><input id="ac-owner" class="pj-dinput" type="text" placeholder="Defaults to the creator until reassigned"/></div>
    </div>
    <div class="pj-modal-actions" style="margin-top:.85rem">
      <button id="ac-cancel" class="pj-btn-ghost" type="button">Cancel</button>
      <button id="ac-save" class="pj-btn-primary" type="button">Create Audit</button>
    </div>
    <div id="ac-err" style="color:var(--danger);font-size:.82rem;margin-top:.35rem;display:none"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.classList.add('open');
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  $('#ac-cancel').addEventListener('click', () => modal.classList.remove('open'));
  wireOwnerInput($('#ac-owner'), { defaultToCurrent: true });
  ensureOwnerDirectoryLoaded().then(() => {
    const current = currentOwnerOption();
    if (current) setOwnerInputValue($('#ac-owner'), current, { rememberOriginal: true });
  }).catch(() => {});
  $('#ac-kind').addEventListener('change', (e) => {
    const shiftField = $('#ac-shift')?.closest('.pj-dfield');
    if (shiftField) shiftField.style.display = e.target.value === 'daily' ? '' : 'none';
  });
  $('#ac-save').addEventListener('click', async () => {
    const title = $('#ac-title').value.trim();
    if (!title) {
      $('#ac-err').textContent = 'Title required.';
      $('#ac-err').style.display = '';
      return;
    }
    let owner;
    try {
      owner = resolveOwnerFromInput($('#ac-owner'), { required: true });
    } catch (err) {
      $('#ac-err').textContent = err.message || 'Owner required.';
      $('#ac-err').style.display = '';
      return;
    }
    $('#ac-err').style.display = 'none';
    try {
      await apiCreate({
        title,
        description: $('#ac-desc').value.trim(),
        kind: $('#ac-kind').value,
        dueDate: $('#ac-due').value || '',
        shift: $('#ac-kind').value === 'daily' ? (normalizeShiftValue($('#ac-shift').value) ?? null) : null,
        category: $('#ac-category').value.trim(),
        ownerId: owner?.id || '',
        ownerName: owner?.name || '',
        ownerLabel: owner?.label || '',
        meta: {
          owner: owner?.label || '',
          priority: $('#ac-priority').value || '',
        },
      });
      notify('Audit created!');
      modal.classList.remove('open');
      await refresh({ resetPage:true });
    } catch (err) {
      $('#ac-err').textContent = err.message || 'Create failed.';
      $('#ac-err').style.display = '';
    }
  });
}

function openIntake(){ resetWizard(); $('#intakeModal').classList.add('open'); $('#intakeModal').setAttribute('aria-hidden','false'); requestAnimationFrame(()=>$('#w-title').focus()); }
function closeIntake(){ $('#intakeModal').classList.remove('open'); $('#intakeModal').setAttribute('aria-hidden','true'); }
function resetWizard(){
  $$('#intakeModal input[type=text],#intakeModal input[type=date],#intakeModal textarea').forEach(el=>el.value='');
  $$('#intakeModal select').forEach(sel=>{sel.selectedIndex=0;});
  $$('#intakeModal .pj-wizard-step').forEach(step => step.classList.remove('active'));
  $('#wstep-1')?.classList.add('active');
  $('#w-template')?.closest('.pj-dfield')?.style.setProperty('display', 'none');
  $('#w-repeat')?.closest('.pj-dfield')?.style.setProperty('display', 'none');
  wireOwnerInput($('#w-owner'), { defaultToCurrent: true });
  const current = currentOwnerOption();
  if (current) setOwnerInputValue($('#w-owner'), current, { rememberOriginal: true });
  buildReviewSummary();
  $('#wizardError').style.display='none';
}
function validateWizStep(){
  const required = [
    ['w-title','Project / task title is required.'],
    ['w-objective','Scope / objective is required.'],
    ['w-owner','Owner is required.'],
    ['w-dept','Area / line / building is required.'],
  ];
  for (const [id,msg] of required) {
    const el = $('#'+id);
    if (!el?.value.trim()) {
      $('#wizardError').textContent = msg;
      $('#wizardError').style.display = '';
      el?.focus();
      return false;
    }
  }
  $('#wizardError').style.display='none';
  return true;
}
function buildReviewSummary(){
  const lines=[
    `Title: ${$('#w-title')?.value.trim()||'�'}`,
    `Scope: ${$('#w-objective')?.value.trim()||'�'}`,
    `Owner: ${$('#w-owner')?.value.trim()||'�'}`,
    `Area: ${$('#w-dept')?.value.trim()||'�'}`,
    `Start: ${$('#w-startdate')?.value||'�'}`,
    `Target: ${$('#w-targetdate')?.value||'�'}`,
    `Priority: ${$('#w-priority')?.value||'None'}`,
    `Related: ${$("#w-relatedref")?.value.trim()||"-"}`,
  ];
  $('#reviewSummary').innerHTML=lines.map(l=>`<div>� ${esc(l)}</div>`).join('');
}
function collectWizardPayload(){
  const owner = resolveOwnerFromInput($('#w-owner'), { required: true });
  const targetDate = $('#w-targetdate').value || '';
  const startDate = $('#w-startdate').value || '';
  const notes = $('#w-desc').value.trim();
  const objective = $('#w-objective').value.trim();
  const area = $('#w-dept').value.trim();
  const relatedRef = $('#w-relatedref').value.trim();
  const descriptionParts = [objective, notes].filter(Boolean);
  return {
    title: $('#w-title').value.trim(),
    description: descriptionParts.join('\n\n'),
    bucket: 'todo',
    dueDate: targetDate,
    ownerId: owner?.id || '',
    ownerName: owner?.name || '',
    ownerLabel: owner?.label || '',
    meta: {
      owner: owner?.label || '',
      objective,
      area,
      notes,
      relatedRef,
      priority: $('#w-priority').value,
      plan: {
        startDate,
        targetDate,
      },
    },
  };
}

function openPrimaryCreateAction() {
  if (state.domain === 'audit') openAuditCreateModal();
  else openIntake();
}

function initWizard(){
  syncPrimaryActions();
  $('#btnNew').addEventListener('click', openPrimaryCreateAction);
  $('#intakeClose').addEventListener('click',closeIntake);
  $('#intakeModal').addEventListener('click',e=>{if(e.target===$('#intakeModal'))closeIntake();});
  ['w-title','w-objective','w-owner','w-dept','w-startdate','w-targetdate','w-desc','w-priority','w-relatedref'].forEach(id=>{
    $('#'+id)?.addEventListener('input',buildReviewSummary);
    $('#'+id)?.addEventListener('change',buildReviewSummary);
  });
  $('#wizNext').addEventListener('click',async()=>{
    if(!validateWizStep())return;
    const payload=collectWizardPayload();
    $('#wizNext').textContent='Creating...';$('#wizNext').disabled=true;
    try{await apiCreate(payload);notify('Project created!');closeIntake();await refresh({resetPage:true}); localStorage.removeItem('pj-draft');}
    catch(err){$('#wizardError').textContent=err.message||'Create failed.';$('#wizardError').style.display='';}
    finally{$('#wizNext').textContent='Create Project';$('#wizNext').disabled=false;}
  });
  $('#wizSaveDraft').addEventListener('click',()=>{try{localStorage.setItem('pj-draft',JSON.stringify(collectWizardPayload()));notify('Draft saved locally.');}catch{notify('Could not save draft.','error');}});
}

/* ══════════════════════════════════════════════
   15. BULK BAR
══════════════════════════════════════════════ */

function updateBulkBar(){const bar=$('#bulkBar'),count=state.selected.size;bar.hidden=count===0;if(count>0)$('#bulkCount').textContent=`${count} selected`;}
function initBulkBar(){
  $('#selectAll')?.addEventListener('change',e=>{if(e.target.checked)state.items.forEach(t=>state.selected.add(t.id));else state.selected.clear();renderCurrentView();updateBulkBar();});
  $('#btnSelectAllFiltered')?.addEventListener('click',async()=>{
    const btn=$('#btnSelectAllFiltered');
    btn.textContent='Loading…';btn.disabled=true;
    try{
      const usp=new URLSearchParams({limit:'9999',page:'1'});
      if(state.q) usp.set('q',state.q);
      const cats=[...state.filter.categories].join(',');if(cats)usp.set('category',cats);
      const bkts=[...state.filter.buckets].join(',');if(bkts)usp.set('bucket',bkts);
      const data=await apiFetch('/projects/api?'+usp.toString());
      (data.items||[]).forEach(t=>state.selected.add(t.id));
      renderCurrentView();updateBulkBar();
      notify(`Selected ${state.selected.size} tasks.`);
    }catch(e){notify('Could not fetch all IDs: '+e.message,'error');}
    finally{btn.textContent='Select all matching';btn.disabled=false;}
  });
  $('#bulkClearBtn').addEventListener('click',()=>{state.selected.clear();updateBulkBar();renderCurrentView();});
  $('#bulkMoveBtn').addEventListener('click',async()=>{
    const bucket=$('#bulkMoveSel').value;if(!bucket||!state.selected.size)return;
    $('#bulkMoveBtn').textContent='Moving…';$('#bulkMoveBtn').disabled=true;
    try{await Promise.all([...state.selected].map(id=>apiMove(id,bucket)));notify(`Moved ${state.selected.size} to ${BUCKET_LABELS[bucket]}.`);state.selected.clear();await refresh();}
    catch{notify('Some moves failed.','error');}finally{$('#bulkMoveBtn').textContent='Apply';$('#bulkMoveBtn').disabled=false;}
  });
  $('#bulkDeleteBtn').addEventListener('click',async()=>{
    const count=state.selected.size;
    if(!count||!confirm(`Permanently delete ${count} task${count>1?'s':''}?`))return;
    const btn=$('#bulkDeleteBtn');
    btn.textContent='Deleting…';btn.disabled=true;
    try{
      const ids=[...state.selected];
      const res=await apiFetch('/projects/api/bulk',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
      notify(`Deleted ${res.removed??count} task${count>1?'s':''}.`);
      state.selected.clear();await refresh();
    }catch(e){notify(e.message||'Delete failed.','error');}
    finally{btn.textContent='Delete selected';btn.disabled=false;}
  });
}

/* ══════════════════════════════════════════════
   16. VIEW TOGGLE + SORT HEADERS
══════════════════════════════════════════════ */

function initViewToggle(){
  const boardBtn=$('#btn-board'),listBtn=$('#btn-list');
  function setView(v){state.view=v;localStorage.setItem('pj-view',v);boardBtn.classList.toggle('active',v==='board');listBtn.classList.toggle('active',v==='list');boardBtn.setAttribute('aria-pressed',String(v==='board'));listBtn.setAttribute('aria-pressed',String(v==='list'));renderCurrentView();}
  boardBtn.addEventListener('click',()=>setView('board'));listBtn.addEventListener('click',()=>setView('list'));
  setView(state.view);
  document.addEventListener('click',e=>{
    const th=e.target.closest('.pj-th-sortable');if(!th)return;
    const field=th.dataset.sort;if(!field)return;
    if(state.sortField===field)state.sortDir=state.sortDir==='asc'?'desc':'asc';else{state.sortField=field;state.sortDir='asc';}
    $$('.pj-th-sortable').forEach(el=>{el.classList.remove('asc','desc');if(el.dataset.sort===state.sortField)el.classList.add(state.sortDir);});
    renderList();
  });
}

/* ══════════════════════════════════════════════
   16b. PURGE MODAL
══════════════════════════════════════════════ */
function initPurge(){
  const bg=document.getElementById('purgeModalBg');
  if(!bg)return;
  const preview=document.getElementById('purgePreview');
  const progress=document.getElementById('purgeProgress');
  const progBar=document.getElementById('purgeProgressBar');
  const progLbl=document.getElementById('purgeProgressLabel');
  const confirmBtn=document.getElementById('btnPurgeConfirm');

  const open=()=>{ bg.style.display='flex'; preview.style.display='none'; confirmBtn.disabled=true; progress.style.display='none'; };
  const close=()=>{ bg.style.display='none'; };

  document.getElementById('btnPurge')?.addEventListener('click',open);
  document.getElementById('btnPurgeClose')?.addEventListener('click',close);
  document.getElementById('btnPurgeClose2')?.addEventListener('click',close);
  bg.addEventListener('click',e=>{ if(e.target===bg)close(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&bg.style.display==='flex')close(); });

  function params(){
    return {
      domain:          document.getElementById('purge-domain').value,
      kind:            document.getElementById('purge-kind').value,
      source:          document.getElementById('purge-source').value,
      bucket:          document.getElementById('purge-bucket').value,
      olderThanDays:   document.getElementById('purge-days').value ? Number(document.getElementById('purge-days').value) : undefined,
      preserveTemplates: true,
    };
  }
  function preset(domain,kind,source,bucket,days){
    document.getElementById('purge-domain').value=domain||'all';
    document.getElementById('purge-kind').value  =kind  ||'all';
    document.getElementById('purge-source').value=source||'all';
    document.getElementById('purge-bucket').value=bucket||'all';
    document.getElementById('purge-days').value  =days  ||'';
    preview.style.display='none'; confirmBtn.disabled=true;
  }
  document.getElementById('preset-all-done')?.addEventListener('click',()=>preset('all','all','all','done'));
  document.getElementById('preset-old-audits')?.addEventListener('click',()=>preset('audit','daily','all','all',7));
  document.getElementById('preset-cal-tasks')?.addEventListener('click',()=>preset('all','all','expiration','all'));
  document.getElementById('preset-everything')?.addEventListener('click',()=>preset('all','all','all','all'));

  document.getElementById('btnPurgePreview')?.addEventListener('click',async()=>{
    preview.style.display=''; preview.style.color='var(--fg-muted)';
    preview.textContent='Counting…'; confirmBtn.disabled=true;
    try{
      // Dry-run: get count without deleting
      const res=await apiFetch('/projects/api/purge',{
        method:'DELETE',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...params(),dryRun:true}),
      });
      const n=res.removed??0;
      preview.textContent=`✔ ${n.toLocaleString()} task${n!==1?'s':''} would be removed. ${(res.remaining??'').toLocaleString()} would remain.`;
      preview.style.color=n>0?'var(--danger)':'var(--ok)';
      confirmBtn.disabled=n===0;
      confirmBtn.dataset.count=String(n);
    }catch(e){
      preview.textContent='Error: '+e.message;
      preview.style.color='var(--danger)';
      confirmBtn.disabled=true;
    }
  });

  confirmBtn?.addEventListener('click',async()=>{
    const n=parseInt(confirmBtn.dataset.count||'0',10);
    if(!n||!confirm(`Permanently delete ${n} task${n!==1?'s':''}? This cannot be undone.`))return;
    confirmBtn.disabled=true;
    progress.style.display='';
    progBar.style.width='10%';
    progLbl.textContent='Purging '+n+' tasks…';
    try{
      const t0=Date.now();
      progBar.style.width='40%';
      const res=await apiFetch('/projects/api/purge',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(params())});
      progBar.style.width='100%';
      progLbl.textContent=`Done — removed ${res.removed} in ${((Date.now()-t0)/1000).toFixed(1)}s`;
      notify(`Purged ${res.removed} task${res.removed!==1?'s':''}.`);
      state.selected.clear();
      await refresh();
      setTimeout(close,1800);
    }catch(e){
      progLbl.textContent='Error: '+e.message;
      progBar.style.background='var(--danger)';
      notify(e.message||'Purge failed.','error');
      confirmBtn.disabled=false;
    }
  });
}

/* ══════════════════════════════════════════════
   17. SOCKET.IO
══════════════════════════════════════════════ */

function initSocket(){
  if(!window.io)return;
  try{
    const socket=io('/',{withCredentials:true});
    socket.emit('subscribe','projects'); socket.emit('subscribe','audit');
    socket.on('projectsUpdated',payload=>{if(state.domain==='project'&&payload?.reason!=='move')refresh();});
    socket.on('auditUpdated',()=>{if(state.domain==='audit')refresh();});
  }catch{}
}

/* ══════════════════════════════════════════════
   18. BOOT
══════════════════════════════════════════════ */

async function loadUser(){
  try{
    const r=await fetch('/auth/whoami',{credentials:'include'});
    const j=await r.json();
    state.user=j?.user||null;
    if(state.user){
      // Keep in sync with the server-side writer set in routes/projects.js
      // (requireRole('admin','lead','management','coordinator')). Without
      // 'coordinator' here, a coordinator's UI would hide management actions
      // even though the server would accept them — and, conversely, any role
      // not listed here should not see the manage controls to avoid triggering
      // 403s on /projects/api/move.
      state.canManage=['admin','lead','management','coordinator'].includes((state.user.role||'').toLowerCase());
    }
    ensureOwnerDirectoryLoaded().catch(() => {});
    window._afterUserLoad?.();
  }catch{}
}

// CSS additions for domain tabs and audit kinds (injected once)
function injectExtraStyles(){
  if($('#pj-domain-extra-styles'))return;
  const style=document.createElement('style');
  style.id='pj-domain-extra-styles';
  style.textContent=`
    .pj-domain-tabs{display:flex;gap:2px;padding:.4rem 1rem .3rem;background:var(--surface);border-bottom:1px solid var(--border);}
    .pj-dtab-top{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .85rem;border:1px solid transparent;border-radius:var(--radius-sm);background:transparent;color:var(--fg-muted);cursor:pointer;font-size:.88rem;font-weight:500;transition:background .12s,color .12s,border-color .12s;}
    .pj-dtab-top:hover{background:var(--surface-strong);color:var(--fg);}
    .pj-dtab-top.active{background:var(--accent);color:var(--accent-contrast);border-color:var(--accent);}
    .pj-audit-toolbar{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;padding:.45rem 1rem;background:var(--info-bg);border-bottom:1px solid var(--border);}
    .pj-kind-badge{font-size:.7rem;font-weight:700;padding:.12rem .45rem;border-radius:999px;border:1px solid;}
    .pj-kind-badge[data-kind=daily]{background:var(--info-bg);color:var(--info);border-color:var(--info);}
    .pj-kind-badge[data-kind=weekly]{background:var(--warn-bg);color:var(--warn);border-color:var(--warn);}
  `;
  document.head.appendChild(style);
}

async function init(){
  if (URL_DOMAIN) localStorage.setItem('pj-domain', URL_DOMAIN);
  try {
    const sp = new URLSearchParams(window.location.search);
    const qParam = sp.get('q');
    if (qParam) state.q = qParam.trim();
    const qf = sp.get('qfilter');
    if (qf) state.qFilter = qf;
    const bucketParam = sp.get('bucket');
    if (bucketParam && BUCKETS.includes(bucketParam)) state.bucket = bucketParam;
  } catch { /* noop */ }
  injectExtraStyles();
  initPurge();
  await loadUser();
  injectDomainTabs();
  injectAuditToolbar();
  injectProjectToolbar();
  injectAuditKindFilter();
  updateAuditToolbar();
  initFilters();
  syncFilterUiFromState();
  initViewToggle();
  initDetailPanel();
  initWizard();
  initBlockModal();
  initBulkBar();
  initSocket();

  // Draft restore banner
  if(localStorage.getItem('pj-draft')){
    const notice=document.createElement('div');
    notice.style.cssText='font-size:.8rem;color:var(--warn);padding:.25rem 1rem;background:var(--warn-bg);border-bottom:1px solid var(--warn)';
    notice.innerHTML='⚠ You have a saved draft. <button id="restoreDraft" style="background:none;border:none;color:var(--warn);cursor:pointer;font-weight:700;font-size:.8rem;text-decoration:underline">Restore</button> or <button id="discardDraft" style="background:none;border:none;color:var(--warn);cursor:pointer;font-weight:700;font-size:.8rem;text-decoration:underline">Discard</button>';
    document.body.insertBefore(notice,$('#filterBar'));
    $('#restoreDraft').addEventListener('click',()=>{try{const d=JSON.parse(localStorage.getItem('pj-draft')||'{}');openIntake();setTimeout(()=>{
      $('#w-title').value=d.title||'';
      $('#w-objective').value=d.meta?.objective||'';
      setOwnerInputValue($('#w-owner'), {
        id: d.ownerId||d.meta?.ownerId||'',
        name: d.ownerName||d.meta?.ownerName||d.ownerLabel||d.meta?.owner||'',
        label: d.ownerLabel||d.meta?.ownerLabel||d.meta?.owner||'',
      }, { rememberOriginal: true });
      $('#w-dept').value=d.meta?.area||'';
      $('#w-startdate').value=d.meta?.plan?.startDate||'';
      $('#w-targetdate').value=d.dueDate||d.meta?.plan?.targetDate||'';
      $('#w-desc').value=d.meta?.notes||d.description||'';
      $('#w-priority').value=d.meta?.priority||'';
      $('#w-relatedref').value=d.meta?.relatedRef||'';
      buildReviewSummary();
    },100);}catch{}notice.remove();});
    $('#discardDraft').addEventListener('click',()=>{localStorage.removeItem('pj-draft');notice.remove();});
  }

  await refresh();
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();









