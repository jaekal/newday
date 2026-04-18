// src/routes/imports.js
import express from 'express';
import multer from 'multer';

import { ensureRole } from '../middleware/auth.js';
import { processDailyMetricsPipeline } from '../services/metricAggregationService.js';
import { parseKpiImportFiles } from '../utils/metricImportParser.js';
import {
  parseMesFile, parseTestDashFile, parseAttendanceFile,
  parseEsdFile, parseTrainingFile, parseManualEntryFile,
  mergeSourcesIntoConsolidatedSheet,
} from '../services/metricSourceParsers/index.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { syncLegacySidecars } from '../services/legacySidecarSync.js';
import { User } from '../models/index.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* ─────────────────────────────────────────────
 * CSV template definitions
 * Keep these aligned with your import parsers.
 * ───────────────────────────────────────────── */
const TEMPLATES = {
  roster: {
    filename: 'roster_template.csv',
    description: 'Roster (Domain Username Mapping)',
    headers: [
      'domainUsername',
      'employeeId',
      'fullName',
      'email',
      'building',
      'shift',
      'notes',
    ],
  },

  staff: {
    filename: 'staff_profiles_template.csv',
    description: 'Staff & Profiles import',
    headers: [
      'name',
      'username',
      'email',
      'role',
      'phone',
      'avatarPath',

      'employeeId',
      'positionType',
      'startDate',
      'tenureLabel',
      'dateOfBirth',

      'carMake',
      'carModel',
      'licensePlate',

      'domainName',
      'domainUsername',

      'highestEducationLevel',
      'schoolName',
      'degreeName',
      'fieldOfStudy',
      'graduationYear',
      'certificationsText',

      'rosterBuilding',
      'rosterShift',
    ],
  },

  skuExposure: {
    filename: 'sku_exposure_template.csv',
    description: 'SKU Exposure import',
    headers: ['staffUsername', 'staffEmail', 'employeeId', 'sku', 'timesWorked', 'lastWorkedAt'],
  },

  rackAssignmentEvents: {
    filename: 'rack_assignment_events_template.csv',
    description: 'Rack Assignment Events (Event Stream) import',
    headers: [
      'Building',
      'Customer',
      'assignmentTime',
      'assigneeAtTime',
      'model',
      'serialNumber',
      'type',
    ],
  },

  rackAssignments: {
    filename: 'rack_assignment_events_template.csv',
    description: 'Rack Assignment Events (Event Stream) import',
    headers: [
      'Building',
      'Customer',
      'assignmentTime',
      'assigneeAtTime',
      'model',
      'serialNumber',
      'type',
    ],
  },

  esd: {
    filename: 'esd_checks_template.csv',
    description: 'ESD Checks import',
    headers: [
      'employeeId',
      'logDateTime',
      'result',
      'station',
      'badgeId',
      'notes',
    ],
  },

  attendance: {
    filename: 'attendance_template.csv',
    description: 'Attendance import',
    headers: [
      'date',
      'employeeId',
      'staffId',
      'domainUsername',
      'status',
      'minutesLate',
      'rawStatus',
      'punctualityBucket',
      'notes',
    ],
  },

  training: {
    filename: 'training_template.csv',
    description: 'Training / Certification import',
    headers: [
      'employeeId',
      'courseName',
      'title',
      'category',
      'status',
      'overallProgress',
      'assignedDate',
      'completedDate',
      'expirationDate',
      'instructor',
      'sourceSystem',
      'notes',
    ],
  },

  technicianDailyMetrics: {
    filename: 'technician_daily_metrics_template.csv',
    description: 'Technician Daily Metrics import',
    headers: [
      'date',
      'employeeId',
      'username',
      'email',
      'building',
      'shift',
      'area',
      'productFamily',
      'testStage',

      'serversAssigned',
      'serversCompleted',
      'racksAssigned',
      'racksCompleted',
      'expectedCheckActions',
      'validCheckActions',
      'inspectionsExpected',
      'inspectionsCompleted',

      'unitsRepaired',
      'unitsPassedFirstRerun',
      'unitsEventuallyPassed',
      'successfulReruns',
      'totalReruns',
      'escalatedUnits',
      'totalFailedUnitsWorked',

      'totalAttemptsToPass',
      'passedRepairUnitCount',
      'mttrMinutesTotal',
      'mttrSampleCount',

      'postTestEscapes',
      'unitsPassed',
      'repeatFailures',
      'repairedUnitsForRepeatCheck',
      'inspectionIssuesCaught',
      'totalIssuesFound',
      'incorrectRepairActions',
      'totalRepairActions',
      'technicianAttributedDefects',
      'unitsHandled',

      'scheduledShifts',
      'shiftsAttendedOnTime',
      'daysWorked',
      'daysWithSuccessfulEsd',
      'esdFirstPassDays',
      'totalEsdDays',
      'infractionPoints',

      'plannedCrossTrainingModules',
      'completedCrossTrainingModules',
      'knowledgeSharingEvents',
      'ciParticipationEvents',
      'leadershipSupportEvents',

      'excludedSystemDelayMinutes',
      'excludedPartWaitMinutes',
      'excludedInfraMinutes',
      'complexityMultiplier',

      'sourceBatchId',
      'notes',
    ],
  },

  technicianPresenceDaily: {
    filename: 'technician_presence_daily_template.csv',
    description: 'Technician Presence Daily import',
    headers: [
      'date',
      'employeeId',
      'username',
      'email',
      'building',
      'shift',
      'area',
      'wasScheduled',
      'wasPresent',
      'wasActiveTechnician',
      'wasLate',
      'minutesLate',
      'esdPassed',
      'certificationsReady',
      'assignmentStatus',
      'notes',
    ],
  },

  // ── Multi-source templates ──────────────────

  mesExport: {
    filename: 'mes_export_template.csv',
    description: 'MES (Shop Floor Control) export',
    headers: [
      'employeeId', 'date', 'building', 'shift', 'area', 'productFamily',
      'serversAssigned', 'serversCompleted', 'racksAssigned', 'racksCompleted',
      'expectedCheckActions', 'validCheckActions', 'inspectionsExpected', 'inspectionsCompleted',
      'unitsRepaired', 'unitsHandled', 'unitsPassed',
      'excludedSystemDelayMinutes', 'excludedPartWaitMinutes', 'excludedInfraMinutes',
      'complexityMultiplier',
    ],
  },

  testingDashboard: {
    filename: 'testing_dashboard_template.csv',
    description: 'Testing Dashboard (MongoDB) export',
    headers: [
      'employeeId', 'date', 'testStage',
      'unitsPassedFirstRerun', 'unitsEventuallyPassed', 'successfulReruns', 'totalReruns',
      'escalatedUnits', 'totalFailedUnitsWorked',
      'totalAttemptsToPass', 'passedRepairUnitCount', 'mttrMinutesTotal', 'mttrSampleCount',
      'postTestEscapes', 'repeatFailures', 'repairedUnitsForRepeatCheck',
      'inspectionIssuesCaught', 'totalIssuesFound',
      'incorrectRepairActions', 'totalRepairActions', 'technicianAttributedDefects',
    ],
  },

  attendanceHr: {
    filename: 'attendance_hr_template.csv',
    description: 'HR / Attendance System export',
    headers: [
      'employeeId', 'date', 'shift', 'building',
      'wasScheduled', 'wasPresent', 'wasLate', 'minutesLate',
      'scheduledShifts', 'shiftsAttendedOnTime', 'daysWorked', 'infractionPoints',
    ],
  },

  esdBadge: {
    filename: 'esd_badge_template.csv',
    description: 'ESD Badge System export',
    headers: [
      'employeeId', 'date',
      'esdPassed', 'esdFirstPass',
      'daysWithSuccessfulEsd', 'esdFirstPassDays', 'totalEsdDays',
    ],
  },

  trainingLms: {
    filename: 'training_lms_template.csv',
    description: 'Training / LMS Platform export',
    headers: [
      'employeeId', 'date',
      'plannedCrossTrainingModules', 'completedCrossTrainingModules', 'certificationsReady',
    ],
  },

  supervisorManual: {
    filename: 'supervisor_manual_entry_template.csv',
    description: 'Supervisor Manual Entry',
    headers: [
      'employeeId', 'date',
      'knowledgeSharingEvents', 'ciParticipationEvents', 'leadershipSupportEvents', 'notes',
    ],
  },
};

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(headers) {
  const headerLine = headers.map(escapeCsv).join(',');
  const emptyLine = headers.map(() => '').join(',');
  return `${headerLine}\n${emptyLine}\n`;
}

function norm(v) {
  return String(v ?? '').trim();
}

function toDateOnly(value) {
  const raw = norm(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return d.toISOString().slice(0, 10);
}

function buildTemplateList() {
  return Object.entries(TEMPLATES).map(([key, def]) => ({
    key,
    filename: def.filename,
    description: def.description,
  }));
}

function renderImportsIndex(res, extra = {}) {
  return res.render('imports/index', {
    pageTitle: 'Imports',
    templates: buildTemplateList(),
    metricImportSummary: null,
    metricImportError: null,
    currentUserRole: extra.currentUserRole || '',
    ...extra,
  });
}

function renderKpiImports(res, extra = {}) {
  return res.render('imports/metrics', {
    pageTitle: 'KPI Imports',
    metricImportSummary: null,
    metricImportError: null,
    metricImportMeta: null,
    metricImportIssuesPreview: [],
    metricImportIssuesRemaining: 0,
    today: new Date().toISOString().slice(0, 10),
    ...extra,
  });
}

function userCanDownloadTemplate(role, key) {
  const upperRole = String(role || '').toUpperCase();

  const personnelOnly = ['roster', 'staff'];
  const trainingOnly = ['training'];
  const broadAccess = [
    'rackAssignmentEvents',
    'rackAssignments',
    'esd',
    'attendance',
    'technicianDailyMetrics',
    'technicianPresenceDaily',
    'mesExport',
    'testingDashboard',
    'attendanceHr',
    'esdBadge',
    'trainingLms',
    'supervisorManual',
  ];

  if (personnelOnly.includes(key)) {
    return ['ADMIN', 'SENIOR_MANAGER', 'MANAGER'].includes(upperRole);
  }

  if (trainingOnly.includes(key)) {
    return ['ADMIN', 'SENIOR_MANAGER', 'MANAGER'].includes(upperRole);
  }

  if (broadAccess.includes(key)) {
    return ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD'].includes(upperRole);
  }

  return false;
}

/* ─────────────────────────────────────────────
 * Central Imports hub
 * Personnel: ADMIN / MANAGER only
 * Operational + Compliance: LEAD / SUPERVISOR / MANAGER / ADMIN
 * Training: ADMIN / MANAGER only
 * ───────────────────────────────────────────── */
router.get(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const currentUserRole = String(req.currentUser?.role || res.locals.currentUser?.role || '').toUpperCase();

    return renderImportsIndex(res, {
      currentUserRole,
    });
  }
);

/* ─────────────────────────────────────────────
 * Download template
 * GET /imports/templates/:key.csv
 * ───────────────────────────────────────────── */
router.get(
  '/templates/:key.csv',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  (req, res) => {
    const key = String(req.params.key || '').trim();
    const def = TEMPLATES[key];
    const role = String(req.currentUser?.role || res.locals.currentUser?.role || '').toUpperCase();

    if (!def) {
      return res.status(404).send('Template not found.');
    }

    if (!userCanDownloadTemplate(role, key)) {
      return res.status(403).send('You do not have access to this template.');
    }

    const csv = buildCsv(def.headers);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${def.filename}"`);
    return res.send(csv);
  }
);

/* ─────────────────────────────────────────────
 * KPI Imports page
 * Operational import access:
 * ADMIN / MANAGER / SUPERVISOR / LEAD
 * ───────────────────────────────────────────── */
router.get(
  '/metrics',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    return renderKpiImports(res);
  }
);

/* ─────────────────────────────────────────────
 * POST /imports/metrics/process
 * Upload:
 * - technician metrics file (required)
 * - presence file (optional)
 * Then process daily KPI pipeline automatically
 *
 * Operational import access:
 * ADMIN / MANAGER / SUPERVISOR / LEAD
 * ───────────────────────────────────────────── */
router.post(
  '/metrics/process',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  upload.fields([
    { name: 'technicianMetricsFile', maxCount: 1 },
    { name: 'presenceFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const date = toDateOnly(req.body.date);
      const calculationVersion = norm(req.body.calculationVersion || 'v1');

      const technicianMetricsFile = req.files?.technicianMetricsFile?.[0] || null;
      const presenceFile = req.files?.presenceFile?.[0] || null;

      if (!technicianMetricsFile) {
        throw new Error('Technician metrics file is required.');
      }

      const parsed = parseKpiImportFiles({
        technicianMetricsFile,
        presenceFile,
      });

      const result = await processDailyMetricsPipeline({
        date,
        technicianMetricRows: parsed.technicianMetricRows,
        presenceRows: parsed.presenceRows,
        scoreOptions: {
          calculationVersion,
        },
      });

      const summaryLines = [
        `KPI import pipeline complete for ${date}`,
        '',
        `Technician metric file rows: ${parsed.summary.technicianMetrics.totalRows}`,
        `Technician metric rows accepted: ${parsed.summary.technicianMetrics.acceptedRows}`,
        '',
        `Presence file rows: ${parsed.summary.presence.totalRows}`,
        `Presence rows accepted: ${parsed.summary.presence.acceptedRows}`,
        '',
        `Metric rows created: ${result.metricUpsert.created}`,
        `Metric rows updated: ${result.metricUpsert.updated}`,
        `Metric rows skipped: ${result.metricUpsert.skipped}`,
        '',
        `Presence rows created: ${result.presenceUpsert.created}`,
        `Presence rows updated: ${result.presenceUpsert.updated}`,
        `Presence rows skipped: ${result.presenceUpsert.skipped}`,
        '',
        `Dates rebuilt: ${result.rebuildSummary.datesProcessed || 1}`,
        `Shift rows created: ${result.rebuildSummary.shiftSummary.created}`,
        `Shift rows updated: ${result.rebuildSummary.shiftSummary.updated}`,
        '',
        `Score snapshots created: ${result.rebuildSummary.scoreSummary.created}`,
        `Score snapshots updated: ${result.rebuildSummary.scoreSummary.updated}`,
        `Score snapshots skipped: ${result.rebuildSummary.scoreSummary.skipped}`,
        '',
        `Staff profile metrics synced: ${result.rebuildSummary.staffSync?.synced || 0} (${result.rebuildSummary.staffSync?.created || 0} created, ${result.rebuildSummary.staffSync?.updated || 0} updated)`,
      ];

      const allIssues = [
        ...(parsed.issues || []),
        ...(result.metricUpsert.issues || []),
        ...(result.presenceUpsert.issues || []),
        ...(result.rebuildSummary.scoreSummary.issues || []),
        ...(result.rebuildIssues || []),
      ];

      if (allIssues.length) {
        summaryLines.push('', 'Top issues:');
        allIssues.slice(0, 10).forEach((x) => summaryLines.push(`- ${x}`));
        if (allIssues.length > 10) {
          summaryLines.push(`...and ${allIssues.length - 10} more`);
        }
      }

      const kpiActor = await User.findByPk(req.session?.userId, { attributes: ['id', 'username', 'email', 'role'] });
      await createAuditLog({
        req,
        actorUser: kpiActor,
        actionType: 'IMPORT',
        entityType: 'METRIC',
        summary: `KPI metrics imported for ${date}: ${result.metricUpsert.created} created, ${result.metricUpsert.updated} updated`,
        details: {
          date,
          calculationVersion,
          metricsCreated: result.metricUpsert.created,
          metricsUpdated: result.metricUpsert.updated,
          issueCount: allIssues.length,
        },
      });

      return renderKpiImports(res, {
        metricImportSummary: summaryLines.join('\n'),
        metricImportMeta: parsed.summary,
        metricImportIssuesPreview: allIssues.slice(0, 8),
        metricImportIssuesRemaining: Math.max(0, allIssues.length - 8),
      });
    } catch (err) {
      return renderKpiImports(res, {
        metricImportError: `KPI import failed: ${err.message}`,
      });
    }
  }
);

/* ─────────────────────────────────────────────
 * POST /imports/metrics/multi-source
 * Upload up to 6 source-specific CSV files.
 * Parses each, merges into consolidated rows,
 * then feeds into the existing KPI pipeline.
 *
 * Operational import access:
 * ADMIN / MANAGER / SUPERVISOR / LEAD
 * ───────────────────────────────────────────── */
router.post(
  '/metrics/multi-source',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  upload.fields([
    { name: 'mesFile', maxCount: 1 },
    { name: 'testDashFile', maxCount: 1 },
    { name: 'attendanceFile', maxCount: 1 },
    { name: 'esdFile', maxCount: 1 },
    { name: 'trainingFile', maxCount: 1 },
    { name: 'manualFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const date = toDateOnly(req.body.date);
      const calculationVersion = norm(req.body.calculationVersion || 'v1');

      const mesFile = req.files?.mesFile?.[0] || null;
      const testDashFile = req.files?.testDashFile?.[0] || null;
      const attendanceFile = req.files?.attendanceFile?.[0] || null;
      const esdFile = req.files?.esdFile?.[0] || null;
      const trainingFile = req.files?.trainingFile?.[0] || null;
      const manualFile = req.files?.manualFile?.[0] || null;

      if (!mesFile && !testDashFile && !attendanceFile && !esdFile && !trainingFile && !manualFile) {
        throw new Error('At least one source file is required.');
      }

      // Parse each source
      const mesParsed = mesFile ? parseMesFile(mesFile.buffer, mesFile.originalname) : null;
      const testDashParsed = testDashFile ? parseTestDashFile(testDashFile.buffer, testDashFile.originalname) : null;
      const attendanceParsed = attendanceFile ? parseAttendanceFile(attendanceFile.buffer, attendanceFile.originalname) : null;
      const esdParsed = esdFile ? parseEsdFile(esdFile.buffer, esdFile.originalname) : null;
      const trainingParsed = trainingFile ? parseTrainingFile(trainingFile.buffer, trainingFile.originalname) : null;
      const manualParsed = manualFile ? parseManualEntryFile(manualFile.buffer, manualFile.originalname) : null;

      // Merge all sources
      const merged = mergeSourcesIntoConsolidatedSheet({
        mesRows: mesParsed?.rows || [],
        testDashRows: testDashParsed?.rows || [],
        attendanceRows: attendanceParsed?.rows || [],
        esdRows: esdParsed?.rows || [],
        trainingRows: trainingParsed?.rows || [],
        manualRows: manualParsed?.rows || [],
      });

      // Count unique dates in merged rows for diagnostics
      const uniqueDatesInRows = new Set(
        merged.metricRows.map(r => String(r.date || '').trim()).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      );

      // Run through existing pipeline
      const result = await processDailyMetricsPipeline({
        date,
        technicianMetricRows: merged.metricRows,
        presenceRows: merged.presenceRows,
        scoreOptions: { calculationVersion },
      });

      // Sync legacy display models (Attendance, EsdCheck, RackAssignment)
      const sidecar = await syncLegacySidecars({
        attendanceRows: attendanceParsed?.rows || [],
        esdRows: esdParsed?.rows || [],
        mesRows: mesParsed?.rows || [],
      });

      // Build per-source stats
      const sourceStats = [
        mesParsed && `MES: ${mesParsed.acceptedRows}/${mesParsed.totalRows} rows`,
        testDashParsed && `Testing Dashboard: ${testDashParsed.acceptedRows}/${testDashParsed.totalRows} rows`,
        attendanceParsed && `Attendance: ${attendanceParsed.acceptedRows}/${attendanceParsed.totalRows} rows`,
        esdParsed && `ESD: ${esdParsed.acceptedRows}/${esdParsed.totalRows} rows`,
        trainingParsed && `Training: ${trainingParsed.acceptedRows}/${trainingParsed.totalRows} rows`,
        manualParsed && `Manual Entry: ${manualParsed.acceptedRows}/${manualParsed.totalRows} rows`,
      ].filter(Boolean);

      const uniqueDateCount = uniqueDatesInRows.size;
      const uniqueDateWarning = uniqueDateCount <= 1 && merged.metricRows.length > 1
        ? [`⚠ WARNING: Only ${uniqueDateCount} unique date found across ${merged.metricRows.length} metric rows.`,
           `  KPI scores will reflect only ${uniqueDateCount} day of data, not multi-month averages.`,
           `  To import historical data, each source CSV must have one row per employee per day.`]
        : [];

      const summaryLines = [
        `Multi-source KPI import complete for ${date}`,
        '',
        'Source files processed:',
        ...sourceStats.map((s) => `  ${s}`),
        '',
        `Consolidated metric rows: ${merged.metricRows.length}`,
        `Consolidated presence rows: ${merged.presenceRows.length}`,
        `Unique dates in import: ${uniqueDateCount}`,
        ...(uniqueDateWarning.length ? ['', ...uniqueDateWarning] : []),
        '',
        `Metric rows created: ${result.metricUpsert.created}`,
        `Metric rows updated: ${result.metricUpsert.updated}`,
        `Metric rows skipped: ${result.metricUpsert.skipped}`,
        '',
        `Presence rows created: ${result.presenceUpsert.created}`,
        `Presence rows updated: ${result.presenceUpsert.updated}`,
        `Presence rows skipped: ${result.presenceUpsert.skipped}`,
        '',
        `Dates rebuilt: ${result.rebuildSummary.datesProcessed || 1}`,
        `Shift rows created: ${result.rebuildSummary.shiftSummary.created}`,
        `Shift rows updated: ${result.rebuildSummary.shiftSummary.updated}`,
        '',
        `Score snapshots created: ${result.rebuildSummary.scoreSummary.created}`,
        `Score snapshots updated: ${result.rebuildSummary.scoreSummary.updated}`,
        `Score snapshots skipped: ${result.rebuildSummary.scoreSummary.skipped}`,
        '',
        `Staff profile metrics synced: ${result.rebuildSummary.staffSync?.synced || 0} (${result.rebuildSummary.staffSync?.created || 0} created, ${result.rebuildSummary.staffSync?.updated || 0} updated)`,
        '',
        `Attendance records: ${sidecar.attendance.created} created, ${sidecar.attendance.updated} updated`,
        `ESD check records: ${sidecar.esd.created} created, ${sidecar.esd.updated} updated`,
        `Rack assignment records: ${sidecar.rackAssignments.created} created, ${sidecar.rackAssignments.updated} updated`,
      ];

      const allIssues = [
        ...(merged.issues || []),
        ...(mesParsed?.issues || []),
        ...(testDashParsed?.issues || []),
        ...(attendanceParsed?.issues || []),
        ...(esdParsed?.issues || []),
        ...(trainingParsed?.issues || []),
        ...(manualParsed?.issues || []),
        ...(result.metricUpsert.issues || []),
        ...(result.presenceUpsert.issues || []),
        ...(result.rebuildSummary.scoreSummary.issues || []),
        ...(result.rebuildIssues || []),
        ...(sidecar.attendance.issues || []),
        ...(sidecar.esd.issues || []),
        ...(sidecar.rackAssignments.issues || []),
      ];

      if (allIssues.length) {
        summaryLines.push('', 'Top issues:');
        allIssues.slice(0, 10).forEach((x) => summaryLines.push(`- ${x}`));
        if (allIssues.length > 10) {
          summaryLines.push(`...and ${allIssues.length - 10} more`);
        }
      }

      const actor = await User.findByPk(req.session?.userId, { attributes: ['id', 'username', 'email', 'role'] });
      await createAuditLog({
        req,
        actorUser: actor,
        actionType: 'IMPORT',
        entityType: 'METRIC',
        summary: `Multi-source KPI import for ${date}: ${result.metricUpsert.created} created, ${result.metricUpsert.updated} updated (${sourceStats.length} sources)`,
        details: {
          date,
          calculationVersion,
          sourcesUsed: sourceStats,
          metricsCreated: result.metricUpsert.created,
          metricsUpdated: result.metricUpsert.updated,
          issueCount: allIssues.length,
        },
      });

      return renderKpiImports(res, {
        metricImportSummary: summaryLines.join('\n'),
        metricImportMeta: {
          technicianMetrics: { totalRows: merged.metricRows.length, acceptedRows: merged.metricRows.length },
          presence: { totalRows: merged.presenceRows.length, acceptedRows: merged.presenceRows.length },
        },
        metricImportIssuesPreview: allIssues.slice(0, 8),
        metricImportIssuesRemaining: Math.max(0, allIssues.length - 8),
      });
    } catch (err) {
      console.error('Multi-source import error:', err);
      const detail = err.errors?.map(e => `${e.path}: ${e.message}`).join('; ') || '';
      return renderKpiImports(res, {
        metricImportError: `Multi-source import failed: ${err.message}${detail ? ' — ' + detail : ''}`,
      });
    }
  }
);

export default router;