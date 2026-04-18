// src/routes/reviews.js
import express from 'express';
import { Op } from 'sequelize';
import {
  MonthlyReview,
  User,
  StaffProfile,
  ReviewAssignment,
  ReviewChangeLog,
  ManagerScope,
  Incident,
} from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLogger.js';
import { POSITION_CRITERIA } from '../constants/reviewTemplates.js';

const router = express.Router();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function parseScore(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

function average(values) {
  const filtered = values.filter((v) => v != null);
  if (!filtered.length) return null;
  const total = filtered.reduce((sum, v) => sum + v, 0);
  return total / filtered.length;
}

function cleanText(val, maxLen = 4000) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

async function getViewer(req) {
  if (!req.session || !req.session.userId) return null;
  return User.findByPk(req.session.userId, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });
}

function norm(v) {
  return String(v ?? '').trim();
}

function getReviewViewerScope(viewer) {
  const role = normalizeRole(viewer?.role);

  if (role === 'ADMIN') {
    return { kind: 'ADMIN', scoped: false, scopePairs: [], building: '', shift: '' };
  }

  if (role === 'SENIOR_MANAGER') {
    return { kind: 'SENIOR_MANAGER', scoped: false, scopePairs: [], building: '', shift: '' };
  }

  if (role === 'MANAGER') {
    const scopePairs = (viewer?.ManagerScopes || [])
      .map((s) => ({
        building: norm(s.building),
        shift: norm(s.shift),
      }))
      .filter((s) => s.building && s.shift);

    return {
      kind: 'MANAGER',
      scoped: true,
      scopePairs,
      building: '',
      shift: '',
    };
  }

  if (role === 'SUPERVISOR') {
    // Supervisors are always scoped — if no profile/building/shift, they see nothing
    return {
      kind: 'SUPERVISOR',
      scoped: true,
      scopePairs: [],
      building: norm(viewer?.StaffProfile?.building),
      shift: norm(viewer?.StaffProfile?.shift),
    };
  }

  return { kind: role || 'UNKNOWN', scoped: false, scopePairs: [], building: '', shift: '' };
}

function canViewerAccessStaffBuildingOnly(viewer, staffUser) {
  if (!viewer || !staffUser) return false;
  const viewerScope = getReviewViewerScope(viewer);
  if (!viewerScope.scoped) return true;

  const sProfile = staffUser.StaffProfile || null;
  const staffBuilding = norm(sProfile?.building);
  const staffShift = norm(sProfile?.shift);

  if (viewerScope.kind === 'MANAGER') {
    if (!viewerScope.scopePairs.length) return false;
    if (!staffBuilding || !staffShift) return false;
    return viewerScope.scopePairs.some(
      (pair) => pair.building === staffBuilding && pair.shift === staffShift
    );
  }

  if (viewerScope.kind === 'SUPERVISOR') {
    // Supervisor must have a building/shift on their profile to see anything
    if (!viewerScope.building && !viewerScope.shift) return false;
    if (!staffBuilding && !staffShift) return false;
    if (viewerScope.building && viewerScope.building !== staffBuilding) return false;
    if (viewerScope.shift && viewerScope.shift !== staffShift) return false;
    return true;
  }

  return false;
}

async function isStaffAssignedToReviewer(reviewerId, staffId) {
  const found = await ReviewAssignment.findOne({
    where: {
      reviewerId: Number(reviewerId),
      staffId: Number(staffId),
      active: true,
    },
  });
  return !!found;
}

function canEditReview(viewer, review) {
  if (!viewer || !review) return false;

  const role = normalizeRole(viewer.role);
  if (role === 'ADMIN') return true;
  if (role === 'MANAGER' || role === 'SENIOR_MANAGER') return true;

  return Number(review.submitterId) === Number(viewer.id);
}

function canDeleteReview(viewer) {
  if (!viewer) return false;
  const role = normalizeRole(viewer.role);
  return role === 'ADMIN' || role === 'MANAGER' || role === 'SENIOR_MANAGER';
}

// computeBucketScores
// ─────────────────────────────────────────────────────────────────────────────
// Calculates per-bucket averages and the overall score for a submitted review.
//
// WEIGHTING DESIGN (deliberate — do not change without updating this comment):
//
//   Each of the five buckets contains exactly 3 criteria.
//   overallBucketAvg = mean of the answered-bucket averages.
//
//   With equal bucket sizes, average-of-bucket-averages is mathematically
//   identical to a flat average across all answered criteria, so equal-bucket
//   weighting is the correct and simplest approach.
//
//   The intermediate bucket averages (bucketPeopleAvg etc.) are stored in the
//   DB so dashboards can display per-bucket breakdowns without re-computing.
//
//   Leading People bucket (decisionMakingWithRisk / enableTheTeam /
//   hireDevelopManage) is only included in the overall when the reviewer is
//   scoring a Lead, Champion, or Supervisor. For other roles the three fields
//   are left null and the bucket is excluded from the average.
//
//   Partial bucket completion: the average() helper skips null values and
//   divides by the count of non-null scores, so a partial bucket still
//   carries the same weight as a complete one. In practice this edge case
//   is now closed by server-side validateScoreFields() rejecting submissions
//   with any empty score (added in the inline-validation task).
// ─────────────────────────────────────────────────────────────────────────────
async function computeBucketScores(staffId, body) {
  const staff = await User.findByPk(staffId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });

  const positionType =
    staff &&
    staff.StaffProfile &&
    staff.StaffProfile.positionType
      ? String(staff.StaffProfile.positionType).toUpperCase()
      : 'TECHNICIAN';

  const isLeadChampionOrSupervisor =
    positionType === 'LEAD' ||
    positionType === 'SUPERVISOR' ||
    positionType === 'CHAMPION';

  const peopleScores = [
    parseScore(body.positiveAttitude),
    parseScore(body.proactive),
    parseScore(body.integrity),
  ];

  const ownershipScores = [
    parseScore(body.accountability2),
    parseScore(body.problemSolving),
    parseScore(body.efficiency),
  ];

  const qualityScores = [
    parseScore(body.resultsOrientation),
    parseScore(body.communication),
    parseScore(body.continuousImprovement),
  ];

  const partnershipScores = [
    parseScore(body.teamwork2),
    parseScore(body.collaboration),
    parseScore(body.buildTrust),
  ];

  const leadingScores = isLeadChampionOrSupervisor
    ? [
        parseScore(body.decisionMakingWithRisk),
        parseScore(body.enableTheTeam),
        parseScore(body.hireDevelopManage),
      ]
    : [];

  const bucketPeopleAvg = average(peopleScores);
  const bucketOwnershipAvg = average(ownershipScores);
  const bucketQualityAvg = average(qualityScores);
  const bucketPartnershipAvg = average(partnershipScores);
  const bucketLeadingAvg = isLeadChampionOrSupervisor ? average(leadingScores) : null;

  const bucketList = [
    bucketPeopleAvg,
    bucketOwnershipAvg,
    bucketQualityAvg,
    bucketPartnershipAvg,
  ];
  if (bucketLeadingAvg != null) bucketList.push(bucketLeadingAvg);

  const overallBucketAvg = average(bucketList);

  return {
    positionTypeSnapshot: positionType,
    isLeadChampionOrSupervisor,
    bucketPeopleAvg,
    bucketOwnershipAvg,
    bucketQualityAvg,
    bucketPartnershipAvg,
    bucketLeadingAvg,
    overallBucketAvg,
  };
}

function deriveOverallScore(reviewPlain) {
  if (reviewPlain.overallBucketAvg != null) return reviewPlain.overallBucketAvg;

  const candidateFields = [
    'technicalCompetence',
    'materialHandling',
    'timeManagement',
    'repair',
    'accountability',
    'troubleshooting',
    'initiative',
    'culturalFit',
    'communicationSkills',
    'teamwork',

    'positiveAttitude',
    'proactive',
    'integrity',
    'accountability2',
    'problemSolving',
    'efficiency',
    'resultsOrientation',
    'communication',
    'continuousImprovement',
    'teamwork2',
    'collaboration',
    'buildTrust',
    'decisionMakingWithRisk',
    'enableTheTeam',
    'hireDevelopManage',
  ];

  const values = candidateFields
    .map((f) => (typeof reviewPlain[f] === 'number' ? reviewPlain[f] : null))
    .filter((v) => v != null);

  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function extractQuestionComments(body) {
  return {
    positiveAttitudeComment: cleanText(body.positiveAttitudeComment),
    proactiveComment: cleanText(body.proactiveComment),
    integrityComment: cleanText(body.integrityComment),

    accountability2Comment: cleanText(body.accountability2Comment),
    problemSolvingComment: cleanText(body.problemSolvingComment),
    efficiencyComment: cleanText(body.efficiencyComment),

    resultsOrientationComment: cleanText(body.resultsOrientationComment),
    communicationComment: cleanText(body.communicationComment),
    continuousImprovementComment: cleanText(body.continuousImprovementComment),

    teamwork2Comment: cleanText(body.teamwork2Comment),
    collaborationComment: cleanText(body.collaborationComment),
    buildTrustComment: cleanText(body.buildTrustComment),

    decisionMakingWithRiskComment: cleanText(body.decisionMakingWithRiskComment),
    enableTheTeamComment: cleanText(body.enableTheTeamComment),
    hireDevelopManageComment: cleanText(body.hireDevelopManageComment),
  };
}

function normForLog(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  return String(v);
}

async function writeFieldLogs({ reviewId, changedById, before, after, changedAt }) {
  const rows = [];

  Object.keys(after).forEach((field) => {
    const oldVal = normForLog(before[field]);
    const newVal = normForLog(after[field]);

    if (oldVal === newVal) return;

    rows.push({
      reviewId,
      changedById,
      field,
      oldValue: oldVal,
      newValue: newVal,
      changedAt: changedAt || new Date(),
    });
  });

  if (rows.length) {
    await ReviewChangeLog.bulkCreate(rows);
  }

  return rows;
}

function getReviewAuditFields(plain) {
  return {
    positiveAttitude: plain.positiveAttitude,
    proactive: plain.proactive,
    integrity: plain.integrity,
    accountability2: plain.accountability2,
    problemSolving: plain.problemSolving,
    efficiency: plain.efficiency,
    resultsOrientation: plain.resultsOrientation,
    communication: plain.communication,
    continuousImprovement: plain.continuousImprovement,
    teamwork2: plain.teamwork2,
    collaboration: plain.collaboration,
    buildTrust: plain.buildTrust,
    decisionMakingWithRisk: plain.decisionMakingWithRisk,
    enableTheTeam: plain.enableTheTeam,
    hireDevelopManage: plain.hireDevelopManage,
    comment: plain.comment,
    ...extractQuestionComments(plain),
  };
}

function getChangedFieldNames(before, after) {
  return Object.keys(after).filter((field) => {
    return normForLog(before[field]) !== normForLog(after[field]);
  });
}

// ─────────────────────────────────────────────
// GET /reviews/new
// ─────────────────────────────────────────────
router.get(
  '/new',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    const selectedStaffId = req.query.staffId ? Number(req.query.staffId) : null;

    const currentUserId = req.session.userId;
    const currentUser = await User.findByPk(currentUserId, {
      include: [
        { model: StaffProfile, as: 'StaffProfile' },
        { model: ManagerScope, as: 'ManagerScopes' },
      ],
    });

    let staff = [];
    const currentRole = normalizeRole(currentUser?.role);

    if (currentRole === 'LEAD') {
      const assignments = await ReviewAssignment.findAll({
        where: { reviewerId: currentUserId, active: true },
        include: [
          {
            model: User,
            as: 'Staff',
            required: true,
            where: { role: { [Op.notIn]: ['ADMIN'] } },
            include: [{ model: StaffProfile, as: 'StaffProfile' }],
          },
        ],
        order: [[{ model: User, as: 'Staff' }, 'name', 'ASC']],
      });

      const unique = new Map();
      assignments.forEach((a) => {
        if (a?.Staff?.id) unique.set(a.Staff.id, a.Staff);
      });
      staff = Array.from(unique.values());
    } else if (currentRole === 'ADMIN') {
      staff = await User.findAll({
        where: { role: { [Op.notIn]: ['ADMIN'] } },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });
    } else {
      const allStaff = await User.findAll({
        where: { role: { [Op.notIn]: ['ADMIN'] } },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });
      staff = allStaff.filter((s) => canViewerAccessStaffBuildingOnly(currentUser, s));
    }

    const existingReviews = await MonthlyReview.findAll({
      where: {
        submitterId: currentUserId,
        periodMonth: month,
        periodYear: year,
      },
    });

    const existingReviewMap = {};
    existingReviews.forEach((r) => {
      if (r.staffId != null) existingReviewMap[r.staffId] = r.id;
    });

    let openIncidents = [];
    if (selectedStaffId) {
      openIncidents = await Incident.findAll({
        where: { staffId: selectedStaffId, status: { [Op.notIn]: ['RESOLVED', 'CLOSED'] } },
        order: [['incidentDate', 'DESC']],
      });
    }

    res.render('reviews/new', {
      staff,
      month,
      year,
      selectedStaffId,
      currentUserId,
      currentUserRole: currentUser.role,
      duplicateWarning: false,
      existingReviewMap,
      positionCriteria: POSITION_CRITERIA,
      openIncidents,
    });
  }
);

// ─────────────────────────────────────────────
// POST /reviews
// ─────────────────────────────────────────────
router.post(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    try {
      const staffIdNum = Number(req.body.staffId);
      const submitterIdNum = Number(req.body.submitterId);
      const monthNum = Number(req.body.periodMonth);
      const yearNum = Number(req.body.periodYear);

      const viewer = await getViewer(req);
      if (!viewer) return res.redirect('/login');

      const targetStaff = await User.findByPk(staffIdNum, {
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      });
      if (!targetStaff) return res.status(400).send('Staff not found.');

      const viewerRole = normalizeRole(viewer.role);

      if (viewerRole === 'LEAD') {
        const assigned = await isStaffAssignedToReviewer(viewer.id, staffIdNum);
        if (!assigned) return res.status(403).send('You can only review staff assigned to you.');
      } else if (viewerRole !== 'ADMIN') {
        if (!canViewerAccessStaffBuildingOnly(viewer, targetStaff)) {
          return res.status(403).send('You can only review staff within your scope.');
        }
      }

      const existing = await MonthlyReview.findOne({
        where: {
          staffId: staffIdNum,
          submitterId: submitterIdNum,
          periodMonth: monthNum,
          periodYear: yearNum,
        },
      });

      if (existing) {
        return res.redirect(`/reviews/${existing.id}/edit?duplicate=1`);
      }

      const bucketScores = await computeBucketScores(staffIdNum, req.body);

      const created = await MonthlyReview.create({
        staffId: staffIdNum,
        submitterId: submitterIdNum,
        periodMonth: monthNum,
        periodYear: yearNum,

        positiveAttitude: parseScore(req.body.positiveAttitude),
        proactive: parseScore(req.body.proactive),
        integrity: parseScore(req.body.integrity),

        accountability2: parseScore(req.body.accountability2),
        problemSolving: parseScore(req.body.problemSolving),
        efficiency: parseScore(req.body.efficiency),

        resultsOrientation: parseScore(req.body.resultsOrientation),
        communication: parseScore(req.body.communication),
        continuousImprovement: parseScore(req.body.continuousImprovement),

        teamwork2: parseScore(req.body.teamwork2),
        collaboration: parseScore(req.body.collaboration),
        buildTrust: parseScore(req.body.buildTrust),

        decisionMakingWithRisk: parseScore(req.body.decisionMakingWithRisk),
        enableTheTeam: parseScore(req.body.enableTheTeam),
        hireDevelopManage: parseScore(req.body.hireDevelopManage),

        ...extractQuestionComments(req.body),

        bucketPeopleAvg: bucketScores.bucketPeopleAvg,
        bucketOwnershipAvg: bucketScores.bucketOwnershipAvg,
        bucketQualityAvg: bucketScores.bucketQualityAvg,
        bucketPartnershipAvg: bucketScores.bucketPartnershipAvg,
        bucketLeadingAvg: bucketScores.bucketLeadingAvg,
        overallBucketAvg: bucketScores.overallBucketAvg,
        positionTypeSnapshot: bucketScores.positionTypeSnapshot,

        comment: cleanText(req.body.comment),
      });

      const changedAt = new Date();
      const after = created.get({ plain: true });
      const before = {};
      const fieldsToLog = getReviewAuditFields(after);

      const fieldRows = await writeFieldLogs({
        reviewId: created.id,
        changedById: viewer.id,
        before,
        after: fieldsToLog,
        changedAt,
      });

      await createAuditLog({
        req,
        actorUser: viewer,
        actionType: 'CREATE',
        entityType: 'MONTHLY_REVIEW',
        entityId: created.id,
        targetName: targetStaff.name || targetStaff.username || `staffId ${targetStaff.id}`,
        summary: `Created monthly review for ${targetStaff.name || targetStaff.username || `staffId ${targetStaff.id}`} for ${monthNum}/${yearNum}.`,
        details: {
          reviewId: created.id,
          staffId: created.staffId,
          submitterId: created.submitterId,
          periodMonth: created.periodMonth,
          periodYear: created.periodYear,
          changedFields: fieldRows.map((r) => r.field),
        },
      });

      res.redirect('/reviews/my');
    } catch (err) {
      console.error('REVIEWS POST ERROR:', err);
      res.status(500).send('Error creating review');
    }
  }
);

// ─────────────────────────────────────────────
// GET /reviews/my
// ─────────────────────────────────────────────
router.get(
  '/submitted',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const submitterId = Number(req.query.submitterId) || '';
    const month = Number(req.query.month) || '';
    const year = Number(req.query.year) || '';
    const minAvg = req.query.minAvg !== undefined && req.query.minAvg !== ''
      ? Number(req.query.minAvg)
      : '';
    const maxAvg = req.query.maxAvg !== undefined && req.query.maxAvg !== ''
      ? Number(req.query.maxAvg)
      : '';

    const where = {};
    if (month) where.periodMonth = month;
    if (year) where.periodYear = year;

    const reviewRows = await MonthlyReview.findAll({
      where,
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
        { model: User, as: 'Submitter' },
      ],
      order: [
        ['periodYear', 'DESC'],
        ['periodMonth', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const scopedReviews = reviewRows
      .filter((review) => canViewerAccessStaffBuildingOnly(viewer, review.Staff))
      .map((review) => {
        const plain = review.get({ plain: true });
        return {
          ...plain,
          avgScore: deriveOverallScore(plain),
          staffName: plain.Staff?.name || 'N/A',
          submitterName: plain.Submitter?.name || plain.Submitter?.username || 'N/A',
          staffBuilding: norm(plain.Staff?.StaffProfile?.building),
          staffShift: norm(plain.Staff?.StaffProfile?.shift),
        };
      });

    const submitterOptions = Array.from(
      scopedReviews.reduce((map, review) => {
        if (review.submitterId && review.submitterName) {
          map.set(review.submitterId, {
            id: review.submitterId,
            name: review.submitterName,
          });
        }
        return map;
      }, new Map()).values()
    ).sort((a, b) => a.name.localeCompare(b.name));

    let reviews = scopedReviews;

    if (submitterId) {
      reviews = reviews.filter((review) => Number(review.submitterId) === Number(submitterId));
    }

    if (minAvg !== '' && Number.isFinite(minAvg)) {
      reviews = reviews.filter((review) => review.avgScore != null && review.avgScore >= minAvg);
    }

    if (maxAvg !== '' && Number.isFinite(maxAvg)) {
      reviews = reviews.filter((review) => review.avgScore != null && review.avgScore <= maxAvg);
    }

    const scopedReviewIds = new Set(reviews.map((review) => review.staffId));
    const scopedSubmitterIds = new Set(reviews.map((review) => review.submitterId).filter(Boolean));
    const avgValues = reviews.map((review) => review.avgScore).filter((value) => value != null);
    const averageOfAverages = avgValues.length
      ? avgValues.reduce((sum, value) => sum + value, 0) / avgValues.length
      : null;

    res.render('reviews/submitted', {
      reviews,
      submitterOptions,
      filters: {
        submitterId,
        month,
        year,
        minAvg,
        maxAvg,
      },
      stats: {
        totalReviews: reviews.length,
        uniqueStaffCount: scopedReviewIds.size,
        uniqueSubmitterCount: scopedSubmitterIds.size,
        averageOfAverages,
      },
      currentRole: normalizeRole(viewer.role),
    });
  }
);

router.get(
  '/my',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    const userId = req.session.userId;

    const currentUser = await User.findByPk(userId, {
      include: [
        { model: StaffProfile, as: 'StaffProfile' },
        { model: ManagerScope, as: 'ManagerScopes' },
      ],
    });
    if (!currentUser) return res.redirect('/login');

    let allStaff = [];
    const currentRole = normalizeRole(currentUser.role);

    if (currentRole === 'LEAD') {
      const assignments = await ReviewAssignment.findAll({
        where: { reviewerId: userId, active: true },
        include: [
          {
            model: User,
            as: 'Staff',
            required: true,
            where: { role: { [Op.notIn]: ['ADMIN'] } },
            include: [{ model: StaffProfile, as: 'StaffProfile' }],
          },
        ],
        order: [[{ model: User, as: 'Staff' }, 'name', 'ASC']],
      });

      const unique = new Map();
      assignments.forEach((a) => {
        if (a?.Staff?.id) unique.set(a.Staff.id, a.Staff);
      });
      allStaff = Array.from(unique.values());
    } else if (currentRole === 'ADMIN') {
      allStaff = await User.findAll({
        where: { role: { [Op.notIn]: ['ADMIN'] } },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });
    } else {
      const rawStaff = await User.findAll({
        where: { role: { [Op.notIn]: ['ADMIN'] } },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });

      allStaff = rawStaff.filter((s) => canViewerAccessStaffBuildingOnly(currentUser, s));
    }

    const totalStaffCount = allStaff.length;
    const scopedStaffIds = new Set(allStaff.map((s) => s.id));

    const reviews = await MonthlyReview.findAll({
      where: {
        submitterId: userId,
        periodMonth: month,
        periodYear: year,
      },
      include: [{ model: User, as: 'Staff' }],
      order: [
        ['periodYear', 'DESC'],
        ['periodMonth', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    const reviewsForView = reviews
      .filter((r) => scopedStaffIds.has(r.staffId))
      .map((r) => {
        const plain = r.get({ plain: true });
        const avgScore = deriveOverallScore(plain);
        return { ...plain, staffName: plain.Staff ? plain.Staff.name : 'N/A', avgScore };
      });

    const uniqueStaffReviewed = new Set(
      reviewsForView.map((r) => r.staffId).filter((id) => id != null)
    );

    const coveragePercent =
      totalStaffCount > 0 ? (uniqueStaffReviewed.size / totalStaffCount) * 100 : 0;

    res.render('reviews/my', {
      month,
      year,
      reviews: reviewsForView,
      coveragePercent,
      totalStaffCount,
      reviewedCount: uniqueStaffReviewed.size,
    });
  }
);

// ─────────────────────────────────────────────
// GET /reviews/:id/edit
// ─────────────────────────────────────────────
router.get(
  '/:id/edit',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const id = Number(req.params.id);
    const duplicateWarning = req.query.duplicate === '1';

    const review = await MonthlyReview.findByPk(id, {
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
        { model: User, as: 'Submitter' },
      ],
    });

    if (!review) return res.status(404).send('Review not found');

    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    if (!canEditReview(viewer, review)) {
      return res.status(403).send('You do not have permission to edit this review.');
    }

    const plainReview = review.get({ plain: true });

    const openIncidents = review.staffId ? await Incident.findAll({
      where: {
        staffId: review.staffId,
        requiresFollowUp: true,
        followUpStatus: { [Op.in]: ['OPEN', 'IN_PROGRESS'] },
      },
      order: [['incidentDate', 'DESC']],
    }) : [];

    res.render('reviews/edit', {
      review: plainReview,
      currentUserId: viewer.id,
      duplicateWarning,
      recentChanges: [],
      positionCriteria: POSITION_CRITERIA,
      openIncidents,
    });
  }
);

// ─────────────────────────────────────────────
// POST /reviews/:id/update
// ─────────────────────────────────────────────
router.post(
  '/:id/update',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await MonthlyReview.findByPk(id, {
        include: [
          {
            model: User,
            as: 'Staff',
            include: [{ model: StaffProfile, as: 'StaffProfile' }],
          },
        ],
      });

      if (!review) return res.status(404).send('Review not found');

      const viewer = await getViewer(req);
      if (!viewer) return res.redirect('/login');

      if (!canEditReview(viewer, review)) {
        return res.status(403).send('You do not have permission to edit this review.');
      }

      const beforePlain = review.get({ plain: true });
      const beforeAuditFields = getReviewAuditFields(beforePlain);

      const bucketScores = await computeBucketScores(review.staffId, req.body);

      await review.update({
        positiveAttitude: parseScore(req.body.positiveAttitude),
        proactive: parseScore(req.body.proactive),
        integrity: parseScore(req.body.integrity),

        accountability2: parseScore(req.body.accountability2),
        problemSolving: parseScore(req.body.problemSolving),
        efficiency: parseScore(req.body.efficiency),

        resultsOrientation: parseScore(req.body.resultsOrientation),
        communication: parseScore(req.body.communication),
        continuousImprovement: parseScore(req.body.continuousImprovement),

        teamwork2: parseScore(req.body.teamwork2),
        collaboration: parseScore(req.body.collaboration),
        buildTrust: parseScore(req.body.buildTrust),

        decisionMakingWithRisk: parseScore(req.body.decisionMakingWithRisk),
        enableTheTeam: parseScore(req.body.enableTheTeam),
        hireDevelopManage: parseScore(req.body.hireDevelopManage),

        ...extractQuestionComments(req.body),

        bucketPeopleAvg: bucketScores.bucketPeopleAvg,
        bucketOwnershipAvg: bucketScores.bucketOwnershipAvg,
        bucketQualityAvg: bucketScores.bucketQualityAvg,
        bucketPartnershipAvg: bucketScores.bucketPartnershipAvg,
        bucketLeadingAvg: bucketScores.bucketLeadingAvg,
        overallBucketAvg: bucketScores.overallBucketAvg,
        positionTypeSnapshot: bucketScores.positionTypeSnapshot,

        comment: cleanText(req.body.comment),
      });

      const afterPlain = review.get({ plain: true });
      const afterAuditFields = getReviewAuditFields(afterPlain);
      const changedFields = getChangedFieldNames(beforeAuditFields, afterAuditFields);

      await writeFieldLogs({
        reviewId: review.id,
        changedById: viewer.id,
        before: beforeAuditFields,
        after: afterAuditFields,
        changedAt: new Date(),
      });

      if (changedFields.length) {
        const staffName =
          review.Staff?.name ||
          review.Staff?.username ||
          `staffId ${review.staffId}`;

        await createAuditLog({
          req,
          actorUser: viewer,
          actionType: 'UPDATE',
          entityType: 'MONTHLY_REVIEW',
          entityId: review.id,
          targetName: staffName,
          summary: `Updated monthly review for ${staffName}.`,
          details: {
            reviewId: review.id,
            staffId: review.staffId,
            submitterId: review.submitterId,
            periodMonth: review.periodMonth,
            periodYear: review.periodYear,
            changedFields,
          },
        });
      }

      if (review.staffId) {
        return res.redirect(`/staff/${review.staffId}`);
      }
      return res.redirect('/reviews/my');
    } catch (err) {
      console.error('REVIEWS UPDATE ERROR:', err);
      res.status(500).send('Error updating review');
    }
  }
);

// ─────────────────────────────────────────────
// GET /reviews/criteria
// ─────────────────────────────────────────────
router.get(
  '/criteria',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');
    return res.render('reviews/criteria', {
      currentUser: viewer,
      path: req.path,
    });
  }
);

// ─────────────────────────────────────────────
// GET /reviews/audit
// ─────────────────────────────────────────────
router.get(
  '/audit',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    const logs = await ReviewChangeLog.findAll({
      order: [['changedAt', 'DESC']],
      limit: 1000,
      include: [
        { model: User, as: 'ChangedBy' },
        {
          model: MonthlyReview,
          include: [
            { model: User, as: 'Staff' },
            { model: User, as: 'Submitter' },
          ],
        },
      ],
    });

    res.render('reviews/audit', { logs });
  }
);

// ─────────────────────────────────────────────
// GET /reviews/changes
// ─────────────────────────────────────────────
router.get(
  '/changes',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    const logs = await ReviewChangeLog.findAll({
      order: [['changedAt', 'DESC']],
      limit: 2000,
      include: [
        { model: User, as: 'ChangedBy' },
        {
          model: MonthlyReview,
          include: [
            { model: User, as: 'Staff' },
            { model: User, as: 'Submitter' },
          ],
        },
      ],
    });

    const groups = new Map();

    logs.forEach((log) => {
      const reviewId = log.reviewId;
      const changedById = log.changedById;
      const dt = log.changedAt instanceof Date ? log.changedAt : new Date(log.changedAt);
      const minuteKey = dt.toISOString().slice(0, 16);

      const key = `${reviewId}|${changedById}|${minuteKey}`;

      if (!groups.has(key)) {
        const mr = log.MonthlyReview;
        groups.set(key, {
          createdAt: dt,
          changeType: 'UPDATE',
          staffName: mr?.Staff?.name || 'N/A',
          submitterName: mr?.Submitter?.name || 'N/A',
          changedByName: log.ChangedBy?.name || 'N/A',
          periodMonth: mr?.periodMonth || null,
          periodYear: mr?.periodYear || null,
          description: null,
          diff: [],
        });
      }

      const g = groups.get(key);
      g.diff.push({
        field: log.field,
        old: log.oldValue === null ? '—' : log.oldValue,
        new: log.newValue === null ? '—' : log.newValue,
      });
    });

    const changes = Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt);

    res.render('reviews/changes', { changes });
  }
);

// ─────────────────────────────────────────────
// POST /reviews/:id/delete
// ─────────────────────────────────────────────
router.post(
  '/:id/delete',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).send('Invalid review id');

      const viewer = await getViewer(req);
      if (!viewer) return res.redirect('/login');

      const review = await MonthlyReview.findByPk(id, {
        include: [{ model: User, as: 'Staff' }],
      });
      if (!review) return res.status(404).send('Review not found');

      if (!canDeleteReview(viewer)) {
        return res.status(403).send('You do not have permission to delete this review.');
      }

      const staffId = review.staffId;
      const staffName =
        review.Staff?.name ||
        review.Staff?.username ||
        `staffId ${review.staffId}`;

      await MonthlyReview.sequelize.transaction(async (t) => {
        await ReviewChangeLog.create(
          {
            reviewId: review.id,
            changedById: viewer.id,
            field: '__DELETE__',
            oldValue: 'Review deleted',
            newValue: null,
            changedAt: new Date(),
          },
          { transaction: t }
        );

        await ReviewChangeLog.destroy({
          where: { reviewId: review.id },
          transaction: t,
        });

        await review.destroy({ transaction: t });
      });

      await createAuditLog({
        req,
        actorUser: viewer,
        actionType: 'DELETE',
        entityType: 'MONTHLY_REVIEW',
        entityId: id,
        targetName: staffName,
        summary: `Deleted monthly review for ${staffName}.`,
        details: {
          reviewId: id,
          staffId,
        },
      });

      if (staffId) return res.redirect(`/staff/${staffId}`);
      return res.redirect('/reviews/my');
    } catch (err) {
      console.error('REVIEWS DELETE ERROR:', err);
      return res.status(500).send('Error deleting review');
    }
  }
);

// ─────────────────────────────────────────────
// GET /reviews/calibration
// Side-by-side review comparison for a given period
// ─────────────────────────────────────────────
router.get(
  '/calibration',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const now = new Date();
    let month, year;
    if (req.query.period && /^\d{1,2}-\d{4}$/.test(req.query.period)) {
      const [m, y] = req.query.period.split('-').map(Number);
      month = m; year = y;
    } else {
      month = Number(req.query.month) || now.getMonth() + 1;
      year  = Number(req.query.year)  || now.getFullYear();
    }

    const SCORE_FIELDS = [
      'positiveAttitude','proactive','integrity',
      'accountability2','problemSolving','efficiency',
      'resultsOrientation','communication','continuousImprovement',
      'teamwork2','collaboration','buildTrust',
    ];

    // Fetch all reviews for this period, then scope-filter in JS (mirrors canViewerAccessStaffBuildingOnly)
    const allForPeriod = await MonthlyReview.findAll({
      where: { periodMonth: month, periodYear: year },
      include: [
        { model: User, as: 'Staff', include: [{ model: StaffProfile, as: 'StaffProfile' }] },
        { model: User, as: 'Submitter', attributes: ['id', 'name', 'role'] },
      ],
      order: [[{ model: User, as: 'Staff' }, 'name', 'ASC']],
    });

    const viewerRole = normalizeRole(viewer.role);
    const reviews = allForPeriod.filter((r) => {
      if (!canViewerAccessStaffBuildingOnly(viewer, r.Staff)) return false;
      // Supervisors may only see reviews submitted by LEADs (not MANAGERs or ADMINs)
      if (viewerRole === 'SUPERVISOR') {
        const submitterRole = normalizeRole(r.Submitter?.role);
        if (submitterRole === 'ADMIN' || submitterRole === 'SENIOR_MANAGER' || submitterRole === 'MANAGER') return false;
      }
      return true;
    });

    // Build dropdown: distinct periods that have at least one review visible to this viewer
    const allPeriodRows = await MonthlyReview.findAll({
      attributes: ['periodMonth', 'periodYear'],
      include: [
        { model: User, as: 'Staff', attributes: ['id'], include: [{ model: StaffProfile, as: 'StaffProfile', attributes: ['building', 'shift'] }] },
        { model: User, as: 'Submitter', attributes: ['id', 'role'] },
      ],
    });
    const seenPeriods = new Set();
    const availablePeriods = [];
    for (const r of allPeriodRows) {
      if (!canViewerAccessStaffBuildingOnly(viewer, r.Staff)) continue;
      if (viewerRole === 'SUPERVISOR') {
        const submitterRole = normalizeRole(r.Submitter?.role);
        if (submitterRole === 'ADMIN' || submitterRole === 'SENIOR_MANAGER' || submitterRole === 'MANAGER') continue;
      }
      const key = `${r.periodMonth}-${r.periodYear}`;
      if (!seenPeriods.has(key)) {
        seenPeriods.add(key);
        availablePeriods.push({ m: r.periodMonth, y: r.periodYear });
      }
    }
    // Sort descending (most recent first)
    availablePeriods.sort((a, b) => (b.y !== a.y ? b.y - a.y : b.m - a.m));

    const rows = reviews.map((r) => {
      const plain = r.toJSON();
      const scores = SCORE_FIELDS.map((f) => plain[f]).filter((v) => v != null);
      const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
      return {
        id: plain.id,
        staffId: plain.staffId,
        staffName: plain.Staff ? plain.Staff.name : '—',
        positionType: plain.Staff?.StaffProfile?.positionType || '',
        submitterName: plain.Submitter ? plain.Submitter.name : '—',
        overallScore: avg != null ? Math.round(avg * 100) / 100 : null,
        scores: SCORE_FIELDS.reduce((acc, f) => { acc[f] = plain[f]; return acc; }, {}),
        comment: plain.comment || '',
      };
    });

    // Sort by score descending
    rows.sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));

    const avgAll = rows.filter(r => r.overallScore != null);
    const periodAvg = avgAll.length
      ? Math.round((avgAll.reduce((s, r) => s + r.overallScore, 0) / avgAll.length) * 100) / 100
      : null;

    // Build prev/next month links
    let prevMonth = month - 1, prevYear = year;
    if (prevMonth < 1) { prevMonth = 12; prevYear--; }
    let nextMonth = month + 1, nextYear = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear++; }

    res.render('reviews/calibration', {
      rows,
      month,
      year,
      periodAvg,
      prevMonth, prevYear,
      nextMonth, nextYear,
      availablePeriods,
      scoreFields: SCORE_FIELDS,
      currentUserRole: viewer.role,
    });
  }
);

export default router;
