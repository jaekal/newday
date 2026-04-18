// src/services/staff/staffProfileComplianceService.js
import { EsdCheck, Attendance } from '../../models/index.js';
import { formatTimeLabel, getShiftMeta } from './staffAccessService.js';

export async function buildComplianceSummary({ staffId, profile }) {
  const [esdPart, attendancePart] = await Promise.all([
    buildEsdSummary({ staffId, profile }),
    buildAttendanceSummary({ staffId }),
  ]);

  const esdStreak = computeEsdStreak(esdPart.esdDailySummary);
  const lateTrendDelta = computeLateTrendDelta(attendancePart.attendanceDailySummary);
  const absencePattern = detectAbsencePatterns(attendancePart.attendanceDailySummary);

  return {
    esdDailySummary: esdPart.esdDailySummary,
    esdStats: esdPart.esdStats,
    attendanceDailySummary: attendancePart.attendanceDailySummary,
    attendanceStats: attendancePart.attendanceStats,
    esdStreak,
    lateTrendDelta,
    absencePattern,
  };
}

function computeEsdStreak(esdDailySummary) {
  // summary is sorted descending by date — walk forward while PASS
  let streak = 0;
  for (const day of esdDailySummary) {
    if (day.finalResult === 'PASS') streak++;
    else break;
  }
  return streak;
}

function computeLateTrendDelta(attendanceDailySummary) {
  const now = new Date();
  const cutoff30 = new Date(now); cutoff30.setDate(now.getDate() - 30);
  const cutoff60 = new Date(now); cutoff60.setDate(now.getDate() - 60);

  let recent = [], prior = [];
  for (const d of attendanceDailySummary) {
    const dt = new Date(d.date);
    if (d.minutesLate == null || d.minutesLate <= 0) continue;
    if (dt >= cutoff30) recent.push(d.minutesLate);
    else if (dt >= cutoff60) prior.push(d.minutesLate);
  }

  const avg = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);

  return {
    recentAvg,
    priorAvg,
    delta: recentAvg != null && priorAvg != null ? recentAvg - priorAvg : null,
  };
}

function detectAbsencePatterns(attendanceDailySummary) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 60);
  let mondayAbsences = 0, fridayAbsences = 0;

  for (const d of attendanceDailySummary) {
    if (d.status !== 'ABSENT') continue;
    if (new Date(d.date) < cutoff) continue;
    const dow = new Date(d.date).getDay(); // 0=Sun,1=Mon,...,5=Fri
    if (dow === 1) mondayAbsences++;
    if (dow === 5) fridayAbsences++;
  }

  return {
    mondayAbsences,
    fridayAbsences,
    flagged: mondayAbsences >= 2 || fridayAbsences >= 2,
  };
}

async function buildEsdSummary({ staffId, profile }) {
  let esdDailySummary = [];
  let esdStats = {
    totalDays: 0,
    daysWithPassBeforeShift: 0,
    daysWithPassAfterShift: 0,
    daysWithoutPass: 0,
  };

  const esdChecks = await EsdCheck.findAll({
    where: { staffId },
    order: [['logDateTime', 'ASC']],
  });

  if (!esdChecks?.length) return { esdDailySummary, esdStats };

  const byDate = new Map();
  esdChecks.forEach((check) => {
    const dt = new Date(check.logDateTime);
    if (Number.isNaN(dt.getTime())) return;

    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate()
    ).padStart(2, '0')}`;

    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(check);
  });

  const { shiftLabel, startHour } = getShiftMeta(profile);

  for (const [dateKey, rows] of byDate.entries()) {
    rows.sort((a, b) => new Date(a.logDateTime).getTime() - new Date(b.logDateTime).getTime());

    const totalAttempts = rows.length;
    const firstAttempt = rows[0] || null;
    const firstAttemptTimeLabel = firstAttempt ? formatTimeLabel(firstAttempt.logDateTime) : null;

    const firstPass = rows.find((r) => r.result && String(r.result).toUpperCase().includes('PASS'));
    const attemptsUntilPass = firstPass ? rows.findIndex((r) => r.id === firstPass.id) + 1 : null;
    const firstPassTimeLabel = firstPass ? formatTimeLabel(firstPass.logDateTime) : null;
    const finalResult = firstPass ? 'PASS' : 'FAIL';

    const [yearStr, monthStr, dayStr] = dateKey.split('-');
    const shiftStart = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), startHour, 0, 0, 0);

    const firstPassDate = firstPass ? new Date(firstPass.logDateTime) : null;
    const passBeforeShift = firstPassDate ? firstPassDate.getTime() <= shiftStart.getTime() : false;

    let windowLabel = 'No PASS logged';
    if (finalResult === 'PASS') {
      windowLabel = passBeforeShift ? 'PASS before shift start' : 'PASS after shift start';
    }

    esdStats.totalDays += 1;
    if (finalResult === 'PASS') {
      if (passBeforeShift) esdStats.daysWithPassBeforeShift += 1;
      else esdStats.daysWithPassAfterShift += 1;
    } else {
      esdStats.daysWithoutPass += 1;
    }

    esdDailySummary.push({
      date: dateKey,
      totalAttempts,
      attemptsUntilPass,
      firstAttemptTimeLabel,
      firstPassTimeLabel,
      shiftLabel,
      windowLabel,
      finalResult,
    });
  }

  esdDailySummary.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { esdDailySummary, esdStats };
}

async function buildAttendanceSummary({ staffId }) {
  let attendanceDailySummary = [];
  let attendanceStats = {
    totalDays: 0,
    presentDays: 0,
    absentDays: 0,
    lateDays: 0,
    avgMinutesLateOnLateDays: null,
    onTimeDays: 0,
    unpunctualDays: 0,
    lateDaysByBucket: 0,
  };

  const attendanceRecords = await Attendance.findAll({
    where: { staffId },
    order: [['date', 'DESC']],
  });

  if (!attendanceRecords?.length) {
    return { attendanceDailySummary, attendanceStats };
  }

  const byDate = new Map();
  attendanceRecords.forEach((rec) => {
    const dateKey = rec.date;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(rec);
  });

  let totalLateMinutes = 0;
  let lateDayCount = 0;

  for (const [dateKey, rows] of byDate.entries()) {
    let dayStatus = 'UNKNOWN';
    const rawStatuses = [];
    let minutesLate = null;
    const dayBuckets = new Set();

    rows.forEach((r) => {
      const st = r.status || 'UNKNOWN';
      rawStatuses.push(r.rawStatus || st);

      if (st === 'ABSENT') dayStatus = 'ABSENT';
      else if (st === 'LATE' && dayStatus !== 'ABSENT') dayStatus = 'LATE';
      else if (st === 'PRESENT' && dayStatus === 'UNKNOWN') dayStatus = 'PRESENT';

      if (r.minutesLate != null && !Number.isNaN(r.minutesLate)) {
        if (minutesLate == null || r.minutesLate > minutesLate) minutesLate = r.minutesLate;
      }

      if (r.punctualityBucket) dayBuckets.add(String(r.punctualityBucket).toUpperCase());
    });

    attendanceStats.totalDays += 1;

    if (dayStatus === 'PRESENT') attendanceStats.presentDays += 1;
    else if (dayStatus === 'ABSENT') attendanceStats.absentDays += 1;
    else if (dayStatus === 'LATE') {
      attendanceStats.lateDays += 1;
      if (minutesLate != null) {
        totalLateMinutes += minutesLate;
        lateDayCount += 1;
      }
    }

    let dayBucket = null;
    if (dayBuckets.has('LATE')) dayBucket = 'LATE';
    else if (dayBuckets.has('UNPUNCTUAL')) dayBucket = 'UNPUNCTUAL';
    else if (dayBuckets.has('ON_TIME')) dayBucket = 'ON_TIME';

    if (dayBucket === 'ON_TIME') attendanceStats.onTimeDays += 1;
    else if (dayBucket === 'UNPUNCTUAL') attendanceStats.unpunctualDays += 1;
    else if (dayBucket === 'LATE') attendanceStats.lateDaysByBucket += 1;

    attendanceDailySummary.push({
      date: dateKey,
      status: dayStatus,
      minutesLate,
      rawStatusSummary: rawStatuses.join(' | '),
      punctualityBucket: dayBucket,
    });
  }

  attendanceDailySummary.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (lateDayCount > 0) {
    attendanceStats.avgMinutesLateOnLateDays =
      Math.round((totalLateMinutes / lateDayCount) * 10) / 10;
  }

  return { attendanceDailySummary, attendanceStats };
}