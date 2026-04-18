import { Op } from 'sequelize';
import { StaffDailyMetric } from '../../models/index.js';

function round1(value) {
  return value == null || Number.isNaN(value) ? null : Math.round(value * 10) / 10;
}

function safePct(numerator, denominator) {
  if (!denominator) return null;
  return round1((numerator / denominator) * 100);
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
}

function avgFromTotal(total, count) {
  if (!count) return null;
  return round1(total / count);
}

function median(values) {
  const nums = values
    .filter((value) => value != null && !Number.isNaN(value))
    .sort((a, b) => a - b);

  if (!nums.length) return null;

  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return round1(nums[mid]);
  return round1((nums[mid - 1] + nums[mid]) / 2);
}

function dominantValue(rows, key) {
  const counts = new Map();

  for (const row of rows) {
    const raw = row?.[key];
    if (raw == null || raw === '') continue;
    const value = String(raw).trim();
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}

function buildMetricRollup(rows) {
  const totals = {
    daysTracked: rows.length,

    serversCompleted: sum(rows, 'serversCompleted'),
    racksCompleted: sum(rows, 'racksCompleted'),
    assignmentsClosed: sum(rows, 'assignmentsClosed'),
    checkInsCompleted: sum(rows, 'checkInsCompleted'),
    checkOutsCompleted: sum(rows, 'checkOutsCompleted'),

    repairAttempts: sum(rows, 'repairAttempts'),
    recoveredUnits: sum(rows, 'recoveredUnits'),
    firstTimeFixCount: sum(rows, 'firstTimeFixCount'),
    rerunSuccessCount: sum(rows, 'rerunSuccessCount'),
    rerunFailureCount: sum(rows, 'rerunFailureCount'),
    misdiagnosisCount: sum(rows, 'misdiagnosisCount'),
    escalationCount: sum(rows, 'escalationCount'),
    touchCountTotal: sum(rows, 'touchCountTotal'),
    touchCountUnits: sum(rows, 'touchCountUnits'),
    mttrMinutesTotal: sum(rows, 'mttrMinutesTotal'),
    mttrEvents: sum(rows, 'mttrEvents'),

    qualityEscapes: sum(rows, 'qualityEscapes'),
    repeatFailures: sum(rows, 'repeatFailures'),
    postRepairRetestSuccessCount: sum(rows, 'postRepairRetestSuccessCount'),
    postRepairRetestTotal: sum(rows, 'postRepairRetestTotal'),
    inspectionFinds: sum(rows, 'inspectionFinds'),
    defectAttributionCorrectCount: sum(rows, 'defectAttributionCorrectCount'),
    defectAttributionTotal: sum(rows, 'defectAttributionTotal'),

    timeToAttentionMinutesTotal: sum(rows, 'timeToAttentionMinutesTotal'),
    timeToAttentionEvents: sum(rows, 'timeToAttentionEvents'),
    technicianAddedDowntimeMinutes: sum(rows, 'technicianAddedDowntimeMinutes'),
    netDowntimeContributionMinutes: sum(rows, 'netDowntimeContributionMinutes'),
    idleGapMinutesTotal: sum(rows, 'idleGapMinutesTotal'),
    idleGapEvents: sum(rows, 'idleGapEvents'),
  };

  const samples = {
    daysTracked: totals.daysTracked,
    productionContributionDays: rows.filter((row) => row.productionContributionScore != null).length,
    utilizationDays: rows.filter((row) => row.utilizationPct != null).length,
    attendanceDays: rows.filter((row) => row.attendanceReliabilityPct != null).length,
    esdDays: rows.filter((row) => row.esdCompliancePct != null).length,
    certificationDays: rows.filter((row) => row.certificationHealthPct != null).length,
    crossTrainingDays: rows.filter((row) => row.crossTrainingReadinessPct != null).length,
    mttrEvents: totals.mttrEvents,
    repairAttempts: totals.repairAttempts,
    rerunEvents: totals.rerunSuccessCount + totals.rerunFailureCount,
    touchCountUnits: totals.touchCountUnits,
    recoveredUnits: totals.recoveredUnits,
    postRepairRetestTotal: totals.postRepairRetestTotal,
    defectAttributionTotal: totals.defectAttributionTotal,
    timeToAttentionEvents: totals.timeToAttentionEvents,
    idleGapEvents: totals.idleGapEvents,
  };

  const derived = {
    productionContributionScore: avgFromTotal(
      sum(rows, 'productionContributionScore'),
      samples.productionContributionDays
    ),

    avgServersCompletedPerDay: avgFromTotal(totals.serversCompleted, totals.daysTracked),
    avgRacksCompletedPerDay: avgFromTotal(totals.racksCompleted, totals.daysTracked),
    avgAssignmentsClosedPerDay: avgFromTotal(totals.assignmentsClosed, totals.daysTracked),

    mttrMinutes: avgFromTotal(totals.mttrMinutesTotal, totals.mttrEvents),
    firstTimeFixRate: safePct(totals.firstTimeFixCount, totals.repairAttempts),
    rerunSuccessRate: safePct(
      totals.rerunSuccessCount,
      totals.rerunSuccessCount + totals.rerunFailureCount
    ),
    misdiagnosisRate: safePct(totals.misdiagnosisCount, totals.repairAttempts),
    escalationRate: safePct(totals.escalationCount, totals.repairAttempts),
    touchCountPerUnit: avgFromTotal(totals.touchCountTotal, totals.touchCountUnits),
    attemptsToPass: avgFromTotal(totals.repairAttempts, totals.recoveredUnits),
    recoveryYieldRate: safePct(totals.recoveredUnits, totals.repairAttempts),

    repeatFailureRate: safePct(totals.repeatFailures, totals.recoveredUnits),
    postRepairRetestSuccessRate: safePct(
      totals.postRepairRetestSuccessCount,
      totals.postRepairRetestTotal
    ),
    defectAttributionAccuracy: safePct(
      totals.defectAttributionCorrectCount,
      totals.defectAttributionTotal
    ),
    qualityEscapesPer100RecoveredUnits:
      totals.recoveredUnits > 0
        ? round1((totals.qualityEscapes / totals.recoveredUnits) * 100)
        : null,

    avgTimeToAttentionMinutes: avgFromTotal(
      totals.timeToAttentionMinutesTotal,
      totals.timeToAttentionEvents
    ),
    avgIdleGapMinutes: avgFromTotal(totals.idleGapMinutesTotal, totals.idleGapEvents),
    technicianAddedDowntimeMinutes: round1(totals.technicianAddedDowntimeMinutes),
    netDowntimeContributionMinutes: round1(totals.netDowntimeContributionMinutes),

    utilizationPct: avgFromTotal(sum(rows, 'utilizationPct'), samples.utilizationDays),
    attendanceReliabilityPct: avgFromTotal(
      sum(rows, 'attendanceReliabilityPct'),
      samples.attendanceDays
    ),
    esdCompliancePct: avgFromTotal(sum(rows, 'esdCompliancePct'), samples.esdDays),
    certificationHealthPct: avgFromTotal(
      sum(rows, 'certificationHealthPct'),
      samples.certificationDays
    ),
    crossTrainingReadinessPct: avgFromTotal(
      sum(rows, 'crossTrainingReadinessPct'),
      samples.crossTrainingDays
    ),
  };

  return { totals, derived, samples };
}

async function buildCohortSummary({ staffId, startDate, endDate, shift, area }) {
  if (!shift && !area) {
    return {
      scope: { shift: null, area: null },
      sampleSize: 0,
      medians: {},
    };
  }

  const where = {
    staffId: { [Op.ne]: staffId },
    metricDate: {
      [Op.gte]: startDate,
      [Op.lte]: endDate,
    },
  };

  if (shift) where.shift = shift;
  if (area) where.area = area;

  const cohortRows = await StaffDailyMetric.findAll({
    where,
    order: [['metricDate', 'ASC']],
  });

  const byStaff = new Map();
  for (const row of cohortRows) {
    const key = row.staffId;
    if (!byStaff.has(key)) byStaff.set(key, []);
    byStaff.get(key).push(row);
  }

  const peerRollups = [...byStaff.values()]
    .map((rowsForStaff) => buildMetricRollup(rowsForStaff))
    .filter((rollup) => rollup.totals.daysTracked > 0);

  const medians = {
    avgServersCompletedPerDay: median(peerRollups.map((rollup) => rollup.derived.avgServersCompletedPerDay)),
    avgRacksCompletedPerDay: median(peerRollups.map((rollup) => rollup.derived.avgRacksCompletedPerDay)),
    avgAssignmentsClosedPerDay: median(
      peerRollups.map((rollup) => rollup.derived.avgAssignmentsClosedPerDay)
    ),
    productionContributionScore: median(
      peerRollups.map((rollup) => rollup.derived.productionContributionScore)
    ),
    mttrMinutes: median(peerRollups.map((rollup) => rollup.derived.mttrMinutes)),
    firstTimeFixRate: median(peerRollups.map((rollup) => rollup.derived.firstTimeFixRate)),
    rerunSuccessRate: median(peerRollups.map((rollup) => rollup.derived.rerunSuccessRate)),
    misdiagnosisRate: median(peerRollups.map((rollup) => rollup.derived.misdiagnosisRate)),
    escalationRate: median(peerRollups.map((rollup) => rollup.derived.escalationRate)),
    touchCountPerUnit: median(peerRollups.map((rollup) => rollup.derived.touchCountPerUnit)),
    recoveryYieldRate: median(peerRollups.map((rollup) => rollup.derived.recoveryYieldRate)),
    qualityEscapesPer100RecoveredUnits: median(
      peerRollups.map((rollup) => rollup.derived.qualityEscapesPer100RecoveredUnits)
    ),
    repeatFailureRate: median(peerRollups.map((rollup) => rollup.derived.repeatFailureRate)),
    postRepairRetestSuccessRate: median(
      peerRollups.map((rollup) => rollup.derived.postRepairRetestSuccessRate)
    ),
    defectAttributionAccuracy: median(
      peerRollups.map((rollup) => rollup.derived.defectAttributionAccuracy)
    ),
    avgTimeToAttentionMinutes: median(
      peerRollups.map((rollup) => rollup.derived.avgTimeToAttentionMinutes)
    ),
    avgIdleGapMinutes: median(peerRollups.map((rollup) => rollup.derived.avgIdleGapMinutes)),
    technicianAddedDowntimeMinutes: median(
      peerRollups.map((rollup) => rollup.derived.technicianAddedDowntimeMinutes)
    ),
    netDowntimeContributionMinutes: median(
      peerRollups.map((rollup) => rollup.derived.netDowntimeContributionMinutes)
    ),
    utilizationPct: median(peerRollups.map((rollup) => rollup.derived.utilizationPct)),
    attendanceReliabilityPct: median(
      peerRollups.map((rollup) => rollup.derived.attendanceReliabilityPct)
    ),
    esdCompliancePct: median(peerRollups.map((rollup) => rollup.derived.esdCompliancePct)),
    certificationHealthPct: median(
      peerRollups.map((rollup) => rollup.derived.certificationHealthPct)
    ),
    crossTrainingReadinessPct: median(
      peerRollups.map((rollup) => rollup.derived.crossTrainingReadinessPct)
    ),
  };

  return {
    scope: { shift: shift || null, area: area || null },
    sampleSize: peerRollups.length,
    medians,
  };
}

export async function getStaffMetricWindow({
  staffId,
  startDate = null,
  endDate = null,
}) {
  const where = { staffId };

  if (startDate || endDate) {
    where.metricDate = {};
    if (startDate) where.metricDate[Op.gte] = startDate;
    if (endDate) where.metricDate[Op.lte] = endDate;
  }

  return StaffDailyMetric.findAll({
    where,
    order: [['metricDate', 'ASC']],
  });
}

export async function buildOperationalMetricSummary({
  staffId,
  days = 90,
}) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days + 1);

  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const rows = await getStaffMetricWindow({
    staffId,
    startDate,
    endDate,
  });

  const { totals, derived, samples } = buildMetricRollup(rows);
  const shift = dominantValue(rows, 'shift');
  const area = dominantValue(rows, 'area');
  const cohort = await buildCohortSummary({
    staffId,
    startDate,
    endDate,
    shift,
    area,
  });

  return {
    rows,
    startDate,
    endDate,
    totals,
    derived,
    samples,
    scope: {
      shift,
      area,
    },
    cohort,
  };
}
