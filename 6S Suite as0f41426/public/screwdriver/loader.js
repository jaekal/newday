// public/screwdriver/loader.js
import { getTools, getEmployees } from './api.js';
import { state } from './state.js';
import { updateSummaryPanel, populateTorqueFilter } from './render.js';
import { applyFilters } from './filters.js';

function normalizeTool(raw = {}) {
  const serialNumber =
    raw.serialNumber ?? raw.serial ?? raw.serial_number ?? raw.SerialNumber ?? raw.Serial ?? '';

  const rawStatus = (raw.status ?? raw.Status ?? '').toString().toLowerCase();
  const status =
    rawStatus === 'being used' ? 'being used'
    : rawStatus === 'in inventory' ? 'in inventory'
    : (raw.operatorId || raw.checkedOutAt || raw.checked_at) ? 'being used'
    : 'in inventory';

  const operatorId = (raw.operatorId ?? raw.OperatorId ?? raw.operator ?? '').toString().toLowerCase();

  const timestamp = raw.timestamp ?? raw.checkedOutAt ?? raw.checked_at ?? raw.Timestamp ?? null;

  // NEW: tolerate legacy calibration keys
  const calibrationStatus = raw.calibrationStatus ?? raw.calibrationstatus ?? '';
  const calibrationDate   = raw.calibrationDate   ?? raw.lastCalibrationDate ?? '';

  return {
    ...raw,
    serialNumber: String(serialNumber || ''),
    operatorId,
    status,
    timestamp,
    calibrationStatus,
    calibrationDate,
  };
}

function normalizeEmployee(raw = {}) {
  const id =
    raw.id ?? raw.employeeId ?? raw.empId ?? raw.badge ?? raw.userId ?? raw.username ?? raw.EmployeeID ?? '';

  const name =
    raw.name ?? raw.fullName ?? raw.FullName ?? raw.displayName ?? raw.DisplayName ?? raw.username ?? (String(id) || '');

  const shift = raw.shift ?? raw.Shift ?? raw.team ?? undefined;

  return {
    id: String(id).toLowerCase(),
    name: String(name),
    shift
  };
}

export async function fetchAndRenderAll() {
  try {
    const [tRes, eRes] = await Promise.allSettled([getTools(), getEmployees()]);

    const toolsArray = tRes.status === 'fulfilled' && Array.isArray(tRes.value) ? tRes.value : [];
    const normalizedTools = toolsArray.map(normalizeTool);
    const dedupMap = new Map();
    for (const t of normalizedTools) if (t.serialNumber) dedupMap.set(t.serialNumber, t);
    state.allTools = Array.from(dedupMap.values());

    const emps = eRes.status === 'fulfilled' && Array.isArray(eRes.value) ? eRes.value : [];
    const normalizedEmps = emps.map(normalizeEmployee);
    state.employeeMap   = normalizedEmps.reduce((acc, e) => (e.id ? (acc[e.id] = e.name || '', acc) : acc), {});
    state.employeeShift = normalizedEmps.reduce((acc, e) => (e.id && e.shift != null ? (acc[e.id] = e.shift, acc) : acc), {});

    populateTorqueFilter();
    applyFilters();
    updateSummaryPanel();
    state.error = null;
  } catch (err) {
    console.error('fetchAndRenderAll error:', err);
    state.error = err?.message || String(err);
    window?.notyf?.error?.(state.error);
  }
}
