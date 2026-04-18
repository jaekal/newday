// src/services/staff/staffProfileService.js
import { Op } from 'sequelize';
import {
  User,
  StaffProfile,
  SkuExposure,
  Goal,
  GoalCheckIn,
  Incident,
  RosterEntry,
  MonthlyReview,
  Attendance,
  EsdCheck,
} from '../../models/index.js';

import {
  buildRosterMap,
  canViewerAccessStaff,
  computeTenureLabel,
  getEffectiveRosterBuildingShift,
} from './staffAccessService.js';

import { buildReviewSummary } from './staffProfileReviewService.js';
import { buildTrainingSummary } from './staffProfileTrainingService.js';
import { buildComplianceSummary } from './staffProfileComplianceService.js';
import { buildAssignmentSummary } from './staffProfileAssignmentService.js';
import { buildPerformanceDashboard } from './staffProfileDashboardService.js';
import { buildOperationalMetricSummary } from './staffMetricAggregationService.js';

export async function buildStaffProfileViewModel({ staffId, viewer }) {
  const staff = await User.findByPk(staffId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });

  if (!staff) throw new Error('STAFF_NOT_FOUND');

  const viewerRole = viewer.role || 'STAFF';

  const rosterRows = await RosterEntry.findAll();
  const rosterMap = buildRosterMap(rosterRows);

  if (!canViewerAccessStaff(viewer, staff, rosterMap)) {
    throw new Error('STAFF_FORBIDDEN');
  }

  const eff = getEffectiveRosterBuildingShift(staff, rosterMap);
  staff.rosterBuilding = eff.rosterBuilding || '';
  staff.rosterShift = eff.rosterShift || '';

  const profile = staff.StaffProfile || null;
  const tenureLabel = profile?.startDate ? computeTenureLabel(profile.startDate) : null;

  const [
    reviewSummary,
    trainingSummary,
    complianceSummary,
    assignmentSummary,
    operationalMetrics,
    skuExposure,
    staffGoals,
    incidents,
  ] = await Promise.all([
    buildReviewSummary({ staffId, viewer }),
    buildTrainingSummary({ profile }),
    buildComplianceSummary({ staffId, profile }),
    buildAssignmentSummary({ staffId }),
    buildOperationalMetricSummary({ staffId, days: 90 }),
    SkuExposure.findAll({
      where: { staffId },
      order: [['timesWorked', 'DESC']],
    }),
    Goal.findAll({
      where: { ownerId: staffId },
      include: [{
        model: GoalCheckIn,
        as: 'CheckIns',
        attributes: ['createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 1,
        separate: true,
      }],
      order: [['dueDate', 'ASC']],
    }),
    Incident.findAll({
      where: { staffId },
      include: [{ model: User, as: 'Submitter' }],
      order: [['incidentDate', 'DESC'], ['createdAt', 'DESC']],
    }),
  ]);

  // Find most recent check-in across all goals for this staff member
  const allCheckInDates = staffGoals.flatMap((g) =>
    (g.CheckIns || []).map((c) => new Date(c.createdAt).getTime())
  ).filter((t) => !Number.isNaN(t));

  const lastCheckInTs = allCheckInDates.length ? Math.max(...allCheckInDates) : null;
  const daysSinceLastCheckIn = lastCheckInTs != null
    ? Math.floor((Date.now() - lastCheckInTs) / 86400000)
    : null;

  const goalStats = {
    total: staffGoals.length,
    open: staffGoals.filter((g) => g.status === 'OPEN').length,
    inProgress: staffGoals.filter((g) => g.status === 'IN_PROGRESS').length,
    done: staffGoals.filter((g) => g.status === 'DONE').length,
    onHold: staffGoals.filter((g) => g.status === 'ON_HOLD').length,
    lastCheckInAt: lastCheckInTs ? new Date(lastCheckInTs).toISOString() : null,
    daysSinceLastCheckIn,
  };

  const dashboard = buildPerformanceDashboard({
    reviewSummary,
    trainingSummary,
    complianceSummary,
    assignmentSummary,
    operationalMetrics,
    skuExposure,
    incidents,
  });

  return {
    staff,
    profile,

    viewerRole,
    currentUserRole: viewerRole,

    tenureLabel,

    overallAverage: reviewSummary.overallAverage,
    currentMonthAverage: reviewSummary.currentMonthAverage,
    currentMonth: reviewSummary.currentMonth,
    currentYear: reviewSummary.currentYear,
    ratingHistory: reviewSummary.ratingHistory,

    trainingRecords: trainingSummary.trainingRecords,
    trainingStats: trainingSummary.trainingStats,
    trainingGrouped: trainingSummary.trainingGrouped,

    esdDailySummary: complianceSummary.esdDailySummary,
    esdStats: complianceSummary.esdStats,
    attendanceDailySummary: complianceSummary.attendanceDailySummary,
    attendanceStats: complianceSummary.attendanceStats,
    esdStreak: complianceSummary.esdStreak,
    lateTrendDelta: complianceSummary.lateTrendDelta,
    absencePattern: complianceSummary.absencePattern,

    assignmentDailySummary: assignmentSummary.assignmentDailySummary,
    assignmentRows: assignmentSummary.assignmentRows,
    maxAssignmentRows: assignmentSummary.maxAssignmentRows,
    assignmentStats: assignmentSummary.assignmentStats,

    operationalMetrics,

    skuExposure,
    staffGoals,
    goalStats,
    incidents,

    dashboard,
    benchmark: await buildBenchmarkSummary({ staff, profile, reviewSummary, complianceSummary }),
  };
}

async function buildBenchmarkSummary({ staff, profile, reviewSummary, complianceSummary }) {
  // Find peers in the same building + shift
  const building = profile?.building || null;
  const shift = profile?.shift || null;

  let peerIds = [];
  if (building || shift) {
    const where = {};
    if (building) where.building = building;
    if (shift) where.shift = shift;
    const peerProfiles = await StaffProfile.findAll({
      where,
      attributes: ['userId'],
    });
    peerIds = peerProfiles.map(p => p.userId).filter(id => id !== staff.id);
  }

  if (!peerIds.length) return null;

  // Review score benchmarks: average overallScore from last 3 months across peers
  const now = new Date();
  const cutoff = new Date(now); cutoff.setMonth(now.getMonth() - 3);
  const peerReviews = await MonthlyReview.findAll({
    where: { staffId: { [Op.in]: peerIds }, createdAt: { [Op.gte]: cutoff } },
    attributes: ['positiveAttitude','proactive','integrity','accountability2','problemSolving','efficiency','resultsOrientation','communication','continuousImprovement','teamwork2','collaboration','buildTrust'],
  });

  const SCORE_FIELDS = ['positiveAttitude','proactive','integrity','accountability2','problemSolving','efficiency','resultsOrientation','communication','continuousImprovement','teamwork2','collaboration','buildTrust'];
  let peerScores = [];
  peerReviews.forEach(r => {
    const vals = SCORE_FIELDS.map(f => r[f]).filter(v => v != null);
    if (vals.length) peerScores.push(vals.reduce((s,v) => s+v,0) / vals.length);
  });
  const peerAvgScore = peerScores.length
    ? Math.round((peerScores.reduce((s,v) => s+v,0) / peerScores.length) * 100) / 100
    : null;

  // Attendance: peer absent rate (last 60 days)
  const cutoff60 = new Date(now); cutoff60.setDate(now.getDate() - 60);
  const peerAttendance = await Attendance.findAll({
    where: {
      staffId: { [Op.in]: peerIds },
      date: { [Op.gte]: cutoff60.toISOString().slice(0, 10) },
    },
    attributes: ['staffId', 'status'],
  });

  const peerAttByStaff = {};
  peerAttendance.forEach(a => {
    if (!peerAttByStaff[a.staffId]) peerAttByStaff[a.staffId] = { total: 0, absent: 0 };
    peerAttByStaff[a.staffId].total++;
    if (a.status === 'ABSENT') peerAttByStaff[a.staffId].absent++;
  });
  const peerAbsentRates = Object.values(peerAttByStaff)
    .filter(p => p.total > 0)
    .map(p => p.absent / p.total);
  const peerAvgAbsentRate = peerAbsentRates.length
    ? Math.round((peerAbsentRates.reduce((s,v) => s+v,0) / peerAbsentRates.length) * 1000) / 10
    : null;

  // My own review avg
  const myReviewAvg = reviewSummary.overallAverage != null
    ? Math.round(reviewSummary.overallAverage * 100) / 100
    : null;

  // My own absent rate
  const myAtt = complianceSummary.attendanceStats;
  const myAbsentRate = myAtt && myAtt.totalDays > 0
    ? Math.round((myAtt.absentDays / myAtt.totalDays) * 1000) / 10
    : null;

  return {
    peerCount: peerIds.length,
    building,
    shift,
    reviewScore: {
      mine: myReviewAvg,
      peerAvg: peerAvgScore,
      delta: myReviewAvg != null && peerAvgScore != null ? Math.round((myReviewAvg - peerAvgScore) * 100) / 100 : null,
    },
    absentRate: {
      mine: myAbsentRate,
      peerAvg: peerAvgAbsentRate,
      delta: myAbsentRate != null && peerAvgAbsentRate != null ? Math.round((myAbsentRate - peerAvgAbsentRate) * 10) / 10 : null,
    },
  };
}