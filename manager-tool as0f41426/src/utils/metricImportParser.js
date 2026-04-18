// src/utils/metricImportParser.js
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
function norm(v) {
  return String(v ?? '').trim();
}

function normLower(v) {
  return norm(v).toLowerCase();
}

function cleanHeader(h) {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeKey(h) {
  return cleanHeader(h)
    .toLowerCase()
    .replace(/[.\-\/()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRowKeys(raw) {
  const out = {};
  for (const key of Object.keys(raw || {})) {
    out[normalizeKey(key)] = raw[key];
  }
  return out;
}

function pick(row, aliases = [], fallback = '') {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const val = row[key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val).trim();
      }
    }
  }
  return fallback;
}

function safeNumber(value, fallback = '') {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseFile(buffer, originalName) {
  const lower = String(originalName || '').toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');

  if (!isExcel && !isCsv) {
    throw new Error('Unsupported file type. Upload CSV or Excel.');
  }

  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const text = buffer.toString('utf8');
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/* ─────────────────────────────────────────────
 * Metric row normalization
 * ───────────────────────────────────────────── */
function normalizeMetricRow(raw) {
  const row = normalizeRowKeys(raw);

  return {
    date: pick(row, ['date', 'metric date', 'work date', 'workdate']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'emp.id']),
    username: pick(row, ['username', 'domainusername', 'domain username', 'user']),
    email: pick(row, ['email', 'mail']),
    building: pick(row, ['building']),
    shift: pick(row, ['shift']),
    area: pick(row, ['area', 'department', 'line']),
    productFamily: pick(row, ['productfamily', 'product family', 'product']),
    testStage: pick(row, ['teststage', 'test stage', 'stage']),

    serversAssigned: safeNumber(pick(row, ['serversassigned', 'servers assigned'])),
    serversCompleted: safeNumber(pick(row, ['serverscompleted', 'servers completed'])),
    racksAssigned: safeNumber(pick(row, ['racksassigned', 'racks assigned'])),
    racksCompleted: safeNumber(pick(row, ['rackscompleted', 'racks completed'])),
    expectedCheckActions: safeNumber(pick(row, ['expectedcheckactions', 'expected check actions'])),
    validCheckActions: safeNumber(pick(row, ['validcheckactions', 'valid check actions'])),
    inspectionsExpected: safeNumber(pick(row, ['inspectionsexpected', 'inspections expected'])),
    inspectionsCompleted: safeNumber(pick(row, ['inspectionscompleted', 'inspections completed'])),

    unitsRepaired: safeNumber(pick(row, ['unitsrepaired', 'units repaired'])),
    unitsPassedFirstRerun: safeNumber(pick(row, ['unitspassedfirstrerun', 'units passed first rerun'])),
    unitsEventuallyPassed: safeNumber(pick(row, ['unitseventuallypassed', 'units eventually passed'])),
    successfulReruns: safeNumber(pick(row, ['successfulreruns', 'successful reruns'])),
    totalReruns: safeNumber(pick(row, ['totalreruns', 'total reruns'])),
    escalatedUnits: safeNumber(pick(row, ['escalatedunits', 'escalated units'])),
    totalFailedUnitsWorked: safeNumber(pick(row, ['totalfailedunitsworked', 'total failed units worked'])),

    totalAttemptsToPass: safeNumber(pick(row, ['totalattemptstopass', 'total attempts to pass'])),
    passedRepairUnitCount: safeNumber(pick(row, ['passedrepairunitcount', 'passed repair unit count'])),
    mttrMinutesTotal: safeNumber(pick(row, ['mttrminutestotal', 'mttr minutes total'])),
    mttrSampleCount: safeNumber(pick(row, ['mttrsamplecount', 'mttr sample count'])),

    postTestEscapes: safeNumber(pick(row, ['posttestescapes', 'post test escapes'])),
    unitsPassed: safeNumber(pick(row, ['unitspassed', 'units passed'])),
    repeatFailures: safeNumber(pick(row, ['repeatfailures', 'repeat failures'])),
    repairedUnitsForRepeatCheck: safeNumber(
      pick(row, ['repairedunitsforrepeatcheck', 'repaired units for repeat check'])
    ),
    inspectionIssuesCaught: safeNumber(
      pick(row, ['inspectionissuescaught', 'inspection issues caught'])
    ),
    totalIssuesFound: safeNumber(pick(row, ['totalissuesfound', 'total issues found'])),
    incorrectRepairActions: safeNumber(
      pick(row, ['incorrectrepairactions', 'incorrect repair actions'])
    ),
    totalRepairActions: safeNumber(pick(row, ['totalrepairactions', 'total repair actions'])),
    technicianAttributedDefects: safeNumber(
      pick(row, ['technicianattributeddefects', 'technician attributed defects'])
    ),
    unitsHandled: safeNumber(pick(row, ['unitshandled', 'units handled'])),

    scheduledShifts: safeNumber(pick(row, ['scheduledshifts', 'scheduled shifts'])),
    shiftsAttendedOnTime: safeNumber(
      pick(row, ['shiftsattendedontime', 'shifts attended on time'])
    ),
    daysWorked: safeNumber(pick(row, ['daysworked', 'days worked'])),
    daysWithSuccessfulEsd: safeNumber(
      pick(row, ['dayswithsuccessfulesd', 'days with successful esd'])
    ),
    esdFirstPassDays: safeNumber(pick(row, ['esdfirstpassdays', 'esd first pass days'])),
    totalEsdDays: safeNumber(pick(row, ['totalesddays', 'total esd days'])),
    infractionPoints: safeNumber(pick(row, ['infractionpoints', 'infraction points'])),

    plannedCrossTrainingModules: safeNumber(
      pick(row, ['plannedcrosstrainingmodules', 'planned cross training modules'])
    ),
    completedCrossTrainingModules: safeNumber(
      pick(row, ['completedcrosstrainingmodules', 'completed cross training modules'])
    ),
    knowledgeSharingEvents: safeNumber(
      pick(row, ['knowledgesharingevents', 'knowledge sharing events'])
    ),
    ciParticipationEvents: safeNumber(
      pick(row, ['ciparticipationevents', 'ci participation events'])
    ),
    leadershipSupportEvents: safeNumber(
      pick(row, ['leadershipsupportevents', 'leadership support events'])
    ),

    excludedSystemDelayMinutes: safeNumber(
      pick(row, ['excludedsystemdelayminutes', 'excluded system delay minutes'])
    ),
    excludedPartWaitMinutes: safeNumber(
      pick(row, ['excludedpartwaitminutes', 'excluded part wait minutes'])
    ),
    excludedInfraMinutes: safeNumber(
      pick(row, ['excludedinframinutes', 'excluded infra minutes'])
    ),
    complexityMultiplier: safeNumber(
      pick(row, ['complexitymultiplier', 'complexity multiplier']),
      1
    ),

    sourceBatchId: pick(row, ['sourcebatchid', 'source batch id']),
    notes: pick(row, ['notes', 'comment', 'comments']),
  };
}

/* ─────────────────────────────────────────────
 * Presence row normalization
 * ───────────────────────────────────────────── */
function normalizePresenceRow(raw) {
  const row = normalizeRowKeys(raw);

  return {
    date: pick(row, ['date', 'presence date', 'work date', 'workdate']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'emp.id']),
    username: pick(row, ['username', 'domainusername', 'domain username', 'user']),
    email: pick(row, ['email', 'mail']),
    building: pick(row, ['building']),
    shift: pick(row, ['shift']),
    area: pick(row, ['area', 'department', 'line']),
    wasScheduled: pick(row, ['wasscheduled', 'was scheduled']),
    wasPresent: pick(row, ['waspresent', 'was present']),
    wasActiveTechnician: pick(row, ['wasactivetechnician', 'was active technician']),
    wasLate: pick(row, ['waslate', 'was late']),
    minutesLate: safeNumber(pick(row, ['minuteslate', 'minutes late'])),
    esdPassed: pick(row, ['esdpassed', 'esd passed']),
    certificationsReady: pick(row, ['certificationsready', 'certifications ready']),
    assignmentStatus: pick(row, ['assignmentstatus', 'assignment status']),
    notes: pick(row, ['notes', 'comment', 'comments']),
  };
}

/* ─────────────────────────────────────────────
 * Validators
 * ───────────────────────────────────────────── */
function validateMetricRow(row, rowNum) {
  const issues = [];

  if (!row.date) issues.push(`Row ${rowNum}: missing metric date.`);
  if (!row.employeeId && !row.username && !row.email) {
    issues.push(`Row ${rowNum}: missing staff identifier (employeeId/username/email).`);
  }

  return issues;
}

function validatePresenceRow(row, rowNum) {
  const issues = [];

  if (!row.date) issues.push(`Row ${rowNum}: missing presence date.`);
  if (!row.employeeId && !row.username && !row.email) {
    issues.push(`Row ${rowNum}: missing staff identifier (employeeId/username/email).`);
  }

  return issues;
}

/* ─────────────────────────────────────────────
 * Public parsers
 * ───────────────────────────────────────────── */
export function parseMetricImportFile(buffer, originalName) {
  const rows = parseFile(buffer, originalName);
  const technicianMetricRows = [];
  const issues = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // header row is 1
    const normalized = normalizeMetricRow(raw);
    const rowIssues = validateMetricRow(normalized, rowNum);

    if (rowIssues.length) {
      issues.push(...rowIssues);
      return;
    }

    technicianMetricRows.push(normalized);
  });

  return {
    technicianMetricRows,
    issues,
    totalRows: rows.length,
    acceptedRows: technicianMetricRows.length,
  };
}

export function parsePresenceImportFile(buffer, originalName) {
  const rows = parseFile(buffer, originalName);
  const presenceRows = [];
  const issues = [];

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const normalized = normalizePresenceRow(raw);
    const rowIssues = validatePresenceRow(normalized, rowNum);

    if (rowIssues.length) {
      issues.push(...rowIssues);
      return;
    }

    presenceRows.push(normalized);
  });

  return {
    presenceRows,
    issues,
    totalRows: rows.length,
    acceptedRows: presenceRows.length,
  };
}

/**
 * Combined convenience parser
 * Useful if route already has both uploaded files
 */
export function parseKpiImportFiles({
  technicianMetricsFile,
  presenceFile,
}) {
  if (!technicianMetricsFile) {
    throw new Error('Technician metrics file is required.');
  }

  const metricResult = parseMetricImportFile(
    technicianMetricsFile.buffer,
    technicianMetricsFile.originalname
  );

  const presenceResult = presenceFile
    ? parsePresenceImportFile(presenceFile.buffer, presenceFile.originalname)
    : {
        presenceRows: [],
        issues: [],
        totalRows: 0,
        acceptedRows: 0,
      };

  return {
    technicianMetricRows: metricResult.technicianMetricRows,
    presenceRows: presenceResult.presenceRows,
    issues: [...metricResult.issues, ...presenceResult.issues],
    summary: {
      technicianMetrics: {
        totalRows: metricResult.totalRows,
        acceptedRows: metricResult.acceptedRows,
      },
      presence: {
        totalRows: presenceResult.totalRows,
        acceptedRows: presenceResult.acceptedRows,
      },
    },
  };
}