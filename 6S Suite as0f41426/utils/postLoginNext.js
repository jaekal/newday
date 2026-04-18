// utils/postLoginNext.js
// After login, kiosk-only roles (e.g. technician "user" accounts) skip the suite home and land on the kiosk.
import { roleAccess } from '../config/roleAccess.js';
import { s, lc as normalizeRole } from './text.js';

export function safeNextUrl(next) {
  const n = s(next);
  if (n && n.startsWith('/') && !n.startsWith('//')) return n;
  return '/home';
}

function isKioskOnlyRole(role) {
  const tools = roleAccess[normalizeRole(role)] || [];
  return tools.length === 1 && tools[0] === 'kiosk';
}

/**
 * @param {string} role - user role after login
 * @param {string} [requestedNext] - raw `next` query/body (may be empty)
 * @returns {string} absolute path on this host
 */
export function resolvePostLoginNext(role, requestedNext) {
  const next = safeNextUrl(requestedNext);
  if (isKioskOnlyRole(role) && next === '/home') return '/kiosk/';
  return next;
}
