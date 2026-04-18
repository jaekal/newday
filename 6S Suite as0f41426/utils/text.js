// utils/text.js
//
// Tiny string-coercion helpers used all over the codebase. They existed in
// 20+ files as ad-hoc one-liners before this module was introduced.
//
// IMPORTANT: the semantics are intentionally "coerce and trim to an empty
// string" (NOT null). Code that needs null-on-empty (see e.g. the Sequelize
// model setters) should keep its own variant.

export function s(v) {
  return (v == null ? '' : String(v)).trim();
}

export function lc(v) {
  return s(v).toLowerCase();
}

export default { s, lc };
