const DEFAULT_BUILDING = 'Bldg-350';
const BUILDINGS = Object.freeze([
  { value: 'Bldg-350', label: 'Building 350' },
  { value: 'Bldg-4050', label: 'Building 4050' },
]);

function s(v) {
  return v == null ? '' : String(v).trim();
}

export function getBuildingOptions() {
  return BUILDINGS.slice();
}

export function normalizeBuilding(value, { allowBlank = true, fallback = DEFAULT_BUILDING } = {}) {
  const raw = s(value);
  if (!raw) return allowBlank ? '' : fallback;

  const digits = raw.replace(/[^0-9]/g, '');
  if (digits === '350') return 'Bldg-350';
  if (digits === '4050') return 'Bldg-4050';

  const exact = BUILDINGS.find((item) => item.value.toLowerCase() === raw.toLowerCase());
  if (exact) return exact.value;

  return allowBlank ? raw : fallback;
}

export function buildingLabel(value) {
  const normalized = normalizeBuilding(value, { allowBlank: false });
  return BUILDINGS.find((item) => item.value === normalized)?.label || normalized;
}

export function assignedBuildingFor(user) {
  return normalizeBuilding(user?.building, { allowBlank: true });
}

export function isCrossBuildingChange(user, targetBuilding) {
  const assigned = assignedBuildingFor(user);
  const target = normalizeBuilding(targetBuilding, { allowBlank: true });
  return Boolean(assigned && target && assigned !== target);
}

export { BUILDINGS, DEFAULT_BUILDING };
