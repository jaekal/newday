// src/constants/roles.js
// Central role definitions — import from here instead of hardcoding arrays in route files.

export const ALL_ROLES = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD', 'STAFF'];

// Role groups for ensureRole() usage
export const ADMIN_ONLY           = ['ADMIN'];
export const ADMIN_AND_UP         = ['ADMIN'];                                                          // alias for clarity
export const MANAGEMENT_AND_UP    = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER'];
export const SUPERVISOR_AND_UP    = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR'];
export const LEAD_AND_UP          = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD'];
export const ALL_AUTHENTICATED    = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD', 'STAFF'];

// Semantic aliases used across the app
export const REVIEW_WRITER_ROLES  = LEAD_AND_UP;           // can create/edit reviews
export const REVIEW_VIEWER_ROLES  = SUPERVISOR_AND_UP;     // can see submitted reviews list
export const CALIBRATION_ROLES    = SUPERVISOR_AND_UP;     // can access calibration
export const GOAL_ROLES           = LEAD_AND_UP;           // can access goals
export const INCIDENT_FORM_ROLES  = LEAD_AND_UP;           // can create/edit incidents
export const ASSIGNMENT_ROLES     = SUPERVISOR_AND_UP;     // can manage assignments
export const IMPORT_EXPORT_ROLES  = SUPERVISOR_AND_UP;     // can import/export data
export const USER_MGMT_ROLES      = MANAGEMENT_AND_UP;     // can manage users
export const CALENDAR_ROLES       = LEAD_AND_UP;           // can access calendar

// ── Role predicate helpers ────────────────────────────────────────────────────

export function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

export function isAdmin(role) {
  return normalizeRole(role) === 'ADMIN';
}

export function isSeniorManager(role) {
  return normalizeRole(role) === 'SENIOR_MANAGER';
}

export function isManager(role) {
  const r = normalizeRole(role);
  return r === 'MANAGER' || r === 'SENIOR_MANAGER';
}

export function isSupervisor(role) {
  return normalizeRole(role) === 'SUPERVISOR';
}

export function isLead(role) {
  return normalizeRole(role) === 'LEAD';
}

export function isStaff(role) {
  return normalizeRole(role) === 'STAFF';
}

export function isManagementOrAbove(role) {
  return MANAGEMENT_AND_UP.includes(normalizeRole(role));
}

export function isSupervisorOrAbove(role) {
  return SUPERVISOR_AND_UP.includes(normalizeRole(role));
}

export function isLeadOrAbove(role) {
  return LEAD_AND_UP.includes(normalizeRole(role));
}
