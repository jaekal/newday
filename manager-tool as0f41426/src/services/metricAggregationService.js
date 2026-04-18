// src/services/metricAggregationService.js
import {
  User,
  StaffProfile,
  TechnicianDailyMetric,
  TechnicianScoreSnapshot,
  ShiftDailyMetric,
  TechnicianPresenceDaily,
} from '../models/index.js';
import { buildTechnicianScoreFromMetric } from './technicianScoreService.js';
import { syncTechnicianToStaffMetrics } from './technicianToStaffMetricSync.js';

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
function norm(v) {
  return String(v ?? '').trim();
}

function normLower(v) {
  return norm(v).toLowerCase();
}

function toDateOnly(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return d.toISOString().slice(0, 10);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolish(value) {
  const v = normLower(value);
  return ['1', 'true', 'yes', 'y', 'pass', 'present', 'active'].includes(v);
}

function uniqKey(parts) {
  return parts.map((x) => norm(x || '')).join('||');
}

function addToMapNumber(map, key, field, amount) {
  if (!map.has(key)) map.set(key, {});
  const row = map.get(key);
  row[field] = safeNumber(row[field]) + safeNumber(amount);
}

function setIfBlank(obj, key, value) {
  if (!obj[key] && norm(value)) obj[key] = norm(value);
}

async function buildUserLookupMaps() {
  const users = await User.findAll({
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });

  const byId = new Map();
  const byUsername = new Map();
  const byEmail = new Map();
  const byEmployeeId = new Map();

  for (const user of users) {
    const plain = user.get({ plain: true });

    byId.set(user.id, plain);

    const username = normLower(user.username);
    const email = normLower(user.email);
    const employeeId = norm(plain?.StaffProfile?.employeeId);

    if (username) byUsername.set(username, plain);
    if (email) byEmail.set(email, plain);
    if (employeeId) byEmployeeId.set(employeeId, plain);
  }

  return { byId, byUsername, byEmail, byEmployeeId };
}

function resolveUserFromRow(row, userMaps) {
  const userId = safeNumber(row.userId, null);
  const username = normLower(row.username);
  const email = normLower(row.email);
  const employeeId = norm(row.employeeId);

  if (userId && userMaps.byId.has(userId)) return userMaps.byId.get(userId);
  if (username && userMaps.byUsername.has(username)) return userMaps.byUsername.get(username);
  if (email && userMaps.byEmail.has(email)) return userMaps.byEmail.get(email);
  if (employeeId && userMaps.byEmployeeId.has(employeeId)) return userMaps.byEmployeeId.get(employeeId);

  return null;
}

/* ─────────────────────────────────────────────
 * Canonical row normalizers
 * These let you import from different source shapes.
 * ───────────────────────────────────────────── */
function normalizeTechnicianMetricRow(raw, resolvedUser) {
  const profile = resolvedUser?.StaffProfile || null;

  return {
    userId: resolvedUser?.id || safeNumber(raw.userId, null),
    employeeId: norm(raw.employeeId || profile?.employeeId || ''),
    metricDate: toDateOnly(raw.metricDate || raw.date || raw.workDate),

    building: norm(raw.building || profile?.building || ''),
    shift: norm(raw.shift || profile?.shift || ''),
    area: norm(raw.area || ''),
    productFamily: norm(raw.productFamily || raw.product || ''),
    testStage: norm(raw.testStage || raw.stage || ''),

    serversAssigned: safeNumber(raw.serversAssigned),
    serversCompleted: safeNumber(raw.serversCompleted),
    racksAssigned: safeNumber(raw.racksAssigned),
    racksCompleted: safeNumber(raw.racksCompleted),
    expectedCheckActions: safeNumber(raw.expectedCheckActions),
    validCheckActions: safeNumber(raw.validCheckActions),
    inspectionsExpected: safeNumber(raw.inspectionsExpected),
    inspectionsCompleted: safeNumber(raw.inspectionsCompleted),

    unitsRepaired: safeNumber(raw.unitsRepaired),
    unitsPassedFirstRerun: safeNumber(raw.unitsPassedFirstRerun),
    unitsEventuallyPassed: safeNumber(raw.unitsEventuallyPassed),
    successfulReruns: safeNumber(raw.successfulReruns),
    totalReruns: safeNumber(raw.totalReruns),
    escalatedUnits: safeNumber(raw.escalatedUnits),
    totalFailedUnitsWorked: safeNumber(raw.totalFailedUnitsWorked),

    totalAttemptsToPass: safeNumber(raw.totalAttemptsToPass),
    passedRepairUnitCount: safeNumber(raw.passedRepairUnitCount),

    mttrMinutesTotal: safeNumber(raw.mttrMinutesTotal),
    mttrSampleCount: safeNumber(raw.mttrSampleCount),

    postTestEscapes: safeNumber(raw.postTestEscapes),
    unitsPassed: safeNumber(raw.unitsPassed),
    repeatFailures: safeNumber(raw.repeatFailures),
    repairedUnitsForRepeatCheck: safeNumber(raw.repairedUnitsForRepeatCheck),
    inspectionIssuesCaught: safeNumber(raw.inspectionIssuesCaught),
    totalIssuesFound: safeNumber(raw.totalIssuesFound),
    incorrectRepairActions: safeNumber(raw.incorrectRepairActions),
    totalRepairActions: safeNumber(raw.totalRepairActions),
    technicianAttributedDefects: safeNumber(raw.technicianAttributedDefects),
    unitsHandled: safeNumber(raw.unitsHandled),

    scheduledShifts: safeNumber(raw.scheduledShifts),
    shiftsAttendedOnTime: safeNumber(raw.shiftsAttendedOnTime),
    daysWorked: safeNumber(raw.daysWorked),
    daysWithSuccessfulEsd: safeNumber(raw.daysWithSuccessfulEsd),
    esdFirstPassDays: safeNumber(raw.esdFirstPassDays),
    totalEsdDays: safeNumber(raw.totalEsdDays),
    infractionPoints: safeNumber(raw.infractionPoints),

    plannedCrossTrainingModules: safeNumber(raw.plannedCrossTrainingModules),
    completedCrossTrainingModules: safeNumber(raw.completedCrossTrainingModules),
    knowledgeSharingEvents: safeNumber(raw.knowledgeSharingEvents),
    ciParticipationEvents: safeNumber(raw.ciParticipationEvents),
    leadershipSupportEvents: safeNumber(raw.leadershipSupportEvents),

    excludedSystemDelayMinutes: safeNumber(raw.excludedSystemDelayMinutes),
    excludedPartWaitMinutes: safeNumber(raw.excludedPartWaitMinutes),
    excludedInfraMinutes: safeNumber(raw.excludedInfraMinutes),
    complexityMultiplier: safeNumber(raw.complexityMultiplier, 1.0),

    sourceBatchId: norm(raw.sourceBatchId || ''),
    notes: norm(raw.notes || ''),
  };
}

function normalizePresenceRow(raw, resolvedUser) {
  const profile = resolvedUser?.StaffProfile || null;

  return {
    userId: resolvedUser?.id || safeNumber(raw.userId, null),
    employeeId: norm(raw.employeeId || profile?.employeeId || ''),
    presenceDate: toDateOnly(raw.presenceDate || raw.date || raw.workDate),
    building: norm(raw.building || profile?.building || ''),
    shift: norm(raw.shift || profile?.shift || ''),
    area: norm(raw.area || ''),
    wasScheduled: boolish(raw.wasScheduled),
    wasPresent: boolish(raw.wasPresent),
    wasActiveTechnician: boolish(raw.wasActiveTechnician),
    wasLate: boolish(raw.wasLate),
    minutesLate: safeNumber(raw.minutesLate),
    esdPassed: boolish(raw.esdPassed),
    certificationsReady:
      raw.certificationsReady == null ? true : boolish(raw.certificationsReady),
    assignmentStatus: norm(raw.assignmentStatus || ''),
    notes: norm(raw.notes || ''),
  };
}

/* ─────────────────────────────────────────────
 * Upsert raw technician daily metrics
 * Accepts already-aggregated rows
 * ───────────────────────────────────────────── */
export async function upsertTechnicianDailyMetrics(rawRows = [], options = {}) {
  const userMaps = await buildUserLookupMaps();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const raw of rawRows) {
    try {
      const resolvedUser = resolveUserFromRow(raw, userMaps);
      const row = normalizeTechnicianMetricRow(raw, resolvedUser);

      if (!row.userId) {
        skipped++;
        issues.push(`Skipped metric row with unresolved user. employeeId="${row.employeeId || 'N/A'}"`);
        continue;
      }

      const existing = await TechnicianDailyMetric.findOne({
        where: {
          userId: row.userId,
          metricDate: row.metricDate,
          shift: row.shift || '',
          area: row.area || '',
          productFamily: row.productFamily || '',
          testStage: row.testStage || '',
        },
      });

      if (!existing) {
        await TechnicianDailyMetric.create(row);
        created++;
      } else {
        await existing.update(row);
        updated++;
      }
    } catch (err) {
      skipped++;
      const detail = err.errors?.map(e => `${e.path}: ${e.message}`).join(', ') || '';
      issues.push(`Metric row error: ${err.message}${detail ? ' — ' + detail : ''}`);
    }
  }

  return { created, updated, skipped, issues };
}

/* ─────────────────────────────────────────────
 * Upsert presence rows
 * Accepts already-aggregated rows
 * ───────────────────────────────────────────── */
export async function upsertTechnicianPresenceDaily(rawRows = []) {
  const userMaps = await buildUserLookupMaps();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const raw of rawRows) {
    try {
      const resolvedUser = resolveUserFromRow(raw, userMaps);
      const row = normalizePresenceRow(raw, resolvedUser);

      if (!row.userId) {
        skipped++;
        issues.push(`Skipped presence row with unresolved user. employeeId="${row.employeeId || 'N/A'}"`);
        continue;
      }

      const existing = await TechnicianPresenceDaily.findOne({
        where: {
          userId: row.userId,
          presenceDate: row.presenceDate,
        },
      });

      if (!existing) {
        await TechnicianPresenceDaily.create(row);
        created++;
      } else {
        await existing.update(row);
        updated++;
      }
    } catch (err) {
      skipped++;
      const detail = err.errors?.map(e => `${e.path}: ${e.message}`).join(', ') || '';
      issues.push(`Presence row error: ${err.message}${detail ? ' — ' + detail : ''}`);
    }
  }

  return { created, updated, skipped, issues };
}

/* ─────────────────────────────────────────────
 * Build shift-level rollups from technician metrics
 * ───────────────────────────────────────────── */
export async function rebuildShiftDailyMetricsForDate(date, options = {}) {
  const metricDate = toDateOnly(date);

  const metricRows = await TechnicianDailyMetric.findAll({
    where: { metricDate },
    order: [['building', 'ASC'], ['shift', 'ASC']],
  });

  console.log(`[rebuildShift] date=${metricDate} found ${metricRows.length} TechnicianDailyMetric rows`);

  const grouped = new Map();

  for (const row of metricRows) {
    const key = uniqKey([
      row.metricDate,
      row.building,
      row.shift,
      row.area,
      row.productFamily,
      row.testStage,
    ]);

    if (!grouped.has(key)) {
      grouped.set(key, {
        metricDate: row.metricDate,
        building: norm(row.building),
        shift: norm(row.shift),
        area: norm(row.area),
        productFamily: norm(row.productFamily),
        testStage: norm(row.testStage),

        activeTechnicians: 0,
        serversCompleted: 0,
        racksCompleted: 0,

        totalEscapes: 0,
        totalRepairs: 0,
        totalReruns: 0,

        ftfNumerator: 0,
        ftfDenominator: 0,
        repairSuccessNumerator: 0,
        repairSuccessDenominator: 0,
        mttrMinutesTotal: 0,
        mttrSampleCount: 0,
        escapeNumerator: 0,
        escapeDenominator: 0,
      });
    }

    const g = grouped.get(key);

    g.activeTechnicians += 1;
    g.serversCompleted += safeNumber(row.serversCompleted);
    g.racksCompleted += safeNumber(row.racksCompleted);

    g.totalEscapes += safeNumber(row.postTestEscapes);
    g.totalRepairs += safeNumber(row.unitsRepaired);
    g.totalReruns += safeNumber(row.totalReruns);

    g.ftfNumerator += safeNumber(row.unitsPassedFirstRerun);
    g.ftfDenominator += safeNumber(row.unitsRepaired);

    g.repairSuccessNumerator += safeNumber(row.unitsEventuallyPassed);
    g.repairSuccessDenominator += safeNumber(row.unitsRepaired);

    g.mttrMinutesTotal += safeNumber(row.mttrMinutesTotal);
    g.mttrSampleCount += safeNumber(row.mttrSampleCount);

    g.escapeNumerator += safeNumber(row.postTestEscapes);
    g.escapeDenominator += safeNumber(row.unitsPassed);
  }

  let created = 0;
  let updated = 0;

  for (const g of grouped.values()) {
    const payload = {
      metricDate: g.metricDate,
      building: g.building || null,
      shift: g.shift || null,
      area: g.area || null,
      productFamily: g.productFamily || null,
      testStage: g.testStage || null,

      activeTechnicians: g.activeTechnicians,
      serversCompleted: g.serversCompleted,
      racksCompleted: g.racksCompleted,

      firstTimeFixRate:
        g.ftfDenominator > 0 ? (g.ftfNumerator / g.ftfDenominator) * 100 : null,
      repairSuccessRate:
        g.repairSuccessDenominator > 0
          ? (g.repairSuccessNumerator / g.repairSuccessDenominator) * 100
          : null,
      averageMttrMinutes:
        g.mttrSampleCount > 0 ? g.mttrMinutesTotal / g.mttrSampleCount : null,
      qualityEscapeRate:
        g.escapeDenominator > 0 ? (g.escapeNumerator / g.escapeDenominator) * 100 : null,

      totalEscapes: g.totalEscapes,
      totalRepairs: g.totalRepairs,
      totalReruns: g.totalReruns,
    };

    const existing = await ShiftDailyMetric.findOne({
      where: {
        metricDate: payload.metricDate,
        building: payload.building,
        shift: payload.shift,
        area: payload.area,
        productFamily: payload.productFamily,
        testStage: payload.testStage,
      },
    });

    if (!existing) {
      await ShiftDailyMetric.create(payload);
      created++;
    } else {
      await existing.update(payload);
      updated++;
    }
  }

  return {
    date: metricDate,
    sourceRows: metricRows.length,
    groupedRows: grouped.size,
    created,
    updated,
  };
}

/* ─────────────────────────────────────────────
 * Build score snapshots from technician daily metrics
 * ───────────────────────────────────────────── */
export async function rebuildTechnicianScoreSnapshotsForDate(date, options = {}) {
  const snapshotDate = toDateOnly(date);

  const metricRows = await TechnicianDailyMetric.findAll({
    where: { metricDate: snapshotDate },
    order: [['userId', 'ASC']],
  });

  console.log(`[rebuildScore] date=${snapshotDate} found ${metricRows.length} TechnicianDailyMetric rows`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const metric of metricRows) {
    try {
      const scoreResult = buildTechnicianScoreFromMetric(metric, options);

      const payload = {
        userId: metric.userId,
        employeeId: metric.employeeId || null,
        snapshotDate,
        windowType: 'DAILY',

        building: metric.building || null,
        shift: metric.shift || null,
        area: metric.area || null,
        productFamily: metric.productFamily || null,
        testStage: metric.testStage || null,

        productivityScore: scoreResult.productivityScore,
        troubleshootingScore: scoreResult.troubleshootingScore,
        qualityScore: scoreResult.qualityScore,
        complianceScore: scoreResult.complianceScore,
        developmentScore: scoreResult.developmentScore,

        overallScore: scoreResult.overallScore,
        scoreBand: scoreResult.scoreBand,

        rawMetricsJson: scoreResult.rawMetricsJson,
        scoreBreakdownJson: scoreResult.scoreBreakdownJson,

        minimumSampleMet: scoreResult.minimumSampleMet,
        calculationVersion: options.calculationVersion || 'v1',
      };

      const existing = await TechnicianScoreSnapshot.findOne({
        where: {
          userId: payload.userId,
          snapshotDate: payload.snapshotDate,
          windowType: payload.windowType,
          shift: payload.shift ?? null,
          area: payload.area ?? null,
          productFamily: payload.productFamily ?? null,
          testStage: payload.testStage ?? null,
        },
      });

      if (!existing) {
        await TechnicianScoreSnapshot.create(payload);
        created++;
      } else {
        await existing.update(payload);
        updated++;
      }
    } catch (err) {
      skipped++;
      issues.push(`Score snapshot error for userId=${metric.userId}: ${err.message}`);
    }
  }

  return {
    date: snapshotDate,
    sourceRows: metricRows.length,
    created,
    updated,
    skipped,
    issues,
  };
}

/* ─────────────────────────────────────────────
 * One-shot rebuild for a single day
 * Useful after imports finish
 * ───────────────────────────────────────────── */
export async function rebuildDailyDashboardArtifacts(date, options = {}) {
  const dateOnly = toDateOnly(date);

  const shiftSummary = await rebuildShiftDailyMetricsForDate(dateOnly, options);
  const scoreSummary = await rebuildTechnicianScoreSnapshotsForDate(dateOnly, options);
  const staffSync = await syncTechnicianToStaffMetrics(dateOnly);

  return {
    date: dateOnly,
    shiftSummary,
    scoreSummary,
    staffSync,
  };
}

/* ─────────────────────────────────────────────
 * Aggregation helpers from row-level import data
 *
 * These functions are useful when your imports are not already
 * pre-aggregated per technician/day. You can feed raw rows and
 * get daily upserts.
 * ───────────────────────────────────────────── */

/**
 * Aggregate generic productivity / troubleshooting rows into
 * TechnicianDailyMetric upsert rows.
 *
 * Expected row examples:
 * {
 *   date: '2026-03-17',
 *   employeeId: 'E123',
 *   username: 'jdoe',
 *   building: 'B4050',
 *   shift: '1st',
 *   area: 'SLT',
 *   productFamily: 'IKAROS',
 *   testStage: 'RLT',
 *   serversAssigned: 10,
 *   serversCompleted: 9,
 *   unitsRepaired: 4,
 *   unitsPassedFirstRerun: 3,
 *   unitsEventuallyPassed: 4,
 *   totalReruns: 5,
 *   successfulReruns: 4,
 *   mttrMinutesTotal: 75,
 *   mttrSampleCount: 4,
 *   ...
 * }
 */
export async function aggregateAndUpsertTechnicianMetrics(rawRows = []) {
  return upsertTechnicianDailyMetrics(rawRows);
}

/**
 * Aggregate presence / attendance style rows into
 * TechnicianPresenceDaily upsert rows.
 *
 * Expected row examples:
 * {
 *   date: '2026-03-17',
 *   employeeId: 'E123',
 *   wasScheduled: true,
 *   wasPresent: true,
 *   wasActiveTechnician: true,
 *   wasLate: false,
 *   minutesLate: 0,
 *   esdPassed: true,
 *   certificationsReady: true
 * }
 */
export async function aggregateAndUpsertPresence(rawRows = []) {
  return upsertTechnicianPresenceDaily(rawRows);
}

/* ─────────────────────────────────────────────
 * Full daily processing pipeline
 * Use this after all raw imports for a date are loaded.
 * ───────────────────────────────────────────── */
export async function processDailyMetricsPipeline({
  date,
  technicianMetricRows = [],
  presenceRows = [],
  scoreOptions = {},
}) {
  const dateOnly = toDateOnly(date);

  const metricUpsert = await aggregateAndUpsertTechnicianMetrics(technicianMetricRows);
  const presenceUpsert = await aggregateAndUpsertPresence(presenceRows);

  // Collect all unique dates from the imported rows so we rebuild artifacts
  // for every date that received data, not just the single form date.
  const allDates = new Set();
  allDates.add(dateOnly);
  for (const row of technicianMetricRows) {
    const d = norm(row.metricDate || row.date || row.workDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) allDates.add(d);
  }
  for (const row of presenceRows) {
    const d = norm(row.presenceDate || row.date || row.workDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) allDates.add(d);
  }

  // Rebuild for all dates — catch per-date errors so one bad date doesn't kill the batch
  const rebuildResults = [];
  const rebuildIssues = [];
  for (const d of Array.from(allDates).sort()) {
    try {
      rebuildResults.push(await rebuildDailyDashboardArtifacts(d, scoreOptions));
    } catch (err) {
      console.error(`[rebuild] Failed for ${d}:`, err);
      rebuildIssues.push(`Rebuild failed for ${d}: ${err.message}`);
      rebuildResults.push({
        shiftSummary: { created: 0, updated: 0 },
        scoreSummary: { created: 0, updated: 0, skipped: 0, issues: [`${d}: ${err.message}`] },
        staffSync: { synced: 0, created: 0, updated: 0 },
      });
    }
  }

  // Aggregate rebuild summaries
  const rebuildSummary = {
    datesProcessed: rebuildResults.length,
    shiftSummary: {
      created: rebuildResults.reduce((s, r) => s + r.shiftSummary.created, 0),
      updated: rebuildResults.reduce((s, r) => s + r.shiftSummary.updated, 0),
    },
    scoreSummary: {
      created: rebuildResults.reduce((s, r) => s + r.scoreSummary.created, 0),
      updated: rebuildResults.reduce((s, r) => s + r.scoreSummary.updated, 0),
      skipped: rebuildResults.reduce((s, r) => s + r.scoreSummary.skipped, 0),
      issues: rebuildResults.flatMap((r) => r.scoreSummary.issues || []),
    },
    staffSync: {
      synced: rebuildResults.reduce((s, r) => s + (r.staffSync?.synced || 0), 0),
      created: rebuildResults.reduce((s, r) => s + (r.staffSync?.created || 0), 0),
      updated: rebuildResults.reduce((s, r) => s + (r.staffSync?.updated || 0), 0),
      skipped: rebuildResults.reduce((s, r) => s + (r.staffSync?.skipped || 0), 0),
      issues: rebuildResults.flatMap((r) => r.staffSync?.issues || []),
    },
  };

  return {
    date: dateOnly,
    metricUpsert,
    presenceUpsert,
    rebuildSummary,
    rebuildIssues,
  };
}