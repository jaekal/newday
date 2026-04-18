//public/screwdriver/helpers.js

import { state } from './state.js';

/**
 * Debounce with options.
 * @param {Function} fn
 * @param {number} wait
 * @param {{leading?:boolean, trailing?:boolean}} opts
 * @returns {Function & {cancel:Function, flush:Function}}
 */
export function debounce(fn, wait = 250, opts = {}) {
  const leading  = opts.leading  ?? false;
  const trailing = opts.trailing ?? true;

  let timer = null;
  let lastArgs;
  let lastThis;
  let result;
  let invoked = false;

  const invoke = () => {
    timer = null;
    if (trailing && invoked) {
      result = fn.apply(lastThis, lastArgs);
      lastArgs = lastThis = undefined;
      invoked = false;
    }
  };

  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    invoked = true;

    const callNow = leading && !timer;
    clearTimeout(timer);
    timer = setTimeout(invoke, wait);

    if (callNow) {
      invoked = false;
      result = fn.apply(lastThis, lastArgs);
      lastArgs = lastThis = undefined;
    }
    return result;
  };

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastArgs = lastThis = undefined;
    invoked = false;
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      invoke();
    }
    return result;
  };

  return debounced;
}

/* -------------------- Torque helpers -------------------- */

/** Extract a number from a torque string like "8.5", "8.5 Nm", "10 in-lb" (no unit conversion). */
export function torqueToNumber(v) {
  if (v == null) return NaN;
  const m = String(v).match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * Map torque to a bucket class (theme-aware via CSS):
 *  - 'low'    (< low threshold)
 *  - 'target' (== low threshold)
 *  - 'high'   (> high threshold)
 *  - 'alert'  (== high threshold)
 */
export function getTorqueBucket(torque, thresholds = { low: 0.6, high: 1.2 }) {
  const val = torqueToNumber(torque);
  if (!Number.isFinite(val)) return null;
  if (val === thresholds.low)  return 'target';
  if (val === thresholds.high) return 'alert';
  if (val < thresholds.low)    return 'low';
  if (val > thresholds.high)   return 'high';
  return null;
}

// (kept for compatibility if you used it elsewhere)
export function getTorqueColor(torque, thresholds = { low: 0.6, high: 1.2 }) {
  const bucket = getTorqueBucket(torque, thresholds);
  switch (bucket) {
    case 'low':    return 'hsl(142 70% 35%)';
    case 'target': return 'hsl(217 91% 60%)';
    case 'high':   return 'hsl(262 65% 50%)';
    case 'alert':  return 'hsl(0 72% 50%)';
    default:       return 'gray';
  }
}

/* -------------------- Time helpers -------------------- */

/**
 * Format a timestamp as "Xd Yh Zm" (skips zero units). Future times display "0m".
 * @param {string|number|Date} timestamp
 */
export function formatDuration(timestamp) {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return '';
  let diff = Date.now() - ms;
  if (diff < 0) diff = 0;

  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const d = Math.floor(diff / DAY);
  diff -= d * DAY;
  const h = Math.floor(diff / HOUR);
  diff -= h * HOUR;
  const m = Math.floor(diff / MIN);

  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

/* -------------------- CSV helpers -------------------- */

/** Prevent CSV/Excel formula injection by prefixing dangerous leading chars. */
function neutralizeFormulaCell(str) {
  if (!str) return str;
  // If the first char is one of = + - @, prefix with a single quote.
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

/** Safe CSV cell with quotes and formula injection protection. */
function csvCell(v) {
  // represent undefined/null as empty string, keep numbers/booleans as-is
  let s = v == null ? '' : String(v);
  s = neutralizeFormulaCell(s);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Build CRLF-joined CSV string with UTF-8 BOM for Excel friendliness. */
function buildCsv(headers, rows) {
  const head = headers.map(csvCell).join(',');
  const body = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  // UTF-8 BOM so Excel recognizes encoding
  return '\uFEFF' + head + '\r\n' + body + '\r\n';
}

/**
 * Download a text payload as a file.
 * @param {string} text
 * @param {string} filename
 * @param {string} mime
 */
function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export tools to CSV.
 * By default includes: Serial Number, Operator ID, Operator Name, Torque, Duration, Status, Classification.
 * You can pass a custom columns descriptor to control what gets exported.
 *
 * @param {Array<object>} tools
 * @param {string} [filename]
 * @param {Array<{header:string, value:(t:object)=>any}>} [columns]
 */
export function exportCSV(
  tools,
  filename = `tools_${new Date().toISOString().slice(0,10)}.csv`,
  columns
) {
  const defaultColumns = [
    { header: 'Serial Number',   value: t => t.serialNumber || '' },
    { header: 'Operator ID',     value: t => (t.operatorId || '').toUpperCase() },
    { header: 'Operator Name',   value: t => {
        const id = (t.operatorId || '').toLowerCase();
        return state.employeeMap?.[id] || t.operatorName || '';
      }},
    { header: 'Torque',          value: t => t.torque ?? '' },
    { header: 'Duration',        value: t => t.timestamp ? formatDuration(t.timestamp) : '' },
    { header: 'Status',          value: t => t.status || '' },
    { header: 'Classification',  value: t => t.classification || '' }
  ];

  const cols = Array.isArray(columns) && columns.length ? columns : defaultColumns;
  const headers = cols.map(c => c.header);
  const rows = (tools || []).map(t => cols.map(c => c.value(t)));

  const csv = buildCsv(headers, rows);
  downloadText(csv, filename, 'text/csv;charset=utf-8');
}
