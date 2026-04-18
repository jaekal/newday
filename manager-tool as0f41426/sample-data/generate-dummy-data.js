// sample-data/generate-dummy-data.js
// Generates 6 source CSV files + merged consolidated output for John Doe (EMP-1001)
// spanning Jan 1 – Mar 25, 2026 (weekdays only, ~60 working days)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──
const EMP = 'EMP-1001';
const BUILDING = 'BLD-A';
const SHIFT = 'DAY';
const AREA = 'ZONE-2';
const PRODUCT = 'SERVER-X3';
const TEST_STAGE = 'BURN-IN';

// ── Date range: weekdays Jan 1 – Mar 25, 2026 ──
function getWorkdays(startStr, endStr) {
  const days = [];
  const d = new Date(startStr);
  const end = new Date(endStr);
  while (d <= end) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      days.push(d.toISOString().slice(0, 10));
    }
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const workdays = getWorkdays('2026-01-01', '2026-03-25');

// ── Helpers ──
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randf(min, max, decimals = 1) { return +(Math.random() * (max - min) + min).toFixed(decimals); }
function chance(pct) { return Math.random() * 100 < pct; }
function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = row[h];
      if (v === undefined || v === null) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

// ── Progression: John Doe improves over the 3 months ──
// Month 1: ramping up (lower throughput, higher MTTR, more escapes)
// Month 2: steady performer
// Month 3: strong performer (high throughput, low MTTR, minimal escapes)
function monthTier(date) {
  const m = parseInt(date.slice(5, 7));
  if (m === 1) return 0; // ramp
  if (m === 2) return 1; // steady
  return 2; // strong
}

// ────────────────────────────────────────
// SOURCE 1: MES
// ────────────────────────────────────────
const mesRows = workdays.map(date => {
  const tier = monthTier(date);
  const assigned = [rand(30, 40), rand(38, 48), rand(45, 55)][tier];
  const completionRate = [randf(0.82, 0.90), randf(0.90, 0.95), randf(0.94, 0.99)][tier];
  const completed = Math.min(assigned, Math.round(assigned * completionRate));
  const racksA = [rand(5, 7), rand(7, 9), rand(8, 11)][tier];
  const racksC = Math.min(racksA, Math.round(racksA * completionRate));
  const checks = [rand(80, 100), rand(100, 120), rand(110, 130)][tier];
  const validChecks = Math.round(checks * [randf(0.92, 0.96), randf(0.95, 0.98), randf(0.97, 0.995)][tier]);
  const inspExp = [rand(8, 12), rand(12, 16), rand(14, 18)][tier];
  const inspComp = Math.round(inspExp * [randf(0.85, 0.93), randf(0.92, 0.97), randf(0.96, 1.0)][tier]);
  const repaired = [rand(8, 14), rand(12, 18), rand(15, 22)][tier];
  const handled = assigned + rand(2, 8);
  const passed = completed - rand(0, 3);
  const sysDel = [randf(10, 25), randf(5, 15), randf(2, 10)][tier];
  const partWait = [randf(5, 18), randf(3, 10), randf(1, 6)][tier];
  const infraMin = [randf(2, 12), randf(1, 6), randf(0, 4)][tier];
  const complexity = [randf(1.0, 1.3), randf(1.0, 1.2), randf(1.0, 1.15)][tier];

  return {
    employeeId: EMP, date, building: BUILDING, shift: SHIFT, area: AREA, productFamily: PRODUCT,
    serversAssigned: assigned, serversCompleted: completed,
    racksAssigned: racksA, racksCompleted: racksC,
    expectedCheckActions: checks, validCheckActions: validChecks,
    inspectionsExpected: inspExp, inspectionsCompleted: inspComp,
    unitsRepaired: repaired, unitsHandled: handled, unitsPassed: passed,
    excludedSystemDelayMinutes: sysDel, excludedPartWaitMinutes: partWait,
    excludedInfraMinutes: infraMin, complexityMultiplier: complexity,
    sourceBatchId: `BATCH-${date}-${SHIFT}`,
  };
});

const MES_HEADERS = [
  'employeeId','date','building','shift','area','productFamily',
  'serversAssigned','serversCompleted','racksAssigned','racksCompleted',
  'expectedCheckActions','validCheckActions','inspectionsExpected','inspectionsCompleted',
  'unitsRepaired','unitsHandled','unitsPassed',
  'excludedSystemDelayMinutes','excludedPartWaitMinutes','excludedInfraMinutes',
  'complexityMultiplier','sourceBatchId',
];

// ────────────────────────────────────────
// SOURCE 2: Testing Dashboard
// ────────────────────────────────────────
const testDashRows = workdays.map((date, i) => {
  const tier = monthTier(date);
  const mesRow = mesRows[i];
  const repaired = mesRow.unitsRepaired;
  const ftfRate = [randf(0.65, 0.78), randf(0.78, 0.86), randf(0.85, 0.94)][tier];
  const firstRerun = Math.round(repaired * ftfRate);
  const eventualRate = [randf(0.82, 0.90), randf(0.90, 0.95), randf(0.94, 0.99)][tier];
  const eventualPassed = Math.min(repaired, Math.round(repaired * eventualRate));
  const totalReruns = repaired + rand(1, 5);
  const successReruns = Math.round(totalReruns * [randf(0.70, 0.80), randf(0.80, 0.88), randf(0.87, 0.95)][tier]);
  const escalated = [rand(1, 3), rand(0, 2), rand(0, 1)][tier];
  const failedWorked = repaired + escalated;
  const attemptsPerUnit = [randf(1.5, 2.0), randf(1.2, 1.5), randf(1.0, 1.3)][tier];
  const passedRepairCount = eventualPassed;
  const totalAttempts = +(attemptsPerUnit * passedRepairCount).toFixed(1);
  const mttrPer = [randf(22, 32), randf(16, 22), randf(12, 18)][tier];
  const mttrSamples = repaired;
  const mttrTotal = +(mttrPer * mttrSamples).toFixed(1);
  const escapes = [rand(0, 2), rand(0, 1), chance(15) ? 1 : 0][tier];
  const repeatFails = [rand(0, 3), rand(0, 2), rand(0, 1)][tier];
  const repairedForCheck = eventualPassed;
  const inspCaught = [rand(2, 5), rand(3, 6), rand(4, 7)][tier];
  const totalIssues = inspCaught + rand(0, 2);
  const incorrectRepairs = [rand(0, 2), rand(0, 1), chance(10) ? 1 : 0][tier];
  const totalRepairActs = repaired + rand(0, 3);
  const techDefects = [rand(0, 2), rand(0, 1), chance(8) ? 1 : 0][tier];

  return {
    employeeId: EMP, date, testStage: TEST_STAGE,
    unitsPassedFirstRerun: firstRerun, unitsEventuallyPassed: eventualPassed,
    successfulReruns: successReruns, totalReruns,
    escalatedUnits: escalated, totalFailedUnitsWorked: failedWorked,
    totalAttemptsToPass: totalAttempts, passedRepairUnitCount: passedRepairCount,
    mttrMinutesTotal: mttrTotal, mttrSampleCount: mttrSamples,
    postTestEscapes: escapes, repeatFailures: repeatFails,
    repairedUnitsForRepeatCheck: repairedForCheck,
    inspectionIssuesCaught: inspCaught, totalIssuesFound: totalIssues,
    incorrectRepairActions: incorrectRepairs, totalRepairActions: totalRepairActs,
    technicianAttributedDefects: techDefects,
  };
});

const TEST_HEADERS = [
  'employeeId','date','testStage',
  'unitsPassedFirstRerun','unitsEventuallyPassed','successfulReruns','totalReruns',
  'escalatedUnits','totalFailedUnitsWorked',
  'totalAttemptsToPass','passedRepairUnitCount','mttrMinutesTotal','mttrSampleCount',
  'postTestEscapes','repeatFailures','repairedUnitsForRepeatCheck',
  'inspectionIssuesCaught','totalIssuesFound',
  'incorrectRepairActions','totalRepairActions','technicianAttributedDefects',
];

// ────────────────────────────────────────
// SOURCE 3: Attendance
// ────────────────────────────────────────
const attendanceRows = workdays.map(date => {
  const tier = monthTier(date);
  const wasLate = [chance(18), chance(10), chance(4)][tier];
  const minsLate = wasLate ? [rand(3, 15), rand(2, 8), rand(1, 5)][tier] : 0;
  return {
    employeeId: EMP, date, shift: SHIFT, building: BUILDING,
    wasScheduled: 1, wasPresent: 1, wasActiveTechnician: 1,
    wasLate: wasLate ? 1 : 0, minutesLate: minsLate,
    scheduledShifts: 1, shiftsAttendedOnTime: wasLate ? 0 : 1, daysWorked: 1,
    infractionPoints: wasLate && minsLate > 10 ? 0.5 : 0,
    assignmentStatus: 'ACTIVE',
  };
});

const ATT_HEADERS = [
  'employeeId','date','shift','building',
  'wasScheduled','wasPresent','wasActiveTechnician','wasLate','minutesLate',
  'scheduledShifts','shiftsAttendedOnTime','daysWorked','infractionPoints',
  'assignmentStatus',
];

// ────────────────────────────────────────
// SOURCE 4: ESD
// ────────────────────────────────────────
// NOTE: Use per-day values (not cumulative running totals).
// The sync computes esdCompliancePct = safePct(daysWithSuccessfulEsd, totalEsdDays) per row.
// Using per-day 1/1 or 0/1 gives correct 100% or 0% per day; the aggregation then
// averages these to get the actual overall pass rate.
const esdRows = [];
for (const date of workdays) {
  const tier = monthTier(date);
  const passed = [chance(92), chance(97), chance(99)][tier];
  const firstPass = passed ? [chance(85), chance(92), chance(97)][tier] : false;
  esdRows.push({
    employeeId: EMP, date,
    esdPassed: passed ? 1 : 0,
    esdFirstPass: firstPass ? 1 : 0,
    daysWithSuccessfulEsd: passed ? 1 : 0, // per-day: 1 if passed today, 0 if not
    esdFirstPassDays: firstPass ? 1 : 0,   // per-day: 1 if first-pass today
    totalEsdDays: 1,                        // always 1 — tested exactly once per day
  });
}

const ESD_HEADERS = [
  'employeeId','date','esdPassed','esdFirstPass',
  'daysWithSuccessfulEsd','esdFirstPassDays','totalEsdDays',
];

// ────────────────────────────────────────
// SOURCE 5: Training
// ────────────────────────────────────────
// Training snapshots: one per week (Fridays)
const trainingRows = workdays.filter(d => new Date(d).getDay() === 5).map(date => {
  const tier = monthTier(date);
  const planned = 8;
  const completed = [rand(1, 3), rand(3, 5), rand(5, 7)][tier];
  return {
    employeeId: EMP, date,
    plannedCrossTrainingModules: planned,
    completedCrossTrainingModules: Math.min(planned, completed),
    certificationsReady: tier >= 1 ? 1 : (chance(80) ? 1 : 0),
  };
});
// Also produce daily rows by forward-filling weekly snapshots
const trainingDaily = [];
let lastTraining = { plannedCrossTrainingModules: 8, completedCrossTrainingModules: 0, certificationsReady: 0 };
const trainingMap = new Map(trainingRows.map(r => [r.date, r]));
for (const date of workdays) {
  if (trainingMap.has(date)) lastTraining = trainingMap.get(date);
  trainingDaily.push({
    employeeId: EMP, date,
    plannedCrossTrainingModules: lastTraining.plannedCrossTrainingModules,
    completedCrossTrainingModules: lastTraining.completedCrossTrainingModules,
    certificationsReady: lastTraining.certificationsReady,
  });
}

const TRAIN_HEADERS = [
  'employeeId','date','plannedCrossTrainingModules','completedCrossTrainingModules','certificationsReady',
];

// ────────────────────────────────────────
// SOURCE 6: Manual Entry
// ────────────────────────────────────────
// Supervisors log events ~2-3 times per week
const manualRows = workdays.filter(() => chance(35)).map(date => {
  const tier = monthTier(date);
  const notes = [
    'Helped new tech with burn-in procedure',
    'Led safety standup meeting',
    'Participated in Kaizen event',
    'Mentored junior technician on rack assembly',
    'Presented process improvement idea',
    'Assisted with cross-shift handoff documentation',
    'Covered for absent lead during standup',
  ];
  return {
    employeeId: EMP, date,
    knowledgeSharingEvents: chance(50) ? rand(1, 2) : 0,
    ciParticipationEvents: chance(30) ? 1 : 0,
    leadershipSupportEvents: chance(25 + tier * 10) ? 1 : 0,
    notes: notes[rand(0, notes.length - 1)],
  };
});

const MANUAL_HEADERS = [
  'employeeId','date','knowledgeSharingEvents','ciParticipationEvents','leadershipSupportEvents','notes',
];

// ────────────────────────────────────────
// MERGED OUTPUT (what the system produces)
// ────────────────────────────────────────
const mergedRows = workdays.map((date, i) => {
  const mes = mesRows[i];
  const test = testDashRows[i];
  const att = attendanceRows[i];
  const esd = esdRows[i];
  const train = trainingDaily[i];
  const manual = manualRows.find(r => r.date === date) || {};

  return {
    date,
    employeeId: EMP,
    username: '',
    email: '',
    building: BUILDING,
    shift: SHIFT,
    area: AREA,
    productFamily: PRODUCT,
    testStage: TEST_STAGE,
    // Productivity (MES)
    serversAssigned: mes.serversAssigned,
    serversCompleted: mes.serversCompleted,
    racksAssigned: mes.racksAssigned,
    racksCompleted: mes.racksCompleted,
    expectedCheckActions: mes.expectedCheckActions,
    validCheckActions: mes.validCheckActions,
    inspectionsExpected: mes.inspectionsExpected,
    inspectionsCompleted: mes.inspectionsCompleted,
    // Troubleshooting (Testing Dashboard)
    unitsRepaired: mes.unitsRepaired,
    unitsPassedFirstRerun: test.unitsPassedFirstRerun,
    unitsEventuallyPassed: test.unitsEventuallyPassed,
    successfulReruns: test.successfulReruns,
    totalReruns: test.totalReruns,
    escalatedUnits: test.escalatedUnits,
    totalFailedUnitsWorked: test.totalFailedUnitsWorked,
    totalAttemptsToPass: test.totalAttemptsToPass,
    passedRepairUnitCount: test.passedRepairUnitCount,
    mttrMinutesTotal: test.mttrMinutesTotal,
    mttrSampleCount: test.mttrSampleCount,
    // Quality (Testing Dashboard)
    postTestEscapes: test.postTestEscapes,
    unitsPassed: mes.unitsPassed,
    repeatFailures: test.repeatFailures,
    repairedUnitsForRepeatCheck: test.repairedUnitsForRepeatCheck,
    inspectionIssuesCaught: test.inspectionIssuesCaught,
    totalIssuesFound: test.totalIssuesFound,
    incorrectRepairActions: test.incorrectRepairActions,
    totalRepairActions: test.totalRepairActions,
    technicianAttributedDefects: test.technicianAttributedDefects,
    unitsHandled: mes.unitsHandled,
    // Compliance (Attendance)
    scheduledShifts: att.scheduledShifts,
    shiftsAttendedOnTime: att.shiftsAttendedOnTime,
    daysWorked: att.daysWorked,
    // Compliance (ESD)
    daysWithSuccessfulEsd: esd.daysWithSuccessfulEsd,
    esdFirstPassDays: esd.esdFirstPassDays,
    totalEsdDays: esd.totalEsdDays,
    infractionPoints: att.infractionPoints,
    // Development (Training)
    plannedCrossTrainingModules: train.plannedCrossTrainingModules,
    completedCrossTrainingModules: train.completedCrossTrainingModules,
    // Development (Manual)
    knowledgeSharingEvents: manual.knowledgeSharingEvents || 0,
    ciParticipationEvents: manual.ciParticipationEvents || 0,
    leadershipSupportEvents: manual.leadershipSupportEvents || 0,
    // Exclusions (MES)
    excludedSystemDelayMinutes: mes.excludedSystemDelayMinutes,
    excludedPartWaitMinutes: mes.excludedPartWaitMinutes,
    excludedInfraMinutes: mes.excludedInfraMinutes,
    complexityMultiplier: mes.complexityMultiplier,
    sourceBatchId: '',
    notes: manual.notes || '',
  };
});

const MERGED_HEADERS = [
  'date','employeeId','username','email','building','shift','area','productFamily','testStage',
  'serversAssigned','serversCompleted','racksAssigned','racksCompleted',
  'expectedCheckActions','validCheckActions','inspectionsExpected','inspectionsCompleted',
  'unitsRepaired','unitsPassedFirstRerun','unitsEventuallyPassed','successfulReruns','totalReruns',
  'escalatedUnits','totalFailedUnitsWorked',
  'totalAttemptsToPass','passedRepairUnitCount','mttrMinutesTotal','mttrSampleCount',
  'postTestEscapes','unitsPassed','repeatFailures','repairedUnitsForRepeatCheck',
  'inspectionIssuesCaught','totalIssuesFound','incorrectRepairActions','totalRepairActions',
  'technicianAttributedDefects','unitsHandled',
  'scheduledShifts','shiftsAttendedOnTime','daysWorked',
  'daysWithSuccessfulEsd','esdFirstPassDays','totalEsdDays','infractionPoints',
  'plannedCrossTrainingModules','completedCrossTrainingModules',
  'knowledgeSharingEvents','ciParticipationEvents','leadershipSupportEvents',
  'excludedSystemDelayMinutes','excludedPartWaitMinutes','excludedInfraMinutes',
  'complexityMultiplier','sourceBatchId','notes',
];

// Presence merged output
const presenceRows = workdays.map((date, i) => {
  const att = attendanceRows[i];
  const esd = esdRows[i];
  const train = trainingDaily[i];
  return {
    date, employeeId: EMP, username: '', email: '',
    building: BUILDING, shift: SHIFT, area: AREA,
    wasScheduled: att.wasScheduled, wasPresent: att.wasPresent,
    wasActiveTechnician: 1, wasLate: att.wasLate, minutesLate: att.minutesLate,
    esdPassed: esd.esdPassed, certificationsReady: train.certificationsReady,
    assignmentStatus: '', notes: '',
  };
});

const PRESENCE_HEADERS = [
  'date','employeeId','username','email','building','shift','area',
  'wasScheduled','wasPresent','wasActiveTechnician','wasLate','minutesLate',
  'esdPassed','certificationsReady','assignmentStatus','notes',
];

// ── Write all files ──
const outDir = __dirname;
const files = [
  ['01_mes_export.csv', MES_HEADERS, mesRows],
  ['02_testing_dashboard_export.csv', TEST_HEADERS, testDashRows],
  ['03_attendance_hr_export.csv', ATT_HEADERS, attendanceRows],
  ['04_esd_badge_export.csv', ESD_HEADERS, esdRows],
  ['05_training_lms_export.csv', TRAIN_HEADERS, trainingDaily],
  ['06_supervisor_manual_entry.csv', MANUAL_HEADERS, manualRows],
  ['MERGED_technician_daily_metrics.csv', MERGED_HEADERS, mergedRows],
  ['MERGED_technician_presence_daily.csv', PRESENCE_HEADERS, presenceRows],
];

for (const [name, headers, rows] of files) {
  fs.writeFileSync(path.join(outDir, name), toCsv(headers, rows), 'utf8');
  console.log(`  wrote ${name} (${rows.length} rows)`);
}

console.log(`\nDone! ${workdays.length} workdays generated (${workdays[0]} to ${workdays[workdays.length - 1]})`);
