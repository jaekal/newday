// src/services/technicianToStaffMetricSync.js
// Transforms TechnicianDailyMetric rows into StaffDailyMetric rows.
// This bridges the raw import model (TechnicianDailyMetric) and the
// staff profile display model (StaffDailyMetric).

import {
  TechnicianDailyMetric,
  TechnicianPresenceDaily,
  StaffDailyMetric,
} from '../models/index.js';

function safe(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safePct(num, den) {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}

/**
 * For a given date, reads all TechnicianDailyMetric rows and
 * (optionally) TechnicianPresenceDaily rows, then upserts
 * corresponding StaffDailyMetric records.
 *
 * If a technician has multiple TechnicianDailyMetric rows for the same
 * date (different shift/area/product/stage combos), they are summed
 * into a single StaffDailyMetric row per (staffId, metricDate, shift).
 */
export async function syncTechnicianToStaffMetrics(date) {
  const techRows = await TechnicianDailyMetric.findAll({
    where: { metricDate: date },
  });

  const presenceRows = await TechnicianPresenceDaily.findAll({
    where: { presenceDate: date },
  });

  console.log(`[staffSync] date=${date} found ${techRows.length} tech rows, ${presenceRows.length} presence rows`);

  const presenceByUser = new Map();
  for (const p of presenceRows) {
    presenceByUser.set(p.userId, p);
  }

  // Group technician rows by (userId, shift)
  const grouped = new Map();
  for (const row of techRows) {
    const key = `${row.userId}||${row.shift || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, { userId: row.userId, shift: row.shift || '', rows: [] });
    }
    grouped.get(key).rows.push(row);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const { userId, shift, rows } of grouped.values()) {
   try {
    // Sum across all rows for this user+shift+date
    const s = (field) => rows.reduce((acc, r) => acc + safe(r[field]), 0);

    const serversCompleted = s('serversCompleted');
    const racksCompleted = s('racksCompleted');
    const unitsRepaired = s('unitsRepaired');
    const unitsEventuallyPassed = s('unitsEventuallyPassed');
    const unitsPassedFirstRerun = s('unitsPassedFirstRerun');
    const successfulReruns = s('successfulReruns');
    const totalReruns = s('totalReruns');
    const incorrectRepairActions = s('incorrectRepairActions');
    const escalatedUnits = s('escalatedUnits');
    const unitsHandled = s('unitsHandled');
    const totalRepairActions = s('totalRepairActions');
    const mttrMinutesTotal = s('mttrMinutesTotal');
    const mttrSampleCount = s('mttrSampleCount');
    const postTestEscapes = s('postTestEscapes');
    const repeatFailures = s('repeatFailures');
    const repairedUnitsForRepeatCheck = s('repairedUnitsForRepeatCheck');
    const inspectionIssuesCaught = s('inspectionIssuesCaught');
    const technicianAttributedDefects = s('technicianAttributedDefects');
    const validCheckActions = s('validCheckActions');
    const inspectionsCompleted = s('inspectionsCompleted');

    // Compliance raw values
    const scheduledShifts = s('scheduledShifts');
    const shiftsAttendedOnTime = s('shiftsAttendedOnTime');
    const daysWithSuccessfulEsd = s('daysWithSuccessfulEsd');
    const totalEsdDays = s('totalEsdDays');
    const plannedCrossTrainingModules = s('plannedCrossTrainingModules');
    const completedCrossTrainingModules = s('completedCrossTrainingModules');

    // Presence info for utilization context
    const presence = presenceByUser.get(userId);

    const payload = {
      staffId: userId,
      metricDate: date,
      shift: shift || null,
      area: rows[0]?.area || null,

      // A. Throughput / Execution
      serversCompleted,
      racksCompleted,
      assignmentsClosed: serversCompleted + racksCompleted,
      checkInsCompleted: validCheckActions,
      checkOutsCompleted: inspectionsCompleted,
      productionContributionScore: null, // requires shift-level context, set by shift rollup

      // B. Troubleshooting Effectiveness
      repairAttempts: unitsRepaired,
      recoveredUnits: unitsEventuallyPassed,
      firstTimeFixCount: unitsPassedFirstRerun,
      rerunSuccessCount: successfulReruns,
      rerunFailureCount: Math.max(0, totalReruns - successfulReruns),
      misdiagnosisCount: incorrectRepairActions,
      escalationCount: escalatedUnits,
      touchCountTotal: totalRepairActions,
      touchCountUnits: unitsHandled,
      mttrMinutesTotal,
      mttrEvents: mttrSampleCount,

      // C. Quality Protection
      qualityEscapes: postTestEscapes,
      repeatFailures,
      postRepairRetestSuccessCount: unitsEventuallyPassed,
      postRepairRetestTotal: repairedUnitsForRepeatCheck || unitsRepaired,
      inspectionFinds: inspectionIssuesCaught,
      defectAttributionCorrectCount: Math.max(0, unitsHandled - technicianAttributedDefects),
      defectAttributionTotal: unitsHandled,

      // D. Time Ownership / Downtime Management
      // These come from excludedX fields — convert to time metrics
      timeToAttentionMinutesTotal: 0, // not directly available from technician metrics
      timeToAttentionEvents: 0,
      technicianAddedDowntimeMinutes: s('excludedSystemDelayMinutes'),
      netDowntimeContributionMinutes:
        s('excludedSystemDelayMinutes') + s('excludedPartWaitMinutes') + s('excludedInfraMinutes'),
      utilizationPct: null,
      idleGapMinutesTotal: s('excludedPartWaitMinutes') + s('excludedInfraMinutes'),
      idleGapEvents: rows.length,

      // E. Reliability / Readiness (derived percentages)
      attendanceReliabilityPct: safePct(shiftsAttendedOnTime, scheduledShifts),
      esdCompliancePct: safePct(daysWithSuccessfulEsd, totalEsdDays),
      certificationHealthPct: presence?.certificationsReady ? 100 : 0,
      crossTrainingReadinessPct: safePct(completedCrossTrainingModules, plannedCrossTrainingModules),

      source: 'technician-import-sync',
    };

    // Search for existing row — handle both null and empty string for shift
    const whereClause = { staffId: userId, metricDate: date };
    if (shift) {
      whereClause.shift = shift;
    }
    // Find any existing row for this user+date (with matching or null/empty shift)
    const existing = await StaffDailyMetric.findOne({ where: whereClause });

    if (!existing) {
      await StaffDailyMetric.create(payload);
      created++;
    } else {
      await existing.update(payload);
      updated++;
    }
   } catch (err) {
    skipped++;
    issues.push(`StaffMetric sync error for userId=${userId} date=${date}: ${err.message}`);
   }
  }

  return { date, synced: grouped.size, created, updated, skipped, issues };
}
