// utils/csv.js
// Minimal CSV cell hardening to prevent formula injection in spreadsheet apps.
// Strategy: prefix risky-leading characters with a single quote.
// This module is now the canonical CSV sanitizer for the app.

const DANGEROUS_LEAD = /^[=+\-@ \t\r]/;

/** Sanitize a single cell (strings only; leaves numbers/booleans intact). */
export function csvSafeCell(v) {
  if (v == null) return '';
  if (typeof v !== 'string') return v;
  const s = v;
  return DANGEROUS_LEAD.test(s) ? `'${s}` : s;
}

/** Sanitize every string value in a flat object (used for json2csv rows). */
export function csvSafeObject(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? csvSafeCell(v) : v;
  }
  return out;
}

/** Sanitize an array of cell values (used when hand-building CSV rows). */
export function csvSafeRow(arr = []) {
  return arr.map(v => (typeof v === 'string' ? csvSafeCell(v) : v));
}

/**
 * Alias for backwards compatibility with older utilities that used `csvSafe`
 * from csvSafe.js. For a single value, this behaves like csvSafeCell.
 */
export function csvSafe(v) {
  return csvSafeCell(v);
}
