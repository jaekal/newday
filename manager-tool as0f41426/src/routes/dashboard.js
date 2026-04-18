// src/routes/dashboard.js
import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import { User, StaffProfile, AuditLog, MonthlyReview, ManagerScope } from '../models/index.js';
import {
  getExecutiveDashboardData,
  getOperationalDashboardData,
} from '../services/dashboardDataService.js';

const router = express.Router();

function getDateOrToday(req) {
  // Prefer an explicit date= param (YYYY-MM-DD)
  const raw = String(req.query.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Fall back to month= + year= submitted by the dashboard filter form
  const m = parseInt(req.query.month, 10);
  const y = parseInt(req.query.year, 10);
  if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) {
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }

  return new Date().toISOString().slice(0, 10);
}

function getMonthYearFromDate(dateStr) {
  // Parse YYYY-MM-DD directly to avoid UTC→local timezone shift
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (match) {
    return { month: parseInt(match[2], 10), year: parseInt(match[1], 10) };
  }
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function normalizeScoreToFivePoint(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return score / 20;
}

function normalizeAssignmentSummary(data) {
  const raw = data?.assignmentSummary;
  if (!raw || typeof raw !== 'object') return null;

  return {
    assignedCount:
      typeof raw.assignedCount === 'number' ? raw.assignedCount : 0,
    pendingCount:
      typeof raw.pendingCount === 'number' ? raw.pendingCount : 0,
    pendingAssignment: Array.isArray(raw.pendingAssignment)
      ? raw.pendingAssignment
      : [],
    byLead: Array.isArray(raw.byLead) ? raw.byLead : [],
  };
}

function normalizeDashboardRenderPayload({
  viewer,
  data,
  fallbackMonth,
  fallbackYear,
}) {
  const filters = data?.filters || {};
  const cards = data?.cards || {};

  const rankingTable = Array.isArray(data?.rankingTable) ? data.rankingTable : [];
  const openGoals = Array.isArray(data?.openGoals) ? data.openGoals : [];
  const topPerformers = Array.isArray(data?.topPerformers) ? data.topPerformers : [];
  const lowPerformers = Array.isArray(data?.lowPerformers) ? data.lowPerformers : [];
  const shiftTrends = Array.isArray(data?.shiftTrends) ? data.shiftTrends : [];

  return {
    month: fallbackMonth,
    year: fallbackYear,

    // Current dashboard filter values
    date: filters.date || null,
    building: filters.building || '',
    shift: filters.shift || '',
    area: filters.area || '',
    productFamily: filters.productFamily || '',
    testStage: filters.testStage || '',

    buildingOptions: Array.isArray(data?.buildingOptions) ? data.buildingOptions : [],
    shiftOptions: Array.isArray(data?.shiftOptions) ? data.shiftOptions : [],
    canFilterScope: true,

    currentUserRole: viewer.role,
    dashboardMode: data?.mode || 'executive',

    // Review/dashboard summary compatibility
    reviewsCount:
      typeof cards.reviewsSubmittedCount === 'number'
        ? cards.reviewsSubmittedCount
        : 0,

    teamAverage: normalizeScoreToFivePoint(cards.averageOverallScore),

    staffSummaries: rankingTable.map((row) => ({
      staff: row.User || null,
      avgScore: normalizeScoreToFivePoint(row.overallScore),
      reviewCount:
        typeof row.reviewCount === 'number' ? row.reviewCount : 1,
      building: row.building || '',
      shift: row.shift || '',
      positionType: row.positionType || '',
    })),

    missingStaff: Array.isArray(data?.missingStaff) ? data.missingStaff : [],

    // Monthly-review-based staff summaries with per-bucket averages.
    // Distinct from staffSummaries (which maps the daily-metric rankingTable).
    // Used by the calibration comparison widget in dashboard.ejs.
    reviewSummaries: Array.isArray(data?.staffSummaries) ? data.staffSummaries : [],

    openGoals,

    staffRatedCount:
      typeof cards.staffRatedCount === 'number'
        ? cards.staffRatedCount
        : rankingTable.length,

    staffTotalCount:
      typeof cards.staffTotalCount === 'number'
        ? cards.staffTotalCount
        : rankingTable.length,

    staffRatedPercent:
      typeof cards.staffRatedPercent === 'number'
        ? cards.staffRatedPercent
        : rankingTable.length > 0
          ? 100
          : null,

    pendingToRateCount:
      typeof cards.reviewsPendingCount === 'number'
        ? cards.reviewsPendingCount
        : Array.isArray(data?.missingStaff)
          ? data.missingStaff.length
          : 0,

    ytdCoverage:
      data?.ytdCoverage && typeof data.ytdCoverage === 'object'
        ? data.ytdCoverage
        : null,

    assignmentSummary: normalizeAssignmentSummary(data),

    topPerformers,
    lowPerformers,
    shiftTrends,

    futureMetrics: [
      {
        key: 'activeTechniciansToday',
        label: 'Active Technicians Today',
        value:
          typeof cards.activeTechniciansToday === 'number'
            ? cards.activeTechniciansToday
            : null,
      },
      {
        key: 'serversCompleted',
        label: 'Servers Completed',
        value:
          typeof cards.serversCompleted === 'number'
            ? cards.serversCompleted
            : null,
      },
      {
        key: 'racksCompleted',
        label: 'Racks Completed',
        value:
          typeof cards.racksCompleted === 'number'
            ? cards.racksCompleted
            : null,
      },
      {
        key: 'openGoalsCount',
        label: 'Open Goals',
        value:
          typeof cards.openGoalsCount === 'number'
            ? cards.openGoalsCount
            : openGoals.length,
      },
      {
        key: 'reviewsSubmittedCount',
        label: 'Reviews Submitted',
        value:
          typeof cards.reviewsSubmittedCount === 'number'
            ? cards.reviewsSubmittedCount
            : null,
      },
      {
        key: 'reviewsPendingCount',
        label: 'Reviews Pending',
        value:
          typeof cards.reviewsPendingCount === 'number'
            ? cards.reviewsPendingCount
            : null,
      },
    ],
  };
}

function buildDashboardErrorPayload({
  viewer,
  month,
  year,
  selectedDate,
  filters,
}) {
  return {
    month,
    year,
    date: selectedDate,
    building: filters.building,
    shift: filters.shift,
    area: filters.area,
    productFamily: filters.productFamily,
    testStage: filters.testStage,

    buildingOptions: [],
    shiftOptions: [],
    canFilterScope: false,

    currentUserRole: viewer.role,
    dashboardMode:
      ['ADMIN', 'SENIOR_MANAGER', 'MANAGER'].includes(viewer.role)
        ? 'executive'
        : 'operational',

    reviewsCount: 0,
    teamAverage: null,
    staffSummaries: [],
    missingStaff: [],
    openGoals: [],

    staffRatedCount: 0,
    staffTotalCount: 0,
    staffRatedPercent: null,
    pendingToRateCount: 0,

    ytdCoverage: null,
    assignmentSummary: null,

    topPerformers: [],
    lowPerformers: [],
    shiftTrends: [],
    futureMetrics: [],
    error: 'Unable to load dashboard data.',
  };
}

router.get('/', ensureAuthenticated, async (req, res) => {
  const viewerId = req.session.userId;

  const viewer = await User.findByPk(viewerId, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });

  if (!viewer) return res.redirect('/login');

  // Staff goes to their own review page
  if (viewer.role === 'STAFF') {
    const now = new Date();
    return res.redirect(`/reviews/my?month=${now.getMonth() + 1}&year=${now.getFullYear()}`);
  }

  const selectedDate = getDateOrToday(req);
  const { month, year } = getMonthYearFromDate(selectedDate);

  const filters = {
    viewerUserId: viewerId,
    date: selectedDate,
    building: String(req.query.building || '').trim(),
    shift: String(req.query.shift || '').trim(),
    area: String(req.query.area || '').trim(),
    productFamily: String(req.query.productFamily || '').trim(),
    testStage: String(req.query.testStage || '').trim(),
  };

  try {
    let data;

    if (['ADMIN', 'SENIOR_MANAGER', 'MANAGER'].includes(viewer.role)) {
      data = await getExecutiveDashboardData(filters);
    } else {
      data = await getOperationalDashboardData(filters);
    }

    // Heat map: most recent review per staff for current month/year
    const HEAT_FIELDS = ['positiveAttitude','proactive','integrity','accountability2','problemSolving','efficiency','resultsOrientation','communication','continuousImprovement','teamwork2','collaboration','buildTrust'];
    const HEAT_LABELS = ['Attitude','Proactive','Integrity','Accountability','Problem Solving','Efficiency','Results','Communication','CI','Teamwork','Collaboration','Trust'];

    const recentReviews = await MonthlyReview.findAll({
      where: { periodMonth: month, periodYear: year },
      include: [{ model: User, as: 'Staff', attributes: ['id', 'name'] }],
      order: [[{ model: User, as: 'Staff' }, 'name', 'ASC']],
      limit: 30,
    });

    const teamHeatMap = {
      fields: HEAT_FIELDS,
      labels: HEAT_LABELS,
      staff: recentReviews.map(function(r) {
        const plain = r.toJSON();
        return {
          staffId: plain.staffId,
          staffName: plain.Staff ? plain.Staff.name.split(' ')[0] : '—',
          scores: HEAT_FIELDS.map(function(f) { return plain[f]; }),
        };
      }),
    };

    // Scope activity feed by role
    const { Op } = await import('sequelize');
    const activityWhere = {};
    const role = viewer.role;

    if (role === 'ADMIN') {
      // ADMIN sees all — no filter
    } else if (role === 'MANAGER' || role === 'SENIOR_MANAGER') {
      // MANAGER sees activity from users within their ManagerScope building/shift pairs
      const scopes = await ManagerScope.findAll({ where: { userId: viewer.id } });
      if (scopes.length > 0) {
        // Find all StaffProfiles matching any of the manager's building/shift pairs
        const scopeConditions = scopes.map(s => ({ building: s.building, shift: s.shift }));
        const scopedProfiles = await StaffProfile.findAll({
          where: { [Op.or]: scopeConditions },
          attributes: ['userId'],
        });
        const scopedUserIds = scopedProfiles.map(p => p.userId);
        // Also include the manager themselves
        scopedUserIds.push(viewer.id);
        activityWhere.actorUserId = { [Op.in]: scopedUserIds };
      }
      // If no scopes defined, manager sees all (fallback)
    } else if (role === 'SUPERVISOR') {
      // SUPERVISOR sees their own activity and LEADs within their building/shift
      const supervisorProfile = viewer.StaffProfile;
      if (supervisorProfile) {
        const leadProfiles = await StaffProfile.findAll({
          where: { building: supervisorProfile.building, shift: supervisorProfile.shift },
          include: [{ model: User, as: 'User', attributes: ['id', 'role'], where: { role: 'LEAD' } }],
          attributes: ['userId'],
        });
        const leadUserIds = leadProfiles.map(p => p.userId);
        activityWhere.actorUserId = { [Op.in]: [viewer.id, ...leadUserIds] };
      } else {
        // No profile — only own activity
        activityWhere.actorUserId = viewer.id;
      }
    } else if (role === 'LEAD') {
      // LEAD only sees their own activity
      activityWhere.actorUserId = viewer.id;
    }

    const activityFeed = await AuditLog.findAll({
      where: activityWhere,
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    const renderPayload = normalizeDashboardRenderPayload({
      viewer,
      data,
      fallbackMonth: month,
      fallbackYear: year,
    });

    renderPayload.teamHeatMap = teamHeatMap;

    renderPayload.activityFeed = activityFeed.map(function(a) {
      const plain = typeof a.toJSON === 'function' ? a.toJSON() : a;
      return {
        id: plain.id,
        actionType: plain.actionType || '',
        summary: plain.summary || '',
        actorName: plain.actorName || '—',
        targetName: plain.targetName || '',
        createdAt: plain.createdAt,
      };
    });

    // ── Prior-month calibration data (for trend arrows) ───────────────────────
    const priorDate  = new Date(year, month - 2, 1);
    const priorMonth = priorDate.getMonth() + 1;
    const priorYear  = priorDate.getFullYear();

    const reviewableIds = [
      ...(data.staffSummaries  || []).map(s => s.staff?.id).filter(Boolean),
      ...(data.missingStaff    || []).map(s => s.id).filter(Boolean),
    ];

    let calibPriorMonth = null;
    if (reviewableIds.length > 0) {
      const priorReviews = await MonthlyReview.findAll({
        where: {
          periodMonth: priorMonth,
          periodYear:  priorYear,
          staffId: { [Op.in]: reviewableIds },
        },
        attributes: ['bucketPeopleAvg','bucketOwnershipAvg','bucketQualityAvg','bucketPartnershipAvg','overallBucketAvg'],
      });

      const avgField = (field) => {
        const vals = priorReviews.map(r => r.dataValues[field]).filter(v => typeof v === 'number' && !isNaN(v));
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };

      calibPriorMonth = {
        month:       priorMonth,
        year:        priorYear,
        overall:     avgField('overallBucketAvg'),
        people:      avgField('bucketPeopleAvg'),
        ownership:   avgField('bucketOwnershipAvg'),
        quality:     avgField('bucketQualityAvg'),
        partnership: avgField('bucketPartnershipAvg'),
      };
    }
    renderPayload.calibPriorMonth = calibPriorMonth;

    return res.render('dashboard', renderPayload);
  } catch (err) {
    console.error('DASHBOARD ROUTE ERROR:', err);

    return res.status(500).render(
      'dashboard',
      buildDashboardErrorPayload({
        viewer,
        month,
        year,
        selectedDate,
        filters,
      })
    );
  }
});

// ── GET /dashboard/calibration — 12-month history page ───────────────────────
router.get('/calibration', ensureAuthenticated, async (req, res) => {
  const viewerId = req.session.userId;
  const viewer   = await User.findByPk(viewerId);
  if (!viewer || !['ADMIN','SENIOR_MANAGER','MANAGER'].includes(viewer.role)) {
    return res.redirect('/dashboard');
  }

  const { Op } = await import('sequelize');

  // Last 12 months in chronological order
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  // Fetch all reviews submitted by this viewer in the window
  const reviews = await MonthlyReview.findAll({
    where: {
      submitterId: viewerId,
      [Op.or]: months.map(m => ({ periodMonth: m.month, periodYear: m.year })),
    },
    attributes: ['periodMonth','periodYear','bucketPeopleAvg','bucketOwnershipAvg','bucketQualityAvg','bucketPartnershipAvg','overallBucketAvg'],
  });

  // Group by period key
  const grouped = {};
  for (const r of reviews) {
    const key = `${r.periodYear}-${r.periodMonth}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r.dataValues);
  }

  const avgField = (recs, field) => {
    const vals = recs.map(r => r[field]).filter(v => typeof v === 'number' && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const history = months.map(m => {
    const key  = `${m.year}-${m.month}`;
    const recs = grouped[key] || [];
    return {
      month:       m.month,
      year:        m.year,
      label:       `${MONTH_NAMES[m.month - 1]} '${String(m.year).slice(2)}`,
      count:       recs.length,
      overall:     avgField(recs, 'overallBucketAvg'),
      people:      avgField(recs, 'bucketPeopleAvg'),
      ownership:   avgField(recs, 'bucketOwnershipAvg'),
      quality:     avgField(recs, 'bucketQualityAvg'),
      partnership: avgField(recs, 'bucketPartnershipAvg'),
    };
  });

  return res.render('dashboard/calibration', {
    history,
    currentUserRole: viewer.role,
    currentUser:     viewer,
    pageTitle:       'Score Calibration History',
  });
});

// ── GET /dashboard/calibration.csv — export current month snapshot ────────────
router.get('/calibration.csv', ensureAuthenticated, async (req, res) => {
  const viewerId = req.session.userId;
  const viewer   = await User.findByPk(viewerId);
  if (!viewer || !['ADMIN','SENIOR_MANAGER','MANAGER'].includes(viewer.role)) {
    return res.status(403).send('Forbidden');
  }

  const selectedDate = getDateOrToday(req);
  const { month, year } = getMonthYearFromDate(selectedDate);

  const filters = {
    viewerUserId: viewerId,
    date:         selectedDate,
    building:     String(req.query.building || '').trim(),
    shift:        String(req.query.shift    || '').trim(),
    area:         '',
    productFamily:'',
    testStage:    '',
  };

  const data = await getExecutiveDashboardData(filters);
  const staffSummaries = Array.isArray(data?.staffSummaries) ? data.staffSummaries : [];

  const fmt = (v) => (typeof v === 'number' && !isNaN(v)) ? v.toFixed(2) : '';
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const header = ['Staff','Shift','Building','Overall','People First','Ownership','Quality','Partnership'];
  const rows = staffSummaries.map(s => [
    s.staff?.name        || '',
    s.shift              || '',
    s.building           || '',
    fmt(s.avgScore),
    fmt(s.bucketPeopleAvg),
    fmt(s.bucketOwnershipAvg),
    fmt(s.bucketQualityAvg),
    fmt(s.bucketPartnershipAvg),
  ]);

  const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const filename = `calibration-${year}-${String(month).padStart(2,'0')}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
});

export default router;