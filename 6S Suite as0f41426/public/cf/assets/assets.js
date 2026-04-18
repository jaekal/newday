/**
 * public/cf/assets/assets.js
 * Command Floor — Assets page.
 * Data: GET /asset-catalog/api/all · GET /api/audit-rules
 * Write: POST /asset-catalog/:id/audits · PATCH /asset-catalog/:id/calibration
 */
'use strict';

import { startLiveClock, countUp, esc, fmtTime } from '/cf/cf-shell.js';

/** Stroke icons (aligned with public/js/suite-icons.js) for filters & badges */
const SV_IC = {
  fleet: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="m3 16 9 5 9-5"/></svg>',
  equip: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 9V7a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/><path d="M8 9h8l-1 10H9L8 9z"/><path d="M10 14h4"/></svg>',
  bldg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 12h12"/></svg>',
};

/* ── Audit criteria catalog ────────────────────────────────────────
   Stable storage keys (PascalCase) → human labels + short hints.
   Anything rendered in the audit modal pulls from here so the operator
   sees friendly wording while the server still records the canonical key. */
const CRITERIA_LABELS = {
  // Universal — applied to every fleet audit
  TagLegible:        { label: 'Tag / barcode legible',       hint: 'Asset tag and barcode readable' },
  GeneralCondition:  { label: 'General condition acceptable', hint: 'No major wear, cracks, or abuse' },
  SafeToOperate:     { label: 'Safe to operate',             hint: 'No red-tag, lock-out, or hazards present' },

  // Laptops
  PhysicalDamage:     { label: 'No physical damage',      hint: 'Chassis, hinges, and bezel intact' },
  ScreenIntact:       { label: 'Screen intact',           hint: 'No cracks, blotches, or dead pixels' },
  PowerCordPresent:   { label: 'Power cord present',      hint: 'Charger included and undamaged' },
  BatteryHealthy:     { label: 'Battery healthy',         hint: 'Holds charge, no swelling or heat' },
  KeyboardFunctional: { label: 'Keyboard functional',     hint: 'All keys responsive; trackpad clicks' },
  PortsClear:         { label: 'Ports clear',             hint: 'No bent pins or debris in USB / jacks' },
  LabelIntact:        { label: 'ID label intact',         hint: 'Asset label affixed and readable' },

  // Carts
  WheelsRoll:         { label: 'Wheels roll smoothly',    hint: 'No flat spots or seized casters' },
  BrakeCheck:         { label: 'Brakes engage',           hint: 'Wheel locks hold cart in place' },
  Cleanliness:        { label: 'Cart clean',              hint: 'Free of debris, residue, and spills' },
  Monitors:           { label: 'Monitors operational',    hint: 'Power on cleanly; no cracks' },
  Keyboards:          { label: 'Keyboards operational',   hint: 'Mounted, clean, all keys work' },
  CableManagement:    { label: 'Cables routed safely',    hint: 'No pinch points or exposed conductors' },
  CastersSecure:      { label: 'Casters secure',          hint: 'No loose bolts or wobble' },
  DeckStable:         { label: 'Deck / surface stable',   hint: 'No cracks, flex, or warping' },

  // Whips / power
  ConnectorSecure:    { label: 'Connectors secure',       hint: 'Firm seating; no exposed pins' },
  InsulationIntact:   { label: 'Insulation intact',       hint: 'No cracks, abrasion, or burn marks' },
  NoExposedWires:     { label: 'No exposed wires',        hint: 'Jacket continuous end-to-end' },
  StrainReliefOK:     { label: 'Strain relief OK',        hint: 'Cable jacket secured at both connectors' },
  GroundingSecure:    { label: 'Grounding secure',        hint: 'Earth connection continuous' },

  // Transceivers
  PortClean:          { label: 'Port clean',              hint: 'No dust or debris in connector' },
  LabelPresent:       { label: 'Label present',           hint: 'Identification label visible' },
  LEDsNormal:         { label: 'LEDs normal',             hint: 'Status indicators in expected state' },
  FirmwareCurrent:    { label: 'Firmware current',        hint: 'Running approved firmware version' },

  // Toolboxes
  Contents:           { label: 'Contents accounted for',  hint: 'All expected items present' },
  LockingMechanism:   { label: 'Lock / latch works',      hint: 'Latches engage and disengage cleanly' },
  HandleSecure:       { label: 'Handle secure',           hint: 'No wobble, cracks, or loose fasteners' },
  InventoryComplete:  { label: 'Inventory matches sheet', hint: 'Contents match the packed checklist' },

  // BBU / Drop boxes
  BatteryLevel:       { label: 'Battery level adequate',  hint: 'Sufficient charge for duty cycle' },
  VentilationClear:   { label: 'Vents clear',             hint: 'No blockage; airflow unrestricted' },
  TerminalsClean:     { label: 'Terminals clean',         hint: 'No corrosion or oxidation' },
  MountingSecure:     { label: 'Mounting secure',         hint: 'Fasteners tight; no movement' },
  LidCloses:          { label: 'Lid closes fully',        hint: 'Seal clean and intact' },
  NoCorrosion:        { label: 'No corrosion',            hint: 'Chassis and terminals dry, no rust' },

  // Test / voltage
  ContentInventory:   { label: 'Content inventory matches', hint: 'All accessories present' },
  CalibrationValid:   { label: 'Calibration in date',     hint: 'Calibration sticker valid and legible' },
  ProbesIntact:       { label: 'Probes / leads intact',   hint: 'No cuts, kinks, or exposed conductor' },
  BatteryGood:        { label: 'Battery good',            hint: 'No leaks; holds charge' },
};

/* Common criteria that apply to every fleet audit regardless of category. */
const COMMON_CRITERIA = ['TagLegible', 'GeneralCondition', 'SafeToOperate'];

/* Humanize a key that has no entry in CRITERIA_LABELS (e.g. "PortsClear"
   → "Ports clear"). Keeps the UI readable for any custom criteria added
   to auditRules.json without a client-side label entry. */
function humanizeCriterion(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function getCriterionMeta(key) {
  return CRITERIA_LABELS[key] || { label: humanizeCriterion(key), hint: '' };
}

/* ── State ─────────────────────────────────────────────────────── */
let allAssets    = [];
let auditRules   = {};
let filtered     = [];
let activeTab    = 'all';    // 'all' | 'overdue' | 'due' | 'ok'
let activeType   = '';       // '' | 'fleet' | 'equipment'
let activeStatus  = '';
let activeBuilding = '';  // '' | 'Bldg-350' | 'Bldg-4050'
let searchQ      = '';
let sortCol      = 'tagNumber';
let sortAsc      = true;
let page         = 1;
const PAGE_LEN   = 15;

/** Display name from session user for audit records (bulk + modal). */
let sessionAuditorName = '';

function displayNameFromSessionUser(u) {
  if (!u || typeof u !== 'object') return '';
  const raw = String(u.name || u.displayName || u.username || u.techId || u.id || '').trim();
  if (raw) return raw;
  const em = String(u.email || '').trim();
  if (em.includes('@')) return em.split('@')[0];
  return '';
}

async function loadSessionAuditor() {
  try {
    const r = await fetch('/api/whoami', { credentials: 'include' });
    if (!r.ok) return;
    const data = await r.json();
    sessionAuditorName = displayNameFromSessionUser(data?.user);
  } catch { /* noop */ }
}

/* ── DOM helpers ────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const qs = (s, r = document) => r.querySelector(s);

/* ── PM status computation ──────────────────────────────────────── */
function pmStatus(asset) {
  if (asset.itemType === 'equipment') {
    if (!asset.nextCalibrationDue) return { val: 'none', label: 'No cal schedule', days: null };
    const days = Math.ceil((new Date(asset.nextCalibrationDue) - Date.now()) / 86_400_000);
    if (days < 0)   return { val: 'overdue', label: `Cal overdue ${Math.abs(days)}d`, days };
    if (days <= 14) return { val: 'due',     label: `Cal in ${days}d`,                days };
    return { val: 'ok', label: `Cal ${new Date(asset.nextCalibrationDue).toLocaleDateString(undefined,{dateStyle:'short'})}`, days };
  }
  // Fleet — use auditRules
  const rule = auditRules[asset.category];
  const freq = Number(rule?.frequencyDays || 0);
  if (!freq) return { val: 'none', label: 'No schedule', days: null };

  const logs  = (asset.auditLogs || []);
  const last  = logs.reduce((best, l) => {
    const d = l.auditDate ? new Date(l.auditDate) : null;
    return (d && (!best || d > best)) ? d : best;
  }, null);

  if (!last) return { val: 'overdue', label: 'Never audited', days: -9999 };

  const nextDue  = new Date(last.getTime() + freq * 86_400_000);
  const dueSoon  = new Date(nextDue.getTime() - 7 * 86_400_000);
  const now      = Date.now();
  const days     = Math.ceil((nextDue - now) / 86_400_000);

  if (now >= nextDue)  return { val: 'overdue', label: `PM overdue ${Math.abs(days)}d`, days };
  if (now >= dueSoon)  return { val: 'due',     label: `PM in ${days}d`,                days };
  return { val: 'ok', label: `PM ${nextDue.toLocaleDateString(undefined,{dateStyle:'short'})}`, days };
}

/* ── Fetch ──────────────────────────────────────────────────────── */
async function loadData() {
  try {
    const [assetsRes, rulesRes] = await Promise.all([
      fetch('/asset-catalog/api/all', { credentials: 'include' }),
      fetch('/api/audit-rules',       { credentials: 'include' }),
    ]);
    allAssets  = assetsRes.ok  ? await assetsRes.json()  : [];
    auditRules = rulesRes.ok   ? await rulesRes.json()   : {};
    if (!Array.isArray(allAssets)) allAssets = [];
  } catch (e) {
    console.error('[CF Assets] load failed:', e);
    allAssets = [];
  }
  // Annotate each asset with computed PM status for sorting
  allAssets.forEach(a => { a._pm = pmStatus(a); a._pmSort = a._pm.days ?? 9999; });
  applyFilters();
  renderKpis();
  renderPmDuePanel();
  updateCategoryPills();
}

/* ── KPIs ───────────────────────────────────────────────────────── */
function renderKpis() {
  const total   = allAssets.length;
  const overdue = allAssets.filter(a => a._pm.val === 'overdue').length;
  const due     = allAssets.filter(a => a._pm.val === 'due').length;
  const out     = allAssets.filter(a => a.status === 'Checked Out').length;

  countUp('kv-total',   total,   { barId:'bar-total',   barPct:100,                         delay:100 });
  countUp('kv-overdue', overdue, { barId:'bar-overdue', barPct: total ? Math.round(overdue/total*100):0, delay:200 });
  countUp('kv-due',     due,     { barId:'bar-due',     barPct: total ? Math.round(due/total*100):0,     delay:300 });
  countUp('kv-out',     out,     { barId:'bar-out',     barPct: total ? Math.round(out/total*100):0,     delay:400 });

  const sub = $('ks-total');
  if (sub) {
    const fleet = allAssets.filter(a => (a.itemType||'fleet')==='fleet').length;
    const equip = allAssets.filter(a => a.itemType==='equipment').length;
    sub.textContent = `${fleet} fleet · ${equip} equipment`;
  }
  const crumb = $('topbarCrumb');
  if (crumb) crumb.textContent = `/ Fleet & equipment · ${total} assets`;
  const rail = $('railDueCount');
  if (rail) { rail.textContent = overdue + due; rail.style.display = (overdue+due) ? '' : 'none'; }
}

/* ── Filters ────────────────────────────────────────────────────── */
function applyFilters() {
  const q = searchQ.toLowerCase().trim();
  filtered = allAssets.filter(a => {
    if (activeBuilding && (a.building || 'Bldg-350') !== activeBuilding) return false;
    if (activeType   && (a.itemType||'fleet') !== activeType)   return false;
    if (activeStatus && a.status !== activeStatus)              return false;
    if (activeTab === 'overdue' && a._pm.val !== 'overdue')     return false;
    if (activeTab === 'due'     && a._pm.val !== 'due')         return false;
    if (activeTab === 'ok'      && !['ok','none'].includes(a._pm.val)) return false;
    if (q) {
      const hay = [a.tagNumber, a.name, a.category, a.location, a.description, a.serialNumber]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (sortCol === '_pmSort') { av = Number(av); bv = Number(bv); return sortAsc ? av-bv : bv-av; }
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortAsc ? cmp : -cmp;
  });

  page = 1;
  renderTable();
}

/* ── Table ──────────────────────────────────────────────────────── */
function pmPill(pm) {
  if (pm.val === 'overdue') return `<span class="cf-pill crit"><span class="cf-pill-dot"></span>${esc(pm.label)}</span>`;
  if (pm.val === 'due')     return `<span class="cf-pill warn"><span class="cf-pill-dot"></span>${esc(pm.label)}</span>`;
  if (pm.val === 'ok')      return `<span class="cf-pill ok"><span class="cf-pill-dot"></span>${esc(pm.label)}</span>`;
  return `<span style="font-size:11px;color:#94A3B8;font-family:'IBM Plex Sans',sans-serif">—</span>`;
}

function statusPill(status) {
  const map = {
    'Available':   'ok',
    'In Use':      'ord',
    'Checked Out': 'out',
    'Maintenance': 'warn',
    'Defective':   'crit',
    'Expired':     'crit',
  };
  const cls = map[status] || 'ok';
  return `<span class="cf-pill ${cls}"><span class="cf-pill-dot"></span>${esc(status)}</span>`;
}

function typeBadge(itemType) {
  const isEq = itemType === 'equipment';
  const ic = isEq ? SV_IC.equip : SV_IC.fleet;
  const bg = isEq ? 'rgba(0,180,216,.1)' : '#F0F4F8';
  const fg = isEq ? '#0096B4' : '#64748B';
  const label = isEq ? 'Equip' : 'Fleet';
  return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${bg};color:${fg};font-family:'IBM Plex Sans',sans-serif;white-space:nowrap;display:inline-flex;align-items:center;gap:4px">${ic}${label}</span>`;
}

function renderTable() {
  const tbody  = $('assetBody');
  const info   = $('pgInfo');
  const count  = $('assetCount');
  if (!tbody) return;

  const total = filtered.length;
  const start = (page - 1) * PAGE_LEN;
  const slice = filtered.slice(start, start + PAGE_LEN);

  if (count) count.textContent = `showing ${total.toLocaleString()}`;
  if (info)  info.textContent  = total === 0 ? 'No results' : `${start+1}–${Math.min(start+PAGE_LEN,total)} of ${total.toLocaleString()}`;

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#94A3B8;font-family:'IBM Plex Sans',sans-serif">No assets match the current filters.</td></tr>`;
    renderPagination(total); return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  slice.forEach(a => {
    const pm    = a._pm;
    const rowCls = pm.val === 'overdue' ? 'row-crit' : pm.val === 'due' ? 'row-warn' : '';
    const isEquip = a.itemType === 'equipment';

    // Action buttons depend on type
    const actionHtml = isEquip
      ? `<div style="display:flex;gap:3px">
           <button class="cf-rq-action" data-action="cal" data-id="${a.id}" data-tag="${esc(a.tagNumber)}" data-name="${esc(a.name)}" data-interval="${a.calibrationIntervalDays||''}">Cal</button>
           ${a.status === 'Checked Out'
             ? `<button class="cf-rq-action" data-action="return" data-id="${a.id}" data-tag="${esc(a.tagNumber)}" style="background:rgba(245,158,11,.1);color:#92400E;border-color:rgba(245,158,11,.3)">Return</button>`
             : `<button class="cf-rq-action" data-action="checkout" data-id="${a.id}" data-tag="${esc(a.tagNumber)}" style="background:rgba(34,197,94,.1);color:#15803D;border-color:rgba(34,197,94,.3)">Out</button>`
           }
         </div>`
      : `<button class="cf-rq-action" data-action="audit" data-id="${a.id}" data-tag="${esc(a.tagNumber)}" data-name="${esc(a.name)}" data-cat="${esc(a.category||'')}">Audit</button>`;

    const tr = document.createElement('tr');
    tr.className = rowCls;
    tr.dataset.id = a.id;
    tr.innerHTML = `
      <td class="mono">${esc(a.tagNumber)}</td>
      <td>${typeBadge(a.itemType||'fleet')}</td>
      <td style="font-family:'IBM Plex Sans',sans-serif">
        ${esc(a.name)}
        ${isEquip && a.serialNumber ? `<div style="font-size:11px;color:#94A3B8;font-family:'IBM Plex Mono',monospace;margin-top:1px">S/N: ${esc(a.serialNumber)}</div>` : ''}
      </td>
      <td class="muted" style="font-size:12px">${esc(a.category||'—')}</td>
      <td class="muted" style="font-size:12px">${esc(a.location||'—')}</td>
      <td>${statusPill(a.status||'Available')}</td>
      <td>${pmPill(pm)}</td>
      <td>${actionHtml}</td>`;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  renderPagination(total);

  // Row action delegation
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, tag, name, cat, interval } = btn.dataset;
    if (action === 'audit')    openAuditModal(id, tag, name, cat);
    if (action === 'cal')      openCalModal(id, tag, name, interval);
    if (action === 'checkout') doCheckout(id, tag);
    if (action === 'return')   doReturn(id, tag);
  }, { capture: false });
}

/* ── Pagination ─────────────────────────────────────────────────── */
function renderPagination(total) {
  const c = $('pgBtns');
  if (!c) return;
  const pages = Math.max(1, Math.ceil(total / PAGE_LEN));
  c.innerHTML = '';
  if (pages <= 1) return;

  const mk = (label, p, active, disabled) => {
    const b = document.createElement('button');
    b.className = 'cf-pg-btn' + (active ? ' active' : '');
    b.innerHTML = label; b.disabled = disabled; b.dataset.page = p;
    return b;
  };

  const f = document.createDocumentFragment();
  const prev = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
  const next = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;
  f.appendChild(mk(prev, page-1, false, page===1));
  const lo = Math.max(1, page-2), hi = Math.min(pages, page+2);
  for (let p = lo; p <= hi; p++) f.appendChild(mk(p, p, p===page, false));
  f.appendChild(mk(next, page+1, false, page>=pages));
  c.appendChild(f);
  c.onclick = e => { const b = e.target.closest('.cf-pg-btn[data-page]'); if (!b||b.disabled) return; page=+b.dataset.page; renderTable(); };
}

/* ── PM Due panel ───────────────────────────────────────────────── */
function renderPmDuePanel() {
  const list  = $('pmDueList');
  const count = $('pmDueCount');
  if (!list) return;

  const due = allAssets
    .filter(a => a._pm.val === 'overdue' || a._pm.val === 'due')
    .sort((a, b) => (a._pm.days??0) - (b._pm.days??0))
    .slice(0, 20);

  if (count) count.textContent = `${due.length} pending`;

  if (!due.length) {
    list.innerHTML = `<div style="padding:2rem;text-align:center;color:#94A3B8;font-size:12px;font-family:'IBM Plex Sans',sans-serif">All assets are within their PM schedule.</div>`;
    return;
  }

  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  due.forEach(a => {
    const pm  = a._pm;
    const div = document.createElement('div');
    div.className = 'cf-pm-item';
    div.setAttribute('role', 'listitem');
    div.innerHTML = `
      <div class="cf-pm-top">
        <span class="cf-pm-tag">${esc(a.tagNumber)}</span>
        <span class="cf-pill ${pm.val === 'overdue' ? 'crit' : 'warn'}" style="font-size:10px">
          <span class="cf-pill-dot"></span>${pm.val === 'overdue' ? 'Overdue' : 'Due soon'}
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="cf-pm-name">${esc(a.name)}</span>
        <button class="cf-pm-action" data-action="${a.itemType==='equipment'?'cal':'audit'}"
                data-id="${a.id}" data-tag="${esc(a.tagNumber)}" data-name="${esc(a.name)}"
                data-cat="${esc(a.category||'')}" data-interval="${a.calibrationIntervalDays||''}">
          ${a.itemType === 'equipment' ? 'Cal' : 'Audit'}
        </button>
      </div>
      <div class="cf-pm-meta">${esc(a.category||'')} · ${esc(a.location||'—')} · ${esc(pm.label)}</div>`;
    frag.appendChild(div);
  });
  list.appendChild(frag);

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id, tag, name, cat, interval } = btn.dataset;
    if (action === 'audit') openAuditModal(id, tag, name, cat);
    if (action === 'cal')   openCalModal(id, tag, name, interval);
  }, { capture: false });
}

/* ── Update category pill warn/crit decoration ─────────────────── */
function updateCategoryPills() {
  const fleet = allAssets.filter(a => (a.itemType||'fleet')==='fleet').length;
  const equip = allAssets.filter(a => a.itemType==='equipment').length;
  const b350  = allAssets.filter(a => (a.building||'Bldg-350') === 'Bldg-350').length;
  const b4050 = allAssets.filter(a => (a.building||'Bldg-350') === 'Bldg-4050').length;
  const fleetBtn  = document.querySelector('[data-type="fleet"]');
  const equipBtn  = document.querySelector('[data-type="equipment"]');
  const b350Btn   = document.querySelector('[data-building="Bldg-350"]');
  const b4050Btn  = document.querySelector('[data-building="Bldg-4050"]');
  const pillIc = (svg) => `<span class="cf-pill-ic" aria-hidden="true">${svg}</span>`;
  if (fleetBtn)  fleetBtn.innerHTML  = `${pillIc(SV_IC.fleet)} Fleet (${fleet})`;
  if (equipBtn)  equipBtn.innerHTML  = `${pillIc(SV_IC.equip)} Equipment (${equip})`;
  if (b350Btn)   b350Btn.innerHTML   = `${pillIc(SV_IC.bldg)} Bldg 350 (${b350})`;
  if (b4050Btn)  b4050Btn.innerHTML  = `${pillIc(SV_IC.bldg)} Bldg 4050 (${b4050})`;
}

/* ── Audit modal ────────────────────────────────────────────────── */
function renderCriteriaGroup(wrap, groupLabel, keys) {
  if (!keys.length) return;
  const group = document.createElement('div');
  group.className = 'cf-audit-group';

  const header = document.createElement('div');
  header.className = 'cf-audit-group-hdr';
  header.innerHTML = `
    <span class="cf-audit-group-label">${esc(groupLabel)}</span>
    <span class="cf-audit-group-count">${keys.length} check${keys.length === 1 ? '' : 's'}</span>
  `;
  group.appendChild(header);

  const bulk = document.createElement('div');
  bulk.className = 'cf-audit-bulk';
  bulk.innerHTML = `
    <button type="button" class="cf-audit-bulk-btn pass" data-bulk="pass">✓ Pass all</button>
    <button type="button" class="cf-audit-bulk-btn fail" data-bulk="fail">✕ Fail all</button>
  `;
  bulk.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bulk]');
    if (!btn) return;
    const state = btn.dataset.bulk === 'pass';
    group.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = state; });
    updateAuditSummary();
  });
  group.appendChild(bulk);

  const list = document.createElement('div');
  list.className = 'cf-audit-criteria';
  keys.forEach((key) => {
    const meta = getCriterionMeta(key);
    const lbl  = document.createElement('label');
    lbl.className = 'cf-audit-crit-item';
    lbl.innerHTML = `
      <input type="checkbox" name="criteria" value="${esc(key)}" checked/>
      <span class="cf-audit-crit-body">
        <span class="cf-audit-crit-label">${esc(meta.label)}</span>
        ${meta.hint ? `<span class="cf-audit-crit-hint">${esc(meta.hint)}</span>` : ''}
      </span>
    `;
    list.appendChild(lbl);
  });
  group.appendChild(list);
  wrap.appendChild(group);
}

function updateAuditSummary() {
  const all   = [...document.querySelectorAll('#auditCriteriaWrap input[name=criteria]')];
  const total = all.length;
  const fails = all.filter((cb) => !cb.checked).length;
  const sum   = $('auditSummary');
  const txt   = $('auditSummaryText');
  if (!sum || !txt) return;
  if (!total) { sum.style.display = 'none'; return; }
  sum.style.display = '';
  if (fails === 0) {
    sum.classList.remove('has-fail');
    txt.textContent = `All ${total} criteria passing — inspection will be marked PASS.`;
  } else {
    sum.classList.add('has-fail');
    txt.textContent = `${fails} of ${total} failing — inspection will be marked FAIL. Add notes in comments.`;
  }
}

function openAuditModal(id, tag, name, category) {
  $('auditAssetId').value = id;
  $('auditModalTitle').textContent = 'Record inspection';
  const tagEl = $('auditModalTag');
  const nameEl = $('auditModalName');
  const catEl = $('auditModalCat');
  if (tagEl) tagEl.textContent = tag || '—';
  if (nameEl) nameEl.textContent = name || '—';
  if (catEl) catEl.textContent = category ? `Category · ${category}` : 'Fleet · preventive maintenance';
  $('auditAuditor').value   = sessionAuditorName;
  $('auditComments').value  = '';

  const wrap = $('auditCriteriaWrap');
  wrap.innerHTML = '';

  // Dedupe: category-specific list wins over common-list duplicates.
  const categoryCriteria = (auditRules[category]?.criteria || []).filter(Boolean);
  const commonCriteria   = COMMON_CRITERIA.filter((k) => !categoryCriteria.includes(k));

  renderCriteriaGroup(wrap, 'General condition', commonCriteria);
  renderCriteriaGroup(
    wrap,
    category ? `${category} — specific checks` : 'Category checks',
    categoryCriteria,
  );

  if (!wrap.dataset.listenerBound) {
    wrap.addEventListener('change', (e) => {
      if (e.target?.name === 'criteria') updateAuditSummary();
    });
    wrap.dataset.listenerBound = '1';
  }
  updateAuditSummary();

  $('auditModal').classList.add('open');
  setTimeout(() => {
    const first = document.querySelector('#auditCriteriaWrap input[type="checkbox"]');
    if (first) first.focus();
    else $('auditAuditor')?.focus();
  }, 60);
}

function closeAuditModal() { $('auditModal').classList.remove('open'); }

$('auditCancelBtn').addEventListener('click', closeAuditModal);
$('auditModal').addEventListener('click', e => { if (e.target === $('auditModal')) closeAuditModal(); });

$('auditForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id     = $('auditAssetId').value;
  const audr   = $('auditAuditor').value.trim();
  const cmts   = $('auditComments').value.trim();
  const checked   = [...document.querySelectorAll('input[name=criteria]:checked')].map(cb => cb.value);
  const unchecked = [...document.querySelectorAll('input[name=criteria]:not(:checked)')].map(cb => cb.value);
  const criteria  = Object.fromEntries([...checked.map(c=>[c,true]),...unchecked.map(c=>[c,false])]);

  try {
    const r = await fetch(`/asset-catalog/bulk-audit`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ assetIds:[Number(id)], auditorName:audr, comments:cmts, criteria, passed:unchecked.length===0 }),
    });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message || r.statusText);
    closeAuditModal();
    await loadData();
  } catch (err) { alert(`Failed: ${err.message}`); }
});

/* ── Calibration modal ──────────────────────────────────────────── */
function openCalModal(id, tag, name, interval) {
  $('calAssetId').value = id;
  $('calModalSub').textContent = `${tag} — ${name}`;
  $('calDate').value     = new Date().toISOString().slice(0,10);
  $('calInterval').value = interval || '';
  $('calNextDue').value  = '';
  $('calModal').classList.add('open');
  setTimeout(() => $('calDate').focus(), 50);
}
function closeCalModal() { $('calModal').classList.remove('open'); }

$('calCancelBtn').addEventListener('click', closeCalModal);
$('calModal').addEventListener('click', e => { if (e.target === $('calModal')) closeCalModal(); });

$('calForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id  = $('calAssetId').value;
  const body = { lastCalibrationDate: $('calDate').value };
  const iv = $('calInterval').value; if (iv) body.calibrationIntervalDays = +iv;
  const nd = $('calNextDue').value;  if (nd) body.nextCalibrationDue = nd;
  try {
    const r = await fetch(`/asset-catalog/${id}/calibration`, {
      method:'PATCH', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message || r.statusText);
    closeCalModal(); await loadData();
  } catch (err) { alert(`Failed: ${err.message}`); }
});

/* ── Checkout / Return (equipment) ─────────────────────────────── */
async function doCheckout(id, tag) {
  const op = prompt(`Check out ${tag}\nEnter Operator ID:`);
  if (!op?.trim()) return;
  sessionStorage.setItem('cf-last-op', op.trim());
  try {
    const r = await fetch(`/asset-catalog/${id}/checkout`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ operatorId: op.trim() }),
    });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message || r.statusText);
    await loadData();
  } catch (err) { alert(`Failed: ${err.message}`); }
}

async function doReturn(id, tag) {
  const cond = confirm(`Return ${tag}\nOK = Good · Cancel = Needs inspection`) ? 'Good' : 'Needs Inspection';
  try {
    const r = await fetch(`/asset-catalog/${id}/checkin`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ condition: cond }),
    });
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).message || r.statusText);
    await loadData();
  } catch (err) { alert(`Failed: ${err.message}`); }
}

/* ── Bulk audit button ──────────────────────────────────────────── */
$('bulkAuditBtn').addEventListener('click', () => {
  const overdue = allAssets.filter(a => a._pm.val === 'overdue' && a.itemType !== 'equipment');
  if (!overdue.length) { alert('No fleet assets currently overdue for inspection.'); return; }
  let auditor = sessionAuditorName?.trim();
  if (!auditor) {
    auditor = prompt(`Bulk audit — ${overdue.length} overdue fleet assets.\nYour name:`);
  }
  if (!auditor?.trim()) return;
  fetch('/asset-catalog/bulk-audit', {
    method:'POST', credentials:'include',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ assetIds: overdue.map(a=>a.id), auditorName:auditor.trim(), passed:true }),
  }).then(r => r.json()).then(() => loadData()).catch(err => alert(err.message));
});

/* ── Sort, filter, search wiring ────────────────────────────────── */
function initSortHeaders() {
  document.querySelectorAll('.cf-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      sortCol === col ? (sortAsc = !sortAsc) : (sortCol = col, sortAsc = true);
      document.querySelectorAll('.cf-table thead th').forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      applyFilters();
    });
  });
}

function initTabStrip() {
  $('assetTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('[data-filter]');
    if (!tab) return;
    $('assetTabs').querySelectorAll('[data-filter]').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
    tab.classList.add('active'); tab.setAttribute('aria-selected','true');
    activeTab = tab.dataset.filter; applyFilters();
  });
}

function initTypeStrip() {
  $('typeStrip')?.addEventListener('click', e => {
    const pill = e.target.closest('[data-type],[data-status],[data-building]');
    if (!pill) return;

    if (pill.hasAttribute('data-building')) {
      // Building pills are independent — toggle on/off, don't clear type/status
      const clickedBldg = pill.dataset.building;
      if (activeBuilding === clickedBldg) {
        // Deselect: back to "all buildings"
        activeBuilding = '';
        pill.classList.remove('active');
      } else {
        $('typeStrip').querySelectorAll('[data-building]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeBuilding = clickedBldg;
      }
    } else {
      // Type/status pills are mutually exclusive among themselves
      $('typeStrip').querySelectorAll('[data-type],[data-status]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      if (pill.hasAttribute('data-type'))   { activeType = pill.dataset.type;   activeStatus = ''; }
      if (pill.hasAttribute('data-status')) { activeStatus = pill.dataset.status; activeType = ''; }
    }
    applyFilters();
  });
}

function initSearch() {
  let timer;
  $('cfSearch')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { searchQ = e.target.value; applyFilters(); }, 180);
  });
}

function initExport() {
  $('exportBtn')?.addEventListener('click', () => {
    const headers = ['Tag #','Type','Name','Category','Location','Building','Status','PM/Cal Status','Serial'];
    const rows = filtered.map(a => [a.tagNumber, a.itemType||'fleet', a.name, a.category||'', a.location||'', a.building||'Bldg-350', a.status, a._pm.label, a.serialNumber||'']);
    const csv = [headers,...rows].map(r => r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv'})), download:`assets_${new Date().toISOString().slice(0,10)}.csv`});
    document.body.appendChild(a); a.click(); a.remove();
  });
}

/* ── Socket ─────────────────────────────────────────────────────── */
function connectSocket() {
  try {
    const s = window.io?.({ withCredentials: true });
    s?.on('assetsUpdated', () => loadData());
  } catch {}
}

/* ── Escape closes modals ───────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('auditModal').classList.contains('open')) closeAuditModal();
  if ($('calModal').classList.contains('open'))   closeCalModal();
});

/* ── Boot ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSessionAuditor();
  // Seed building filter from suite context
  const _b = localStorage.getItem('suite.building.v1');
  if (_b) {
    activeBuilding = _b;
    const bPill = document.querySelector(`[data-building="${_b}"]`);
    if (bPill) {
      document.querySelectorAll('[data-type],[data-status],[data-building]').forEach(p => p.classList.remove('active'));
      bPill.classList.add('active');
    }
  }
  startLiveClock('cfLiveClock');
  initSortHeaders();
  initTabStrip();
  initTypeStrip();
  initSearch();
  initExport();
  await loadData();
  connectSocket();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadData(); });
});
