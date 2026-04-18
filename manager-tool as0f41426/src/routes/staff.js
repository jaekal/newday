// src/routes/staff.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ensureRole } from '../middleware/auth.js';

import {
  CANON_HEADERS,
  createMemoryUpload,
  createDocUpload,
} from '../services/staff/staffShared.js';

import {
  getViewer,
  parsePagination,
  buildRosterMap,
  scopeStaffByRosterBuildingShift,
  computeFilterOptionsFromStaff,
  computeTenureLabel,
  getEffectiveRosterBuildingShift,
  staffVisibilityWhere,
  canViewerAccessStaff,
} from '../services/staff/staffAccessService.js';

import {
  buildStaffProfileViewModel,
} from '../services/staff/staffProfileService.js';

import { buildComplianceSummary } from '../services/staff/staffProfileComplianceService.js';

import {
  updateStaffProfileById,
  uploadResumeForStaff,
} from '../services/staff/staffMutationService.js';

import {
  importSkuExposureFile,
  importStaffFile,
} from '../services/staff/staffImportService.js';

import {
  User,
  StaffProfile,
  RosterEntry,
  TrainingAssignment,
} from '../models/index.js';

const router = express.Router();

const upload = createMemoryUpload(2);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docsDir = path.join(process.cwd(), 'uploads', 'staff_docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const uploadDoc = createDocUpload(docsDir);

function normalizeTrendValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();

  if (['EXCEEDING', 'EXCEEDS', 'EXCEEDS EXPECTATIONS', 'HIGH', 'STRONG', 'ON TRACK', 'POSITIVE', 'IMPROVING'].includes(upper)) {
    return { label: raw, tone: 'good', rank: 3 };
  }

  if (['STEADY', 'STABLE', 'MEETING', 'MEETS', 'MEETS EXPECTATIONS', 'CONSISTENT', 'SATISFACTORY'].includes(upper)) {
    return { label: raw, tone: 'warn', rank: 2 };
  }

  if (['DECLINING', 'BELOW', 'BELOW EXPECTATIONS', 'AT RISK', 'NEEDS IMPROVEMENT', 'IMPROVEMENT NEEDED', 'NEGATIVE'].includes(upper)) {
    return { label: raw, tone: 'bad', rank: 1 };
  }

  return { label: raw, tone: 'neutral', rank: 0 };
}

function resolveOverallTrend(profile) {
  if (!profile) {
    return { label: 'Not Rated', tone: 'neutral', rank: 0 };
  }

  const candidate =
    profile.overallTrend ||
    profile.performanceTrend ||
    profile.trend ||
    null;

  const normalized = normalizeTrendValue(candidate);
  if (normalized) return normalized;

  return { label: 'Not Rated', tone: 'neutral', rank: 0 };
}

/* ─────────────────────────────────────────────────────────────
 * GET /staff
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const role = viewer.role || 'STAFF';
    const {
      q = '',
      rosterBuilding = '',
      rosterShift = '',
      positionType = '',
      sortBy,
      sortDir,
    } = req.query;

    const { page, pageSize, showAll } = parsePagination(req.query);

    const baseStaff = await User.findAll({
      where: staffVisibilityWhere(viewer),
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
      order: [['name', 'ASC']],
    });

    const rosterRows = await RosterEntry.findAll();
    const rosterMap = buildRosterMap(rosterRows);

    const scopedStaff = scopeStaffByRosterBuildingShift(baseStaff, viewer, rosterMap);

    scopedStaff.forEach((s) => {
      const profile = s.StaffProfile;

      s.tenureLabel = profile?.startDate ? computeTenureLabel(profile.startDate) : null;

      const eff = getEffectiveRosterBuildingShift(s, rosterMap);
      s.rosterBuilding = eff.rosterBuilding || '';
      s.rosterShift = eff.rosterShift || '';

      s.profileLastUpdated = profile?.updatedAt || s.updatedAt || null;

      const trend = resolveOverallTrend(profile);
      s.overallTrendLabel = trend.label;
      s.overallTrendTone = trend.tone;
      s.overallTrendRank = trend.rank;

      s.employmentStatus = String(s.employmentStatus || 'ACTIVE').toUpperCase();
      s.isInactive = ['RESIGNED', 'TERMINATED'].includes(s.employmentStatus);
    });

    const {
      rosterBuildingOptions,
      rosterShiftOptions,
      positionTypeOptions,
    } = computeFilterOptionsFromStaff(scopedStaff, rosterMap);

    let filtered = scopedStaff;
    const searchTerm = q.trim().toLowerCase();

    if (searchTerm) {
      filtered = filtered.filter((s) => {
        const p = s.StaffProfile || {};
        const fields = [
          s.name || '',
          s.username || '',
          p.employeeId || '',
          p.domainName || '',
          p.domainUsername || '',
          s.rosterBuilding || '',
          s.rosterShift || '',
          s.overallTrendLabel || '',
          s.employmentStatus || '',
        ];
        return fields.some((f) => String(f).toLowerCase().includes(searchTerm));
      });
    }

    if (rosterBuilding && rosterBuilding.trim() !== '') {
      filtered = filtered.filter((s) => (s.rosterBuilding || '') === rosterBuilding);
    }

    if (rosterShift && rosterShift.trim() !== '') {
      filtered = filtered.filter((s) => (s.rosterShift || '') === rosterShift);
    }

    if (positionType && positionType.trim() !== '') {
      filtered = filtered.filter((s) => (s.StaffProfile || {}).positionType === positionType);
    }

    const validSortColumns = [
      'name',
      'employeeId',
      'positionType',
      'rosterBuilding',
      'rosterShift',
      'lastUpdated',
      'overallTrend',
    ];

    const resolvedSortBy = validSortColumns.includes(sortBy) ? sortBy : 'name';
    const direction = sortDir && sortDir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const valueForSort = (s, column) => {
      const p = s.StaffProfile || {};
      switch (column) {
        case 'name':
          return (s.name || '').toLowerCase();
        case 'employeeId':
          return (p.employeeId || '').toLowerCase();
        case 'positionType':
          return (p.positionType || '').toLowerCase();
        case 'rosterBuilding':
          return (s.rosterBuilding || '').toLowerCase();
        case 'rosterShift':
          return (s.rosterShift || '').toLowerCase();
        case 'lastUpdated':
          return s.profileLastUpdated ? new Date(s.profileLastUpdated).getTime() : 0;
        case 'overallTrend':
          return Number.isFinite(s.overallTrendRank) ? s.overallTrendRank : 0;
        default:
          return (s.name || '').toLowerCase();
      }
    };

    filtered.sort((a, b) => {
      const va = valueForSort(a, resolvedSortBy);
      const vb = valueForSort(b, resolvedSortBy);

      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return direction === 'ASC' ? -1 : 1;
      if (va > vb) return direction === 'ASC' ? 1 : -1;
      return 0;
    });

    const totalUsers = filtered.length;
    let totalPages = 1;
    let pageToUse = page;
    let fromIndex = 0;
    let toIndex = 0;
    let pagedStaff = filtered;

    if (!showAll) {
      if (totalUsers > 0) {
        totalPages = Math.ceil(totalUsers / pageSize);
        if (pageToUse > totalPages) pageToUse = totalPages;
        if (pageToUse < 1) pageToUse = 1;

        const offset = (pageToUse - 1) * pageSize;
        pagedStaff = filtered.slice(offset, offset + pageSize);
        fromIndex = offset + 1;
        toIndex = Math.min(offset + pageSize, totalUsers);
      } else {
        totalPages = 1;
        pageToUse = 1;
      }
    } else {
      if (totalUsers > 0) {
        fromIndex = 1;
        toIndex = totalUsers;
      }
      pagedStaff = filtered;
      totalPages = 1;
      pageToUse = 1;
    }

    const filters = {
      q,
      rosterBuilding,
      rosterShift,
      positionType,
      sortBy: resolvedSortBy,
      sortDir: direction,
    };

    const pagination = {
      page: showAll ? 1 : pageToUse,
      pageSize: showAll ? 'all' : pageSize,
      showAll,
      totalUsers,
      totalPages,
      from: fromIndex,
      to: toIndex,
    };

    res.render('staff/list', {
      staff: pagedStaff,
      skuImportSummary: null,
      skuImportError: null,
      searchQuery: q,
      viewerRole: role,
      currentUserRole: role,
      filters,
      pagination,
      buildingOptions: rosterBuildingOptions,
      shiftOptions: rosterShiftOptions,
      positionTypeOptions,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/import
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    return res.render('staff/import', {
      currentUserRole: viewer.role || 'STAFF',
      viewerRole: viewer.role || 'STAFF',
      errorMessage: null,
      summaryMessage: null,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/import/template.csv
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/import/template.csv',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const header = CANON_HEADERS.join(',');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="staff_template.csv"');
    return res.send(`${header}\n`);
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/sku/import
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/sku/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    return res.render('staff/skuImport', {
      currentUserRole: viewer.role || 'STAFF',
      viewerRole: viewer.role || 'STAFF',
      errorMessage: null,
      summaryMessage: null,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/:id/attendance
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/:id(\\d+)/attendance',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const id = Number(req.params.id);
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staff = await User.findByPk(id, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!staff) return res.status(404).send('Staff not found');

    const compliance = await buildComplianceSummary({ staffId: id, profile: staff.StaffProfile });

    const from = req.query.from || null;
    const to = req.query.to || null;

    let { attendanceDailySummary, attendanceStats } = compliance;

    if (from || to) {
      attendanceDailySummary = attendanceDailySummary.filter(d => {
        if (from && d.date < from) return false;
        if (to && d.date > to) return false;
        return true;
      });
      // Recompute stats from filtered set
      attendanceStats = { totalDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, onTimeDays: 0, unpunctualDays: 0, lateDaysByBucket: 0, avgMinutesLateOnLateDays: null };
      let totalLateMinutes = 0, lateCount = 0;
      for (const d of attendanceDailySummary) {
        attendanceStats.totalDays++;
        if (d.status === 'PRESENT') attendanceStats.presentDays++;
        else if (d.status === 'ABSENT') attendanceStats.absentDays++;
        else if (d.status === 'LATE') attendanceStats.lateDays++;
        if (d.punctualityBucket === 'ON_TIME') attendanceStats.onTimeDays++;
        else if (d.punctualityBucket === 'UNPUNCTUAL') attendanceStats.unpunctualDays++;
        else if (d.punctualityBucket === 'LATE') attendanceStats.lateDaysByBucket++;
        if (d.minutesLate != null && d.minutesLate > 0) { totalLateMinutes += d.minutesLate; lateCount++; }
      }
      if (lateCount > 0) attendanceStats.avgMinutesLateOnLateDays = Math.round(totalLateMinutes / lateCount);
    }

    return res.render('staff/attendance', {
      staff,
      attendanceDailySummary,
      attendanceStats,
      filters: { from, to },
      currentUserRole: viewer.role,
      viewerRole: viewer.role,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/:id/esd
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/:id(\\d+)/esd',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const id = Number(req.params.id);
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staff = await User.findByPk(id, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!staff) return res.status(404).send('Staff not found');

    const compliance = await buildComplianceSummary({ staffId: id, profile: staff.StaffProfile });

    const from = req.query.from || null;
    const to = req.query.to || null;

    let { esdDailySummary, esdStats } = compliance;

    if (from || to) {
      esdDailySummary = esdDailySummary.filter(d => {
        if (from && d.date < from) return false;
        if (to && d.date > to) return false;
        return true;
      });
      // Recompute stats from filtered set
      esdStats = { totalDays: 0, daysWithPassBeforeShift: 0, daysWithPassAfterShift: 0, daysWithoutPass: 0 };
      for (const d of esdDailySummary) {
        esdStats.totalDays++;
        if (d.finalResult === 'PASS') {
          if (d.windowLabel && d.windowLabel.includes('before')) esdStats.daysWithPassBeforeShift++;
          else esdStats.daysWithPassAfterShift++;
        } else {
          esdStats.daysWithoutPass++;
        }
      }
    }

    return res.render('staff/esd', {
      staff,
      esdDailySummary,
      esdStats,
      filters: { from, to },
      currentUserRole: viewer.role,
      viewerRole: viewer.role,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/:id/sku/new
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/:id(\\d+)/sku/new',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const id = Number(req.params.id);
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staff = await User.findByPk(id, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!staff) return res.status(404).send('Staff not found');

    return res.render('staff/sku_new', {
      staff,
      error: null,
      form: {},
      currentUserRole: viewer.role,
      viewerRole: viewer.role,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/:id
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/:id(\\d+)',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).send('Invalid staff id');
    }

    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    try {
      const vm = await buildStaffProfileViewModel({
        staffId: id,
        viewer,
      });

      return res.render('staff/profile', vm);
    } catch (err) {
      console.error('STAFF PROFILE LOAD ERROR:', err);
      if (err.message === 'STAFF_NOT_FOUND') return res.status(404).send('Staff not found');
      if (err.message === 'STAFF_FORBIDDEN') {
        return res.status(403).send('You do not have access to this staff member.');
      }
      return res.status(500).send('Unable to load staff profile.');
    }
  }
);

/* ─────────────────────────────────────────────────────────────
 * GET /staff/:id/edit
 * ───────────────────────────────────────────────────────────── */
router.get(
  '/:id(\\d+)/edit',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    const id = Number(req.params.id);

    const staff = await User.findByPk(id, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!staff) return res.status(404).send('Staff not found');

    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const rosterRows = await RosterEntry.findAll();
    const rosterMap = buildRosterMap(rosterRows);

    if (!canViewerAccessStaff(viewer, staff, rosterMap)) {
      return res.status(403).send('You do not have access to edit this staff member.');
    }

    const eff = getEffectiveRosterBuildingShift(staff, rosterMap);
    staff.rosterBuilding = eff.rosterBuilding || '';
    staff.rosterShift = eff.rosterShift || '';

    const allScopedStaff = scopeStaffByRosterBuildingShift(
      await User.findAll({
        where: staffVisibilityWhere(viewer),
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      }),
      viewer,
      rosterMap
    );

    const {
      rosterBuildingOptions,
      rosterShiftOptions,
    } = computeFilterOptionsFromStaff(allScopedStaff, rosterMap);

    res.render('staff/edit', {
      staff,
      error: null,
      currentUserRole: viewer.role || 'STAFF',
      viewerRole: viewer.role || 'STAFF',
      buildingOptions: rosterBuildingOptions,
      shiftOptions: rosterShiftOptions,
    });
  }
);

/* ─────────────────────────────────────────────────────────────
 * POST /staff/:id/update
 * ───────────────────────────────────────────────────────────── */
router.post(
  '/:id(\\d+)/update',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      await updateStaffProfileById({ req, staffId: id });
      return res.redirect(`/staff/${id}`);
    } catch (err) {
      console.error('STAFF UPDATE ERROR:', err);

      const id = Number(req.params.id);
      const staff = await User.findByPk(id, {
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      });

      return res.status(500).render('staff/edit', {
        staff,
        error: 'Error updating staff profile. Please try again.',
        currentUserRole: req.currentUser?.role || '',
        viewerRole: req.currentUser?.role || '',
        buildingOptions: [],
        shiftOptions: [],
      });
    }
  }
);

/* ─────────────────────────────────────────────────────────────
 * POST /staff/:id/resume
 * ───────────────────────────────────────────────────────────── */
router.post(
  '/:id(\\d+)/resume',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  uploadDoc.single('resumeFile'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      await uploadResumeForStaff({ req, staffId: id });
      return res.redirect(`/staff/${id}`);
    } catch (err) {
      console.error('STAFF RESUME UPLOAD ERROR:', err);
      return res.status(500).send('Error uploading resume/document. Please try again.');
    }
  }
);

/* ─────────────────────────────────────────────────────────────
 * POST /staff/sku/import
 * ───────────────────────────────────────────────────────────── */
router.post(
  '/sku/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  upload.single('file'),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const result = await importSkuExposureFile({
      file: req.file,
      viewer,
    });

    return res.status(result.statusCode).render('staff/list', result.viewModel);
  }
);

/* ─────────────────────────────────────────────────────────────
 * POST /staff/import
 * ───────────────────────────────────────────────────────────── */
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  upload.single('file'),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const result = await importStaffFile({
      file: req.file,
      viewer,
    });

    return res.status(result.statusCode).render(result.view, result.viewModel);
  }
);

// ─────────────────────────────────────────────
// GET /staff/:id/export/pdf
// Print-optimized profile view (save as PDF via browser)
// ─────────────────────────────────────────────
router.get(
  '/:id/export/pdf',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staffId = Number(req.params.id);
    const vm = await buildStaffProfileViewModel({ staffId, viewer });
    if (!vm) return res.status(404).send('Staff not found');

    res.render('staff/profile-pdf', vm);
  }
);

// ─────────────────────────────────────────────
// GET /staff/:id/training-assignments
// ─────────────────────────────────────────────
router.get(
  '/:id/training-assignments',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staffId = Number(req.params.id);
    const staff = await User.findByPk(staffId, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!staff) return res.status(404).send('Staff not found');

    if (!canViewerAccessStaff(viewer, staff)) {
      return res.status(403).send('Access denied');
    }

    const assignments = await TrainingAssignment.findAll({
      where: { staffId },
      include: [{ model: User, as: 'AssignedBy', attributes: ['id', 'name'] }],
      order: [['dueDate', 'ASC'], ['createdAt', 'DESC']],
    });

    res.render('staff/training-assignments', {
      staff,
      assignments,
      currentUserRole: viewer.role,
    });
  }
);

// ─────────────────────────────────────────────
// POST /staff/:id/training-assignments
// ─────────────────────────────────────────────
router.post(
  '/:id/training-assignments',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staffId = Number(req.params.id);
    const { courseName, courseType, dueDate, notes } = req.body;

    if (!courseName || !String(courseName).trim()) {
      return res.status(400).send('Course name is required');
    }

    await TrainingAssignment.create({
      staffId,
      assignedById: viewer.id,
      courseName: String(courseName).trim(),
      courseType: courseType ? String(courseType).trim() : null,
      dueDate: dueDate || null,
      notes: notes ? String(notes).trim() : null,
      status: 'NOT_STARTED',
    });

    res.redirect(`/staff/${staffId}/training-assignments`);
  }
);

// ─────────────────────────────────────────────
// POST /staff/:id/training-assignments/:asgId/update
// ─────────────────────────────────────────────
router.post(
  '/:id/training-assignments/:asgId/update',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']),
  async (req, res) => {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staffId = Number(req.params.id);
    const asgId = Number(req.params.asgId);

    const assignment = await TrainingAssignment.findOne({ where: { id: asgId, staffId } });
    if (!assignment) return res.status(404).send('Assignment not found');

    const VALID_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'];
    const newStatus = req.body.status && VALID_STATUSES.includes(req.body.status)
      ? req.body.status : assignment.status;

    const completedDate = newStatus === 'COMPLETED'
      ? (req.body.completedDate || new Date().toISOString().slice(0, 10))
      : null;

    await assignment.update({
      status: newStatus,
      completedDate,
      notes: req.body.notes != null ? String(req.body.notes).trim() : assignment.notes,
    });

    res.redirect(`/staff/${staffId}/training-assignments`);
  }
);

export default router;