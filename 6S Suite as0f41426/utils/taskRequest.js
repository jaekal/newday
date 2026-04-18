// utils/taskRequest.js
//
// Shared request-shaping helpers for the project/audit task routes.
// Previously the same logic was duplicated (with small, drift-prone
// differences) between routes/audits.js, routes/projects.js, and
// services/taskService.js.

import { s } from './text.js';

/**
 * Derive a coherent owner identity from an incoming request body and the
 * current session user. Falls back to session values when the body omits
 * owner fields, and additionally honors body.meta.owner (used by the
 * project routes and kiosk submissions).
 *
 * @param {object} body - request body (may be empty)
 * @param {object|null} sessionUser - authenticated user, if any
 * @returns {{ ownerId: string, ownerName: string, ownerLabel: string }}
 */
export function ownerFromRequest(body = {}, sessionUser = null) {
  const b = body || {};
  const u = sessionUser || {};
  const fallbackId   = s(u.id || u.username || '');
  const fallbackName = s(u.name || u.username || u.id || '');
  const metaOwner    = s(b.meta?.owner || '');

  const ownerId    = s(b.ownerId    || metaOwner || fallbackId);
  const ownerName  = s(b.ownerName  || metaOwner || fallbackName || fallbackId);
  const ownerLabel = s(b.ownerLabel || ownerName || ownerId || fallbackName || fallbackId);

  return { ownerId, ownerName, ownerLabel };
}

/**
 * Convenience wrapper for Express-style handlers — passes req.body and
 * req.session.user through to ownerFromRequest.
 *
 * @param {import('express').Request} req
 * @returns {{ ownerId: string, ownerName: string, ownerLabel: string }}
 */
export function ownerFromReq(req) {
  return ownerFromRequest(req?.body || {}, req?.session?.user || null);
}

export default { ownerFromRequest, ownerFromReq };
