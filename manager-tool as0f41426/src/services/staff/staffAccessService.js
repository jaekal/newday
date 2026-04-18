// src/services/staff/staffAccessService.js
import { User, StaffProfile, ManagerScope } from '../../models/index.js';

function norm(v) {
  return String(v ?? '').trim();
}

function upper(v) {
  return norm(v).toUpperCase();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function uniqSorted(list) {
  return [...new Set((list || []).map(norm).filter(Boolean))].sort();
}

function normalizeDomainUsername(value) {
  let v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  const slashIdx = v.lastIndexOf('\\');
  if (slashIdx !== -1) v = v.slice(slashIdx + 1);
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(0, atIdx);
  return v.replace(/^"+|"+$/g, '').trim();
}

function normalizeEmploymentStatus(value, fallback = 'ACTIVE') {
  const v = upper(value);
  return ['ACTIVE', 'RESIGNED', 'TERMINATED'].includes(v) ? v : fallback;
}

function isInactiveEmploymentStatus(value) {
  const v = normalizeEmploymentStatus(value, 'ACTIVE');
  return v === 'RESIGNED' || v === 'TERMINATED';
}

/* ─────────────────────────────────────────────────────────────
 * Compatibility helpers used by other staff services
 * ───────────────────────────────────────────────────────────── */
export function formatTimeLabel(value) {
  if (value == null || value === '') return '—';

  const raw = String(value).trim();
  if (!raw) return '—';

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  const hhmm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) {
    let hours = Number(hhmm[1]);
    const minutes = hhmm[2];
    const suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${suffix}`;
  }

  return raw;
}

export function getShiftMeta(shiftValue) {
  const shift = upper(shiftValue);

  const SHIFT_MAP = {
    '1ST': { label: '1st Shift', shortLabel: '1st', rank: 1, tone: 'day' },
    'FIRST': { label: '1st Shift', shortLabel: '1st', rank: 1, tone: 'day' },
    'DAY': { label: 'Day Shift', shortLabel: 'Day', rank: 1, tone: 'day' },

    '2ND': { label: '2nd Shift', shortLabel: '2nd', rank: 2, tone: 'swing' },
    'SECOND': { label: '2nd Shift', shortLabel: '2nd', rank: 2, tone: 'swing' },

    '3RD': { label: '3rd Shift', shortLabel: '3rd', rank: 3, tone: 'night' },
    'THIRD': { label: '3rd Shift', shortLabel: '3rd', rank: 3, tone: 'night' },
    'NIGHT': { label: 'Night Shift', shortLabel: 'Night', rank: 3, tone: 'night' },

    'WEEKEND': { label: 'Weekend Shift', shortLabel: 'Weekend', rank: 4, tone: 'weekend' },
    'WKND': { label: 'Weekend Shift', shortLabel: 'Weekend', rank: 4, tone: 'weekend' },
    'WEEKEND DAYS': { label: 'Weekend Days', shortLabel: 'Weekend', rank: 4, tone: 'weekend' },
    'WEEKEND NIGHTS': { label: 'Weekend Nights', shortLabel: 'Weekend', rank: 4, tone: 'weekend' },
  };

  if (SHIFT_MAP[shift]) return SHIFT_MAP[shift];

  return {
    label: norm(shiftValue) || 'Unknown Shift',
    shortLabel: norm(shiftValue) || 'Unknown',
    rank: 99,
    tone: 'neutral',
  };
}

export function defaultFilters(overrides = {}) {
  return {
    q: '',
    rosterBuilding: '',
    rosterShift: '',
    positionType: '',
    sortBy: 'name',
    sortDir: 'ASC',
    ...overrides,
  };
}

export function buildPaginationForStaff({
  page = 1,
  pageSize = 25,
  showAll = false,
  totalUsers = 0,
  rowsOnPage = 0,
} = {}) {
  const safeShowAll = !!showAll;

  if (safeShowAll) {
    return {
      page: 1,
      pageSize: 'all',
      showAll: true,
      totalUsers,
      totalPages: 1,
      from: totalUsers > 0 ? 1 : 0,
      to: totalUsers,
    };
  }

  const safePageSize = Math.max(1, Number(pageSize) || 25);
  const totalPages = Math.max(1, Math.ceil(totalUsers / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const offset = (safePage - 1) * safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    showAll: false,
    totalUsers,
    totalPages,
    from: totalUsers > 0 ? offset + 1 : 0,
    to: totalUsers > 0 ? Math.min(offset + rowsOnPage, totalUsers) : 0,
  };
}

export function computeProfileHealth(staff) {
  const profile = staff?.StaffProfile || {};
  let missing = 0;

  if (!staff?.name) missing++;
  if (!staff?.email) missing++;
  if (!profile?.employeeId) missing++;
  if (!profile?.positionType) missing++;
  if (!profile?.building) missing++;
  if (!profile?.shift) missing++;

  if (missing === 0) return { label: 'Complete', tone: 'good', rank: 3 };
  if (missing <= 2) return { label: 'Needs Review', tone: 'warn', rank: 2 };
  return { label: 'Incomplete', tone: 'bad', rank: 1 };
}

/* ─────────────────────────────────────────────────────────────
 * Viewer helpers
 * ───────────────────────────────────────────────────────────── */
export async function getViewer(req) {
  const idRaw = req.session?.userId;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;

  return User.findByPk(id, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });
}

export function parsePagination(query = {}) {
  const pageSizeRaw = norm(query.pageSize || '25');
  const page = Math.max(1, Number(query.page || 1));
  const showAll = pageSizeRaw === 'all';
  const pageSize = showAll ? 999999 : Math.max(10, Math.min(100, Number(pageSizeRaw) || 25));

  return { page, pageSize, showAll };
}

export function buildRosterMap(rosterRows = []) {
  const byDomain = new Map();
  const byEmail = new Map();
  const byEmployeeId = new Map();

  (rosterRows || []).forEach((r) => {
    const dn = normalizeDomainUsername(r?.domainUsername);
    const em = lower(r?.email);
    const ei = norm(r?.employeeId);

    if (dn) byDomain.set(dn, r);
    if (em) byEmail.set(em, r);
    if (ei) byEmployeeId.set(ei, r);
  });

  return { byDomain, byEmail, byEmployeeId };
}

function getManagerScopePairs(viewer) {
  const scopes = viewer?.ManagerScopes || [];
  return scopes
    .map((s) => ({
      building: norm(s.building),
      shift: norm(s.shift),
    }))
    .filter((x) => x.building && x.shift);
}

function getRosterIdentity(staff, rosterMap) {
  const profile = staff?.StaffProfile || null;

  const domainFromProfile = normalizeDomainUsername(profile?.domainUsername || profile?.domainName || '');
  const domainFromUser = normalizeDomainUsername(staff?.username || '');
  const emailKey = lower(staff?.email || '');
  const employeeId = norm(profile?.employeeId || '');

  const roster =
    (domainFromProfile && rosterMap?.byDomain?.get(domainFromProfile)) ||
    (domainFromUser && rosterMap?.byDomain?.get(domainFromUser)) ||
    (emailKey && rosterMap?.byEmail?.get(emailKey)) ||
    (employeeId && rosterMap?.byEmployeeId?.get(employeeId)) ||
    null;

  return roster || null;
}

export function getEffectiveRosterBuildingShift(staff, rosterMap) {
  const profile = staff?.StaffProfile || {};
  const roster = getRosterIdentity(staff, rosterMap);

  return {
    rosterBuilding: norm(roster?.building || profile?.building || ''),
    rosterShift: norm(roster?.shift || profile?.shift || ''),
  };
}

export function staffVisibilityWhere(viewer) {
  const role = upper(viewer?.role);

  if (role === 'ADMIN' || role === 'SENIOR_MANAGER' || role === 'MANAGER') {
    return {};
  }

  return {
    employmentStatus: 'ACTIVE',
    isEnabled: true,
  };
}

export function canViewerAccessStaff(viewer, staff, rosterMap) {
  const viewerRole = upper(viewer?.role);
  const staffStatus = normalizeEmploymentStatus(staff?.employmentStatus, 'ACTIVE');

  if ((viewerRole === 'LEAD' || viewerRole === 'SUPERVISOR') && isInactiveEmploymentStatus(staffStatus)) {
    return false;
  }

  if (viewerRole === 'ADMIN' || viewerRole === 'SENIOR_MANAGER' || viewerRole === 'MANAGER') {
    return true;
  }

  const scopePairs = getManagerScopePairs(viewer);
  if (!scopePairs.length) {
    return true;
  }

  const eff = getEffectiveRosterBuildingShift(staff, rosterMap);
  if (!eff.rosterBuilding || !eff.rosterShift) return false;

  return scopePairs.some(
    (s) => s.building === eff.rosterBuilding && s.shift === eff.rosterShift
  );
}

export function scopeStaffByRosterBuildingShift(baseStaff = [], viewer, rosterMap) {
  const role = upper(viewer?.role);
  let rows = [...(baseStaff || [])];

  if (role === 'ADMIN') {
    return rows;
  }

  if (role === 'MANAGER' || role === 'SENIOR_MANAGER') {
    const scopePairs = getManagerScopePairs(viewer);
    if (!scopePairs.length) return [];

    return rows.filter((s) => {
      const eff = getEffectiveRosterBuildingShift(s, rosterMap);
      return scopePairs.some(
        (pair) => pair.building === eff.rosterBuilding && pair.shift === eff.rosterShift
      );
    });
  }

  if (role === 'SUPERVISOR' || role === 'LEAD') {
    return rows.filter((s) => {
      const status = normalizeEmploymentStatus(s?.employmentStatus, 'ACTIVE');
      return status === 'ACTIVE' && !!s?.isEnabled;
    });
  }

  return rows.filter((s) => {
    const status = normalizeEmploymentStatus(s?.employmentStatus, 'ACTIVE');
    return status === 'ACTIVE' && !!s?.isEnabled;
  });
}

export function computeFilterOptionsFromStaff(scopedStaff = [], rosterMap) {
  const rosterBuildingOptions = uniqSorted(
    scopedStaff.map((s) => getEffectiveRosterBuildingShift(s, rosterMap).rosterBuilding).filter(Boolean)
  );

  const rosterShiftOptions = uniqSorted(
    scopedStaff.map((s) => getEffectiveRosterBuildingShift(s, rosterMap).rosterShift).filter(Boolean)
  );

  const positionTypeOptions = uniqSorted(
    scopedStaff.map((s) => s?.StaffProfile?.positionType).filter(Boolean)
  );

  return {
    rosterBuildingOptions,
    rosterShiftOptions,
    positionTypeOptions,
  };
}

export function computeTenureLabel(startDate) {
  if (!startDate) return null;

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const now = new Date();

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();

  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years <= 0 && months <= 0) return '< 1 mo';
  if (years <= 0) return `${months} mo`;
  if (months === 0) return `${years} yr${years === 1 ? '' : 's'}`;
  return `${years} yr${years === 1 ? '' : 's'} ${months} mo`;
}