
//public/screwdriver/filters.js

import { state }      from './state.js';
import { renderTools } from './render.js';

/**
 * Normalize a string for case-insensitive comparisons.
 */
function norm(v) {
  return (v == null ? '' : String(v)).trim().toLowerCase();
}

/**
 * Best-effort numeric extraction from a torque string.
 * Examples: "12", "12 Nm", "8.5 in-lb" -> 12, 12, 8.5
 * NOTE: no unit conversion is attempted—just numeric parsing.
 */
function torqueToNumber(v) {
  if (v == null) return NaN;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * Build a predicate function for the torque filter input.
 * Supports:
 *  - exact string match (legacy behavior) → when not numeric-looking
 *  - ranges: "10-20"
 *  - comparisons: ">=10", "<5", "> 2.5", "<= 8"
 */
function buildTorquePredicate(inputRaw) {
  const input = norm(inputRaw);
  if (!input) return () => true;

  // Range: "a-b"
  const range = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (range) {
    const min = parseFloat(range[1]);
    const max = parseFloat(range[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return (tool) => {
        const n = torqueToNumber(tool.torque);
        return Number.isFinite(n) && n >= min && n <= max;
      };
    }
  }

  // Comparison: <=, >=, <, >
  const cmp = input.match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (cmp) {
    const op = cmp[1];
    const val = parseFloat(cmp[2]);
    if (Number.isFinite(val)) {
      return (tool) => {
        const n = torqueToNumber(tool.torque);
        if (!Number.isFinite(n)) return false;
        switch (op) {
          case '<':  return n <  val;
          case '>':  return n >  val;
          case '<=': return n <= val;
          case '>=': return n >= val;
          default:   return true;
        }
      };
    }
  }

  // Fallback: case-insensitive exact string equality with normalized value
  const wanted = input;
  return (tool) => norm(tool.torque) === wanted;
}

/**
 * Reads allTools from state, applies the current UI filter values,
 * updates state.filteredTools, then re-renders.
 */
export function applyFilters() {
  // 1) Start from a copy
  let list = Array.isArray(state.allTools) ? [...state.allTools] : [];

  // 2) Read filter values
  const searchTerm    = norm(document.getElementById('search')?.value);
  const classFilter   = norm(document.getElementById('classificationFilter')?.value);
  const calibFilter   = norm(document.getElementById('calibrationFilter')?.value);
  const statusFilter  = norm(document.getElementById('statusFilter')?.value);
  const torqueFilter  = norm(document.getElementById('torqueFilter')?.value);
  const sortBy        = norm(document.getElementById('sortFilter')?.value);
  const buildingFilter = (document.getElementById('buildingFilter')?.value || '').trim();

  // Pre-build predicate helpers
  const torquePred = buildTorquePredicate(torqueFilter);

  // 3) Compose a single predicate for performance/readability
const serialTerms = state.filters?.searchSerials instanceof Set
  ? Array.from(state.filters.searchSerials).map(norm).filter(Boolean)
  : [];

const rawTerms = searchTerm
  ? searchTerm.split(/[\n,;]+|(?<!-)\s+/).map(t => t.trim()).filter(Boolean)
  : [];

const generalTerms = rawTerms.filter(term => !serialTerms.includes(norm(term)));

function getSearchableValues(tool) {
  return [
    tool.serialNumber,
    tool.description,
    tool.model,
    tool.classification,
    tool.slot,
    tool.torque,
    tool.status,
    tool.building,
    tool.operatorId,
    tool.operatorName,
    tool.calibrationStatus,
    tool.calibrationDate,
    tool.nextCalibrationDue
  ]
    .map(norm)
    .filter(Boolean);
}

function matchesSearch(tool) {
  const searchableValues = getSearchableValues(tool);
  const haystack = searchableValues.join(' ');
  const serial = norm(tool.serialNumber);

  // Serial numbers use OR logic:
  // if user pasted multiple serials, show any tool whose serial matches one of them
  const serialMatch = !serialTerms.length || serialTerms.some(sn => serial.includes(sn));

  if (!serialMatch) return false;

  // General terms still use AND logic across searchable fields
  for (const term of generalTerms) {
    if (!term) continue;

    if (term.startsWith('-')) {
      const neg = norm(term.slice(1));
      if (neg && haystack.includes(neg)) return false;
      continue;
    }

    const wanted = norm(term);
    const matched = searchableValues.some(value => value.includes(wanted));
    if (!matched) return false;
  }

  return true;
}
  function matchesDropdowns(tool) {
    if (classFilter  && norm(tool.classification)  !== classFilter)  return false;
    if (calibFilter) {
      const dueMs = tool.nextCalibrationDue ? new Date(tool.nextCalibrationDue).getTime() : NaN;
      const now = Date.now();
      const now14 = now + 14 * 86400000;
      if (calibFilter === 'expiring soon') {
        if (!Number.isFinite(dueMs) || dueMs < now || dueMs > now14) return false;
      } else if (calibFilter === 'expired') {
        if (!Number.isFinite(dueMs) || dueMs >= now) return false;
      } else if (norm(tool.calibrationStatus) !== calibFilter) {
        return false;
      }
    }
    if (statusFilter && norm(tool.status)          !== statusFilter) return false;
    if (buildingFilter && buildingFilter !== 'all') {
      const toolBuilding = (tool.building || 'Bldg-350');
      if (toolBuilding !== buildingFilter) return false;
    }
    return true;
  }

  list = list.filter(tool => matchesSearch(tool) && matchesDropdowns(tool) && torquePred(tool));

  // 4) Sorting (stable)
  // decorate for stability
  const decorated = list.map((item, idx) => ({ item, idx }));

  const bySerial = (a, b) => (norm(a.item.serialNumber)).localeCompare(norm(b.item.serialNumber));

  if (sortBy === 'torque') {
    decorated.sort((a, b) => {
      const na = torqueToNumber(a.item.torque);
      const nb = torqueToNumber(b.item.torque);
      if (Number.isFinite(na) && Number.isFinite(nb)) {
        if (na !== nb) return na - nb;
        return bySerial(a, b);
      }
      if (Number.isFinite(na)) return -1;
      if (Number.isFinite(nb)) return 1;
      return bySerial(a, b);
    });
  } else if (sortBy === 'status') {
    // Optional custom order: being used < in inventory (adjust to taste)
    const order = { 'being used': 0, 'in inventory': 1 };
    decorated.sort((a, b) => {
      const sa = norm(a.item.status);
      const sb = norm(b.item.status);
      const oa = order[sa] ?? 99;
      const ob = order[sb] ?? 99;
      if (oa !== ob) return oa - ob;
      return bySerial(a, b);
    });
  } else if (sortBy === 'duration') {
    // Sort by timestamp ascending (oldest first). Empty timestamps last.
    decorated.sort((a, b) => {
      const ta = Date.parse(a.item.timestamp) || Number.POSITIVE_INFINITY;
      const tb = Date.parse(b.item.timestamp) || Number.POSITIVE_INFINITY;
      if (ta !== tb) return ta - tb;
      return bySerial(a, b);
    });
  } else {
    // Default: serialNumber ascending
    decorated.sort(bySerial);
  }

  // 5) Global sort direction
  if (!state.sortAsc) decorated.reverse();

  // 6) Commit & render
  state.filteredTools = decorated.map(d => d.item);
  renderTools();

  // 7) Keep sort-direction button UI in sync
  const dirBtn = document.getElementById('sortDirectionToggle');
  if (dirBtn) {
    const asc = state.sortAsc;
    dirBtn.textContent = asc ? '▲' : '▼';
    const label = asc ? 'Sort ascending' : 'Sort descending';
    dirBtn.setAttribute('aria-label', label);
    dirBtn.title = label;
  }
}
