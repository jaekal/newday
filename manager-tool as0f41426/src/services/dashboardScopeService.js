// src/services/dashboardScopeService.js
export function norm(v) {
  return String(v ?? '').trim();
}

export function uniqSorted(list) {
  return [...new Set((list || []).map((x) => norm(x)).filter(Boolean))].sort();
}

export function getScopeFromViewer(viewer) {
  const role = viewer?.role || '';
  const profile = viewer?.StaffProfile || null;
  const managerScopes = viewer?.ManagerScopes || [];

  if (role === 'ADMIN') {
    return {
      mode: 'all',
      allowedBuildings: [],
      allowedShifts: [],
      allowedPairs: [],
    };
  }

  if (role === 'MANAGER' || role === 'SENIOR_MANAGER') {
    const allowedPairs = managerScopes
      .map((s) => ({ building: norm(s.building), shift: norm(s.shift) }))
      .filter((x) => x.building && x.shift);

    if (allowedPairs.length) {
      return {
        mode: 'manager-scope',
        allowedBuildings: uniqSorted(allowedPairs.map((x) => x.building)),
        allowedShifts: uniqSorted(allowedPairs.map((x) => x.shift)),
        allowedPairs,
      };
    }
  }

  const building = norm(profile?.building);
  const shift = norm(profile?.shift);

  return {
    mode: 'profile',
    allowedBuildings: building ? [building] : [],
    allowedShifts: shift ? [shift] : [],
    allowedPairs: building && shift ? [{ building, shift }] : [],
  };
}

export function isUserInScope(user, scope) {
  if (!scope || scope.mode === 'all') return true;

  const p = user?.StaffProfile || null;
  const building = norm(p?.building);
  const shift = norm(p?.shift);

  if (!building || !shift) return false;

  return scope.allowedPairs.some((x) => x.building === building && x.shift === shift);
}