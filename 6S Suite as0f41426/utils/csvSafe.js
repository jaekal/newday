// utils/csvSafe.js
// Deprecated compatibility wrapper. Prefer importing from './csv.js' directly.
//
// Old usage:
//   import { csvSafe, csvSafeRow } from './csvSafe.js';
//
// New preferred usage:
//   import { csvSafeCell, csvSafeObject, csvSafeRow } from './csv.js';

import { csvSafeCell, csvSafeObject } from './csv.js';

const DANGEROUS = /^[=\-+@\t]/;

/**
 * Backwards-compatible alias: sanitize a single value.
 * For strings, this applies the same protection as csvSafeCell.
 */
export function csvSafe(v) {
  if (v == null) return '';
  const s = String(v);
  // Keep the original behavior for callers that relied on this regex:
  return DANGEROUS.test(s) ? `'${s}` : s;
}

/**
 * Backwards-compatible alias: sanitize all string values in an object.
 * Delegates to csvSafeObject to keep semantics in sync.
 */
export function csvSafeRow(obj) {
  return csvSafeObject(obj);
}
