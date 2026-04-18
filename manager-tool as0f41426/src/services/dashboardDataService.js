// src/services/dashboardDataService.js
import { Op } from 'sequelize';
import {
  User,
  StaffProfile,
  ManagerScope,
  ReviewAssignment,
  Goal,
  MonthlyReview,
  TechnicianDailyMetric,
  TechnicianScoreSnapshot,
  ShiftDailyMetric,
  TechnicianPresenceDaily,
} from '../models/index.js';
import { computeBucketedAverage } from '../constants/ratings.js';

/* ─────────────────────────────────────────────
 * Small helpers
 * ───────────────────────────────────────────── */
function norm(v) {
  return String(v ?? '').trim();
}

function uniqSorted(list) {
  return [...new Set((list || []).map((x) => norm(x)).filter(Boolean))].sort();
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safePct(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function toDateOnly(value) {
  if (isDateOnly(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function getMonthYearFromDate(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (match) {
    return { month: parseInt(match[2], 10), year: parseInt(match[1], 10) };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function buildEmptyCards() {
  return {
    activeTechniciansToday: 0,
    serversCompleted: 0,
    racksCompleted: 0,
    reviewsSubmittedCount: 0,
    reviewsPendingCount: 0,
    averageOverallScore: null,
    openGoalsCount: 0,
  };
}

/* ─────────────────────────────────────────────
 * Viewer / scope helpers
 * ───────────────────────────────────────────── */
async function loadViewer(viewerUserId) {
  return User.findByPk(viewerUserId, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });
}

function getScopeFromViewer(viewer) {
  const role = viewer?.role || '';
  const profile = viewer?.StaffProfile || null;
  const managerScopes = viewer?.ManagerScopes || [];

  if (role === 'ADMIN') {
    return {
      mode: 'all',
      allowedBuildings: [],
      allowedShifts: [],
      allowedPairs: [],
    };
  }

  if (role === 'MANAGER') {
    const allowedPairs = managerScopes
      .map((s) => ({
        building: norm(s.building),
        shift: norm(s.shift),
      }))
      .filter((x) => x.building && x.shift);

    if (allowedPairs.length) {
      return {
        mode: 'manager-scope',
        allowedBuildings: uniqSorted(allowedPairs.map((x) => x.building)),
        allowedShifts: uniqSorted(allowedPairs.map((x) => x.shift)),
        allowedPairs,
      };
    }
  }

  const building = norm(profile?.building);
  const shift = norm(profile?.shift);

  return {
    mode: 'profile',
    allowedBuildings: building ? [building] : [],
    allowedShifts: shift ? [shift] : [],
    allowedPairs: building && shift ? [{ building, shift }] : [],
  };
}

function isUserInScope(user, scope) {
  if (!scope || scope.mode === 'all') return true;

  const p = user?.StaffProfile || null;
  const building = norm(p?.building);
  const shift = norm(p?.shift);

  if (!building || !shift) return false;

  return scope.allowedPairs.some((x) => x.building === building && x.shift === shift);
}

function applyRequestedScope({ viewerRole, requestedBuilding, requestedShift, scope, allBuildings, allShifts }) {
  let building = norm(requestedBuilding);
  let shift = norm(requestedShift);

  if (viewerRole === 'ADMIN' || viewerRole === 'SENIOR_MANAGER') {
    return {
      building,
      shift,
      buildingOptions: allBuildings,
      shiftOptions: allShifts,
      canFilterScope: true,
    };
  }

  if (viewerRole === 'MANAGER' || viewerRole === 'SENIOR_MANAGER') {
    const buildingOptions = scope.allowedBuildings;
    const shiftOptions = scope.allowedShifts;

    if (building && !buildingOptions.includes(building)) building = '';
    if (shift && !shiftOptions.includes(shift)) shift = '';

    return {
      building,
      shift,
      buildingOptions,
      shiftOptions,
      canFilterScope: true,
    };
  }

  return {
    building: scope.allowedBuildings[0] || '',
    shift: scope.allowedShifts[0] || '',
    buildingOptions: scope.allowedBuildings,
    shiftOptions: scope.allowedShifts,
    canFilterScope: false,
  };
}

/* ─────────────────────────────────────────────
 * Base context
 * ───────────────────────────────────────────── */
async function getDashboardBaseContext({
  viewerUserId,
  date,
  building,
  shift,
}) {
  const viewer = await loadViewer(viewerUserId);
  if (!viewer) throw new Error('Viewer not found');

  const dateOnly = toDateOnly(date);
  const scope = getScopeFromViewer(viewer);

  const allStaff = await User.findAll({
    where: {
      role: {
        [Op.in]: ['STAFF', 'LEAD', 'SUPERVISOR'],
      },
    },
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const allBuildings = uniqSorted(allStaff.map((u) => u?.StaffProfile?.building).filter(Boolean));
  const allShifts = uniqSorted(allStaff.map((u) => u?.StaffProfile?.shift).filter(Boolean));

  const resolvedScope = applyRequestedScope({
    viewerRole: viewer.role,
    requestedBuilding: building,
    requestedShift: shift,
    scope,
    allBuildings,
    allShifts,
  });

  let scopedStaff = allStaff.filter((u) => isUserInScope(u, scope));

  scopedStaff = scopedStaff.filter((u) => {
    const p = u?.StaffProfile || null;
    const b = norm(p?.building);
    const sh = norm(p?.shift);

    if (resolvedScope.building && b !== resolvedScope.building) return false;
    if (resolvedScope.shift && sh !== resolvedScope.shift) return false;
    return true;
  });

  return {
    viewer,
    scope,
    date: dateOnly,
    building: resolvedScope.building,
    shift: resolvedScope.shift,
    buildingOptions: resolvedScope.buildingOptions,
    shiftOptions: resolvedScope.shiftOptions,
    canFilterScope: resolvedScope.canFilterScope,
    scopedStaff,
  };
}

/* ─────────────────────────────────────────────
 * Review visibility helpers
 * ───────────────────────────────────────────── */
async function getReviewableStaffForViewer({ viewer, scopedStaff }) {
  if (viewer.role === 'LEAD') {
    const assignments = await ReviewAssignment.findAll({
      where: { reviewerId: viewer.id, active: true },
      attributes: ['staffId'],
    });

    const assignedIds = new Set(assignments.map((a) => a.staffId));
    return scopedStaff.filter((s) => assignedIds.has(s.id));
  }

  if (viewer.role === 'SUPERVISOR') {
    return scopedStaff;
  }

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER' || viewer.role === 'ADMIN') {
    return scopedStaff;
  }

  return [];
}

async function getVisibleMonthlyReviewsForViewer({ viewer, reviewableStaff, month, year }) {
  const reviewableIds = new Set(reviewableStaff.map((s) => s.id));

  const leadsInScope = reviewableStaff.filter((s) => s.role === 'LEAD');
  const leadIdsInScope = new Set(leadsInScope.map((l) => l.id));

  const allPeriodReviews = await MonthlyReview.findAll({
    where: {
      periodMonth: month,
      periodYear: year,
    },
    include: [
      {
        model: User,
        as: 'Staff',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
      {
        model: User,
        as: 'Submitter',
      },
    ],
    order: [
      ['staffId', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });

  if (viewer.role === 'LEAD') {
    return allPeriodReviews.filter(
      (rev) => rev.submitterId === viewer.id && reviewableIds.has(rev.staffId)
    );
  }

  if (viewer.role === 'SUPERVISOR') {
    return allPeriodReviews.filter((rev) => {
      if (!reviewableIds.has(rev.staffId)) return false;
      return rev.submitterId === viewer.id || leadIdsInScope.has(rev.submitterId);
    });
  }

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER' || viewer.role === 'ADMIN') {
    return allPeriodReviews.filter((rev) => reviewableIds.has(rev.staffId));
  }

  return [];
}

function buildReviewSummaryFromMonthlyReviews({ reviewableStaff, visibleReviews }) {
  const perStaff = new Map();
  let teamTotal = 0;
  let teamCount = 0;

  for (const rev of visibleReviews) {
    const plain = rev.toJSON();
    const avgScore = computeBucketedAverage(plain);

    if (!perStaff.has(rev.staffId)) {
      perStaff.set(rev.staffId, {
        staff: rev.Staff,
        totalAvg: 0,
        count: 0,
        // Per-bucket accumulators for the calibration widget
        peopleTot: 0,      peopleN: 0,
        ownershipTot: 0,   ownershipN: 0,
        qualityTot: 0,     qualityN: 0,
        partnershipTot: 0, partnershipN: 0,
      });
    }

    const entry = perStaff.get(rev.staffId);

    // Accumulate per-bucket stored averages (written by computeBucketScores)
    const bkt = {
      people:      typeof plain.bucketPeopleAvg      === 'number' ? plain.bucketPeopleAvg      : null,
      ownership:   typeof plain.bucketOwnershipAvg   === 'number' ? plain.bucketOwnershipAvg   : null,
      quality:     typeof plain.bucketQualityAvg     === 'number' ? plain.bucketQualityAvg     : null,
      partnership: typeof plain.bucketPartnershipAvg === 'number' ? plain.bucketPartnershipAvg : null,
    };
    if (bkt.people      != null) { entry.peopleTot      += bkt.people;      entry.peopleN++;      }
    if (bkt.ownership   != null) { entry.ownershipTot   += bkt.ownership;   entry.ownershipN++;   }
    if (bkt.quality     != null) { entry.qualityTot     += bkt.quality;     entry.qualityN++;     }
    if (bkt.partnership != null) { entry.partnershipTot += bkt.partnership; entry.partnershipN++; }

    if (avgScore != null && !Number.isNaN(avgScore)) {
      entry.totalAvg += avgScore;
      entry.count += 1;
      teamTotal += avgScore;
      teamCount += 1;
    }
  }

  const staffSummaries = Array.from(perStaff.values())
    .map((entry) => ({
      staff: entry.staff,
      avgScore: entry.count > 0 ? entry.totalAvg / entry.count : null,
      reviewCount: entry.count,
      building: norm(entry.staff?.StaffProfile?.building),
      shift: norm(entry.staff?.StaffProfile?.shift),
      positionType: norm(entry.staff?.StaffProfile?.positionType),
      // Per-bucket averages for the dashboard calibration widget
      bucketPeopleAvg:      entry.peopleN      > 0 ? entry.peopleTot      / entry.peopleN      : null,
      bucketOwnershipAvg:   entry.ownershipN   > 0 ? entry.ownershipTot   / entry.ownershipN   : null,
      bucketQualityAvg:     entry.qualityN     > 0 ? entry.qualityTot     / entry.qualityN     : null,
      bucketPartnershipAvg: entry.partnershipN > 0 ? entry.partnershipTot / entry.partnershipN : null,
    }))
    .sort((a, b) => {
      const nameA = a.staff?.name ? a.staff.name.toLowerCase() : '';
      const nameB = b.staff?.name ? b.staff.name.toLowerCase() : '';
      return nameA.localeCompare(nameB);
    });

  const staffWithReviewIds = new Set(Array.from(perStaff.keys()));
  const missingStaff = reviewableStaff.filter((s) => !staffWithReviewIds.has(s.id));

  return {
    visibleReviews,
    staffSummaries,
    missingStaff,
    teamAverage: teamCount > 0 ? teamTotal / teamCount : null,
    staffRatedCount: staffWithReviewIds.size,
    staffTotalCount: reviewableStaff.length,
    staffRatedPercent: safePct(staffWithReviewIds.size, reviewableStaff.length),
    pendingToRateCount: missingStaff.length,
  };
}

/* ─────────────────────────────────────────────
 * KPI helpers from new tables
 * ───────────────────────────────────────────── */
async function loadPresenceRows({ userIds, date, building, shift, area }) {
  return TechnicianPresenceDaily.findAll({
    where: {
      presenceDate: date,
      ...(userIds.length ? { userId: { [Op.in]: userIds } } : { userId: -1 }),
      ...(building ? { building } : {}),
      ...(shift ? { shift } : {}),
      ...(area ? { area } : {}),
    },
  });
}

async function loadShiftRows({ date, building, shift, area, productFamily, testStage }) {
  return ShiftDailyMetric.findAll({
    where: {
      metricDate: date,
      ...(building ? { building } : {}),
      ...(shift ? { shift } : {}),
      ...(area ? { area } : {}),
      ...(productFamily ? { productFamily } : {}),
      ...(testStage ? { testStage } : {}),
    },
    order: [['shift', 'ASC']],
  });
}

async function loadScoreRows({ userIds, date, building, shift, area, productFamily, testStage }) {
  return TechnicianScoreSnapshot.findAll({
    where: {
      snapshotDate: date,
      windowType: 'DAILY',
      ...(userIds.length ? { userId: { [Op.in]: userIds } } : { userId: -1 }),
      ...(building ? { building } : {}),
      ...(shift ? { shift } : {}),
      ...(area ? { area } : {}),
      ...(productFamily ? { productFamily } : {}),
      ...(testStage ? { testStage } : {}),
    },
    include: [{ model: User, as: 'User' }],
    order: [['overallScore', 'DESC']],
  });
}

function buildCardsFromKpiRows({
  scoreRows,
  shiftRows,
  presenceRows,
  openGoals,
  reviewsSubmittedCount,
  reviewsPendingCount,
}) {
  const cards = buildEmptyCards();

  cards.activeTechniciansToday = presenceRows.filter((x) => x.wasActiveTechnician).length;
  cards.serversCompleted = shiftRows.reduce((sum, r) => sum + safeNumber(r.serversCompleted), 0);
  cards.racksCompleted = shiftRows.reduce((sum, r) => sum + safeNumber(r.racksCompleted), 0);
  cards.reviewsSubmittedCount = safeNumber(reviewsSubmittedCount);
  cards.reviewsPendingCount = safeNumber(reviewsPendingCount);
  cards.openGoalsCount = Array.isArray(openGoals) ? openGoals.length : 0;

  if (scoreRows.length > 0) {
    const validScores = scoreRows
      .map((r) => Number(r.overallScore))
      .filter((n) => Number.isFinite(n));

    cards.averageOverallScore =
      validScores.length > 0
        ? validScores.reduce((sum, n) => sum + n, 0) / validScores.length
        : null;
  }

  return cards;
}

/* ─────────────────────────────────────────────
 * Shared summary loaders
 * ───────────────────────────────────────────── */
async function loadOpenGoals(userIds) {
  const allOpenGoals = await Goal.findAll({
    where: { status: { [Op.ne]: 'DONE' } },
    order: [['dueDate', 'ASC']],
  });

  const allowed = new Set(userIds);
  return allOpenGoals.filter((g) => allowed.has(g.ownerId));
}

async function loadAssignmentSummary(reviewableStaff) {
  try {
    const reviewableIds = new Set(reviewableStaff.map((s) => s.id));

    const assignments = await ReviewAssignment.findAll({
      where: { active: true },
      attributes: ['id', 'reviewerId', 'staffId', 'active'],
    });

    const scoped = assignments.filter((a) => reviewableIds.has(a.staffId));

    const assignedStaffIds = new Set(scoped.map((a) => a.staffId));
    const pendingAssignment = reviewableStaff.filter((s) => !assignedStaffIds.has(s.id));

    const reviewerIds = Array.from(new Set(scoped.map((a) => a.reviewerId).filter(Boolean)));
    const staffIds = Array.from(new Set(scoped.map((a) => a.staffId).filter(Boolean)));

    const [reviewers, assignedStaffUsers] = await Promise.all([
      User.findAll({ where: { id: { [Op.in]: reviewerIds } }, attributes: ['id', 'name', 'role'] }),
      User.findAll({ where: { id: { [Op.in]: staffIds } }, attributes: ['id', 'name'] }),
    ]);

    const reviewerMap = new Map(reviewers.map((u) => [u.id, u]));
    const staffMap = new Map(assignedStaffUsers.map((u) => [u.id, u]));

    const byLead = new Map();
    for (const a of scoped) {
      const reviewer = reviewerMap.get(a.reviewerId) || null;
      const staffUser = staffMap.get(a.staffId) || null;
      if (!reviewer) continue;

      if (!byLead.has(reviewer.id)) byLead.set(reviewer.id, { reviewer, staff: [] });
      byLead.get(reviewer.id).staff.push(staffUser);
    }

    return {
      assignedCount: assignedStaffIds.size,
      pendingCount: pendingAssignment.length,
      pendingAssignment,
      byLead: Array.from(byLead.values()).sort((x, y) =>
        (x.reviewer?.name || '').localeCompare(y.reviewer?.name || '')
      ),
    };
  } catch (err) {
    console.error('dashboardDataService → assignment summary error:', err);
    return null;
  }
}

async function loadYtdCoverage(reviewableStaff, year, month) {
  try {
    const reviewableIds = reviewableStaff.map((s) => s.id);

    const ytdReviews = await MonthlyReview.findAll({
      where: {
        periodYear: year,
        periodMonth: { [Op.lte]: month },
        ...(reviewableIds.length ? { staffId: { [Op.in]: reviewableIds } } : { staffId: -1 }),
      },
      attributes: ['staffId', 'periodMonth', 'periodYear'],
    });

    const monthsByStaff = new Map();
    for (const r of ytdReviews) {
      if (!monthsByStaff.has(r.staffId)) monthsByStaff.set(r.staffId, new Set());
      monthsByStaff.get(r.staffId).add(r.periodMonth);
    }

    const perStaffCoverage = reviewableStaff
      .map((s) => {
        const monthsSet = monthsByStaff.get(s.id) || new Set();
        return {
          staff: s,
          monthsGraded: monthsSet.size,
          monthsMissing: Math.max(0, month - monthsSet.size),
        };
      })
      .sort((a, b) => {
        const nameA = a.staff?.name ? a.staff.name.toLowerCase() : '';
        const nameB = b.staff?.name ? b.staff.name.toLowerCase() : '';
        return nameA.localeCompare(nameB);
      });

    const reviewsPerMonth = Array.from({ length: month }, (_, i) => i + 1).map((m) => {
      let count = 0;
      for (const r of ytdReviews) {
        if (r.periodMonth === m) count++;
      }
      return { month: m, count };
    });

    return { perStaffCoverage, reviewsPerMonth };
  } catch (err) {
    console.error('dashboardDataService → ytd coverage error:', err);
    return null;
  }
}

/* ─────────────────────────────────────────────
 * Executive dashboard
 * ───────────────────────────────────────────── */
export async function getExecutiveDashboardData({
  viewerUserId,
  date,
  building = '',
  shift = '',
  area = '',
  productFamily = '',
  testStage = '',
}) {
  const base = await getDashboardBaseContext({
    viewerUserId,
    date,
    building,
    shift,
  });

  const { viewer, scopedStaff } = base;
  const dateOnly = base.date;
  const { month, year } = getMonthYearFromDate(dateOnly);

  const reviewableStaff = await getReviewableStaffForViewer({
    viewer,
    scopedStaff,
  });

  const userIds = reviewableStaff.map((u) => u.id);

  const visibleReviews = await getVisibleMonthlyReviewsForViewer({
    viewer,
    reviewableStaff,
    month,
    year,
  });

  const reviewSummary = buildReviewSummaryFromMonthlyReviews({
    reviewableStaff,
    visibleReviews,
  });

  const [openGoals, assignmentSummary, ytdCoverage] = await Promise.all([
    loadOpenGoals(userIds),
    loadAssignmentSummary(reviewableStaff),
    loadYtdCoverage(reviewableStaff, year, month),
  ]);

  const [scoreRows, shiftRows, presenceRows] = await Promise.all([
    loadScoreRows({
      userIds,
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area,
      productFamily,
      testStage,
    }),
    loadShiftRows({
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area,
      productFamily,
      testStage,
    }),
    loadPresenceRows({
      userIds,
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area,
    }),
  ]);

  const topPerformers = scoreRows.length
    ? [...scoreRows]
        .filter((x) => typeof x.overallScore === 'number')
        .sort((a, b) => b.overallScore - a.overallScore || (a.User?.name || '').localeCompare(b.User?.name || ''))
        .slice(0, 5)
    : [...reviewSummary.staffSummaries]
        .filter((x) => typeof x.avgScore === 'number')
        .sort((a, b) => b.avgScore - a.avgScore || (a.staff?.name || '').localeCompare(b.staff?.name || ''))
        .slice(0, 5);

  const lowPerformers = scoreRows.length
    ? [...scoreRows]
        .filter((x) => typeof x.overallScore === 'number')
        .sort((a, b) => a.overallScore - b.overallScore || (a.User?.name || '').localeCompare(b.User?.name || ''))
        .slice(0, 5)
    : [...reviewSummary.staffSummaries]
        .filter((x) => typeof x.avgScore === 'number')
        .sort((a, b) => a.avgScore - b.avgScore || (a.staff?.name || '').localeCompare(b.staff?.name || ''))
        .slice(0, 5);

  const shiftTrends =
    shiftRows.length > 0
      ? shiftRows
      : uniqSorted(reviewableStaff.map((s) => s?.StaffProfile?.shift).filter(Boolean)).map((shiftName) => {
          const staffIdsForShift = new Set(
            reviewableStaff
              .filter((s) => norm(s?.StaffProfile?.shift) === shiftName)
              .map((s) => s.id)
          );

          const shiftReviews = visibleReviews.filter((r) => staffIdsForShift.has(r.staffId));
          let total = 0;
          let count = 0;

          for (const rev of shiftReviews) {
            const avg = computeBucketedAverage(rev.toJSON());
            if (avg != null && !Number.isNaN(avg)) {
              total += avg;
              count += 1;
            }
          }

          return {
            shift: shiftName,
            staffCount: staffIdsForShift.size,
            reviewsCount: shiftReviews.length,
            avgScore: count > 0 ? total / count : null,
          };
        });

  const cards = buildCardsFromKpiRows({
    scoreRows,
    shiftRows,
    presenceRows,
    openGoals,
    reviewsSubmittedCount: reviewSummary.visibleReviews.length,
    reviewsPendingCount: reviewSummary.pendingToRateCount,
  });

  if (cards.averageOverallScore == null && typeof reviewSummary.teamAverage === 'number') {
    cards.averageOverallScore = reviewSummary.teamAverage * 20;
  }

  return {
    mode: 'executive',
    viewer,
    filters: {
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area: norm(area),
      productFamily: norm(productFamily),
      testStage: norm(testStage),
    },
    buildingOptions: base.buildingOptions,
    shiftOptions: base.shiftOptions,
    canFilterScope: base.canFilterScope,

    cards,
    topPerformers,
    lowPerformers,
    shiftTrends,
    rankingTable: scoreRows,

    openGoals,
    ytdCoverage,
    assignmentSummary,

    reviewsCount: reviewSummary.visibleReviews.length,
    teamAverage: reviewSummary.teamAverage,
    staffSummaries: reviewSummary.staffSummaries,
    missingStaff: reviewSummary.missingStaff,
    staffRatedCount: reviewSummary.staffRatedCount,
    staffTotalCount: reviewSummary.staffTotalCount,
    staffRatedPercent: reviewSummary.staffRatedPercent,
    pendingToRateCount: reviewSummary.pendingToRateCount,
  };
}

/* ─────────────────────────────────────────────
 * Operational dashboard
 * ───────────────────────────────────────────── */
export async function getOperationalDashboardData({
  viewerUserId,
  date,
  building = '',
  shift = '',
  area = '',
  productFamily = '',
  testStage = '',
}) {
  const base = await getDashboardBaseContext({
    viewerUserId,
    date,
    building,
    shift,
  });

  const { viewer, scopedStaff } = base;
  const dateOnly = base.date;
  const { month, year } = getMonthYearFromDate(dateOnly);

  const reviewableStaff = await getReviewableStaffForViewer({
    viewer,
    scopedStaff,
  });

  const userIds = reviewableStaff.map((u) => u.id);

  const visibleReviews = await getVisibleMonthlyReviewsForViewer({
    viewer,
    reviewableStaff,
    month,
    year,
  });

  const reviewSummary = buildReviewSummaryFromMonthlyReviews({
    reviewableStaff,
    visibleReviews,
  });

  const [openGoals, assignmentSummary] = await Promise.all([
    loadOpenGoals(userIds),
    loadAssignmentSummary(reviewableStaff),
  ]);

  const [shiftRows, presenceRows] = await Promise.all([
    loadShiftRows({
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area,
      productFamily,
      testStage,
    }),
    loadPresenceRows({
      userIds,
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area,
    }),
  ]);

  const cards = buildCardsFromKpiRows({
    scoreRows: [],
    shiftRows,
    presenceRows,
    openGoals,
    reviewsSubmittedCount: reviewSummary.visibleReviews.length,
    reviewsPendingCount: reviewSummary.pendingToRateCount,
  });

  return {
    mode: 'operational',
    viewer,
    filters: {
      date: dateOnly,
      building: base.building,
      shift: base.shift,
      area: norm(area),
      productFamily: norm(productFamily),
      testStage: norm(testStage),
    },
    buildingOptions: base.buildingOptions,
    shiftOptions: base.shiftOptions,
    canFilterScope: base.canFilterScope,

    cards,
    reviewAssignments: assignmentSummary?.byLead || [],
    openGoals,
    assignmentSummary,

    reviewsCount: reviewSummary.visibleReviews.length,
    teamAverage: reviewSummary.teamAverage,
    staffSummaries: reviewSummary.staffSummaries,
    missingStaff: reviewSummary.missingStaff,
    staffRatedCount: reviewSummary.staffRatedCount,
    staffTotalCount: reviewSummary.staffTotalCount,
    staffRatedPercent: reviewSummary.staffRatedPercent,
    pendingToRateCount: reviewSummary.pendingToRateCount,
  };
}