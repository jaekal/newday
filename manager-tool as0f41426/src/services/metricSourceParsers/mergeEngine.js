// src/services/metricSourceParsers/mergeEngine.js
// Merges parsed rows from all 6 sources into consolidated metric + presence rows
// keyed by (employeeId, date, shift). Output matches the existing import pipeline schema.

function baseKey(row) {
  const emp = String(row.employeeId || '').trim();
  const date = String(row.date || '').trim();
  return `${emp}|${date}`;
}

function assignFields(target, source, fields) {
  for (const field of fields) {
    const val = source[field];
    if (val !== '' && val !== undefined && val !== null) {
      target[field] = val;
    }
  }
}

// All TechnicianDailyMetric fields that each source can contribute
const MES_FIELDS = [
  'building', 'area', 'productFamily',
  'serversAssigned', 'serversCompleted', 'racksAssigned', 'racksCompleted',
  'expectedCheckActions', 'validCheckActions', 'inspectionsExpected', 'inspectionsCompleted',
  'unitsRepaired', 'unitsHandled', 'unitsPassed',
  'excludedSystemDelayMinutes', 'excludedPartWaitMinutes', 'excludedInfraMinutes',
  'complexityMultiplier', 'sourceBatchId',
];

const TEST_DASH_FIELDS = [
  'testStage',
  'unitsPassedFirstRerun', 'unitsEventuallyPassed', 'successfulReruns', 'totalReruns',
  'escalatedUnits', 'totalFailedUnitsWorked',
  'totalAttemptsToPass', 'passedRepairUnitCount', 'mttrMinutesTotal', 'mttrSampleCount',
  'postTestEscapes', 'repeatFailures', 'repairedUnitsForRepeatCheck',
  'inspectionIssuesCaught', 'totalIssuesFound',
  'incorrectRepairActions', 'totalRepairActions', 'technicianAttributedDefects',
];

const ATTENDANCE_METRIC_FIELDS = [
  'building', 'area',
  'scheduledShifts', 'shiftsAttendedOnTime', 'daysWorked', 'infractionPoints',
];

const ESD_METRIC_FIELDS = [
  'daysWithSuccessfulEsd', 'esdFirstPassDays', 'totalEsdDays',
];

const TRAINING_METRIC_FIELDS = [
  'plannedCrossTrainingModules', 'completedCrossTrainingModules',
];

const MANUAL_METRIC_FIELDS = [
  'knowledgeSharingEvents', 'ciParticipationEvents', 'leadershipSupportEvents', 'notes',
];

// Presence fields contributed by each source
const ATTENDANCE_PRESENCE_FIELDS = [
  'building', 'shift', 'area',
  'wasScheduled', 'wasPresent', 'wasActiveTechnician', 'wasLate', 'minutesLate', 'assignmentStatus',
];

const ESD_PRESENCE_FIELDS = ['esdPassed'];

const TRAINING_PRESENCE_FIELDS = ['certificationsReady'];

function emptyMetricRow(employeeId, date, shift) {
  return { date, employeeId, shift, username: '', email: '' };
}

function emptyPresenceRow(employeeId, date, shift) {
  return { date, employeeId, shift, username: '', email: '', building: '', area: '' };
}

/**
 * Merges all parsed source rows into consolidated metric + presence arrays.
 *
 * @param {Object} sources - parsed output from each source parser (.rows array)
 * @param {Array} sources.mesRows
 * @param {Array} sources.testDashRows
 * @param {Array} sources.attendanceRows
 * @param {Array} sources.esdRows
 * @param {Array} sources.trainingRows
 * @param {Array} sources.manualRows
 * @returns {{ metricRows: Array, presenceRows: Array, issues: string[] }}
 */
export function mergeSourcesIntoConsolidatedSheet({
  mesRows = [],
  testDashRows = [],
  attendanceRows = [],
  esdRows = [],
  trainingRows = [],
  manualRows = [],
} = {}) {
  const metricMap = new Map();
  const presenceMap = new Map();
  const issues = [];

  function getMetric(row) {
    const key = baseKey(row);
    if (!metricMap.has(key)) {
      metricMap.set(key, emptyMetricRow(row.employeeId, row.date, row.shift || ''));
    }
    const target = metricMap.get(key);
    // Promote shift if this source has one and the target doesn't yet
    const shift = String(row.shift || '').trim();
    if (shift && !target.shift) target.shift = shift;
    return target;
  }

  function getPresence(row) {
    const key = baseKey(row);
    if (!presenceMap.has(key)) {
      presenceMap.set(key, emptyPresenceRow(row.employeeId, row.date, row.shift || ''));
    }
    const target = presenceMap.get(key);
    const shift = String(row.shift || '').trim();
    if (shift && !target.shift) target.shift = shift;
    return target;
  }

  // 1. MES → metric rows
  for (const row of mesRows) {
    assignFields(getMetric(row), row, MES_FIELDS);
  }

  // 2. Testing Dashboard → metric rows
  for (const row of testDashRows) {
    assignFields(getMetric(row), row, TEST_DASH_FIELDS);
  }

  // 3. Attendance → metric rows + presence rows
  for (const row of attendanceRows) {
    assignFields(getMetric(row), row, ATTENDANCE_METRIC_FIELDS);
    assignFields(getPresence(row), row, ATTENDANCE_PRESENCE_FIELDS);
  }

  // 4. ESD → metric rows + presence rows
  for (const row of esdRows) {
    assignFields(getMetric(row), row, ESD_METRIC_FIELDS);
    assignFields(getPresence(row), row, ESD_PRESENCE_FIELDS);
  }

  // 5. Training → metric rows + presence rows
  for (const row of trainingRows) {
    assignFields(getMetric(row), row, TRAINING_METRIC_FIELDS);
    assignFields(getPresence(row), row, TRAINING_PRESENCE_FIELDS);
  }

  // 6. Manual → metric rows (overlay)
  for (const row of manualRows) {
    assignFields(getMetric(row), row, MANUAL_METRIC_FIELDS);
  }

  const metricRows = Array.from(metricMap.values());
  const presenceRows = Array.from(presenceMap.values());

  if (metricRows.length === 0 && presenceRows.length === 0) {
    issues.push('No rows produced after merging all sources.');
  }

  return { metricRows, presenceRows, issues };
}
