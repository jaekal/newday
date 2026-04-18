// src/routes/exports.js
import express from 'express';
import { Op } from 'sequelize';
import { MonthlyReview, Goal, User, StaffProfile, RosterEntry } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';
import { RATING_FIELDS } from '../constants/ratings.js';
import { createAuditLog } from '../utils/auditLogger.js';

async function getExportActor(req) {
  const id = req.session?.userId;
  if (!id) return null;
  return User.findByPk(id, { attributes: ['id', 'username', 'email', 'role'] });
}

const router = express.Router();

// Allow MANAGER / SUPERVISOR (and ADMIN, since they often need exports too)
router.use(ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']));

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function computeTenureLabel(startDate) {
  if (!startDate) return '';
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  if (diffMs <= 0) return '0 months';

  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const diffYears = diffDays / 365;

  if (diffYears >= 1) {
    const yearsRounded = Math.round(diffYears * 10) / 10;
    return `${yearsRounded} years`;
  }

  const months = Math.round((diffDays / 30) * 10) / 10;
  return `${months} months`;
}

// Landing page
router.get('/', (req, res) => {
  const now = new Date();
  res.render('exports/index', {
    defaultMonth: now.getMonth() + 1,
    defaultYear: now.getFullYear(),
  });
});

// REVIEWS CSV
router.get('/reviews.csv', async (req, res) => {
  const { month, year } = req.query;

  const where = {};
  if (month) {
    const m = Number(month);
    if (!Number.isNaN(m)) where.periodMonth = m;
  }
  if (year) {
    const y = Number(year);
    if (!Number.isNaN(y)) where.periodYear = y;
  }

  const reviews = await MonthlyReview.findAll({
    where,
    include: [{ model: User, as: 'Staff' }, { model: User, as: 'Submitter' }],
    order: [['createdAt', 'ASC']],
  });

  const header = [
    'id',
    'staffName',
    'submitterName',
    'periodYear',
    'periodMonth',
    ...RATING_FIELDS,
    'comment',
    'createdAt',
  ];

  const lines = [header.join(',')];

  for (const r of reviews) {
    const row = [
      r.id,
      r.Staff ? r.Staff.name : '',
      r.Submitter ? r.Submitter.name : '',
      r.periodYear,
      r.periodMonth,
      ...RATING_FIELDS.map((f) => r[f]),
      r.comment,
      r.createdAt ? r.createdAt.toISOString() : '',
    ].map(csvEscape);

    lines.push(row.join(','));
  }

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'REVIEW',
    summary: `Reviews exported as CSV (${reviews.length} records)`,
    details: { format: 'csv', month: month || 'all', year: year || 'all', count: reviews.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="reviews.csv"');
  res.send(lines.join('\n'));
});

// REVIEWS JSON
router.get('/reviews.json', async (req, res) => {
  const { month, year } = req.query;

  const where = {};
  if (month) {
    const m = Number(month);
    if (!Number.isNaN(m)) where.periodMonth = m;
  }
  if (year) {
    const y = Number(year);
    if (!Number.isNaN(y)) where.periodYear = y;
  }

  const reviews = await MonthlyReview.findAll({
    where,
    include: [{ model: User, as: 'Staff' }, { model: User, as: 'Submitter' }],
    order: [['createdAt', 'ASC']],
  });

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'REVIEW',
    summary: `Reviews exported as JSON (${reviews.length} records)`,
    details: { format: 'json', month: month || 'all', year: year || 'all', count: reviews.length },
  });

  res.setHeader('Content-Disposition', 'attachment; filename="reviews.json"');
  res.json(reviews.map((r) => r.get({ plain: true })));
});

// GOALS CSV
router.get('/goals.csv', async (req, res) => {
  const goals = await Goal.findAll({
    include: [{ model: User, as: 'Owner' }],
    order: [['createdAt', 'ASC']],
  });

  const header = ['id', 'title', 'ownerName', 'status', 'progress', 'dueDate', 'createdAt'];
  const lines = [header.join(',')];

  for (const g of goals) {
    const row = [
      g.id,
      g.title,
      g.Owner ? g.Owner.name : '',
      g.status,
      g.progress,
      g.dueDate || '',
      g.createdAt ? g.createdAt.toISOString() : '',
    ].map(csvEscape);

    lines.push(row.join(','));
  }

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'GOAL',
    summary: `Goals exported as CSV (${goals.length} records)`,
    details: { format: 'csv', count: goals.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="goals.csv"');
  res.send(lines.join('\n'));
});

// GOALS JSON
router.get('/goals.json', async (req, res) => {
  const goals = await Goal.findAll({
    include: [{ model: User, as: 'Owner' }],
    order: [['createdAt', 'ASC']],
  });

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'GOAL',
    summary: `Goals exported as JSON (${goals.length} records)`,
    details: { format: 'json', count: goals.length },
  });

  res.setHeader('Content-Disposition', 'attachment; filename="goals.json"');
  res.json(goals.map((g) => g.get({ plain: true })));
});

// USERS + STAFF CSV (Expanded + real roster join query)
router.get('/users-staff.csv', async (req, res) => {
  const users = await User.findAll({
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const usernames = users.map((u) => (u.username || '').toLowerCase()).filter(Boolean);
  const emails = users.map((u) => (u.email || '').toLowerCase()).filter(Boolean);

  const rosterRows = await RosterEntry.findAll({
    where: {
      [Op.or]: [
        usernames.length ? { domainUsername: { [Op.in]: usernames } } : null,
        emails.length ? { email: { [Op.in]: emails } } : null,
      ].filter(Boolean),
    },
    limit: 10000,
  });

  const rosterByUsername = new Map();
  const rosterByEmail = new Map();
  for (const r of rosterRows) {
    if (r.domainUsername) rosterByUsername.set(String(r.domainUsername).toLowerCase(), r);
    if (r.email) rosterByEmail.set(String(r.email).toLowerCase(), r);
  }

  const header = [
    'userId',
    'name',
    'username',
    'email',
    'role',
    'phone',
    'avatarPath',
    'userCreatedAt',
    'userUpdatedAt',
    'employeeId',
    'positionType',
    'startDate',
    'tenureLabel',
    'dateOfBirth',
    'building',
    'shift',
    'carMake',
    'carModel',
    'licensePlate',
    'domainName',
    'domainUsername',
    'aboutMe',
    'keyStrengths',
    'developmentFocus',
    'technicalSkills',
    'softSkills',
    'highestEducationLevel',
    'schoolName',
    'degreeName',
    'fieldOfStudy',
    'graduationYear',
    'certificationsText',
    'rosterFullName',
    'rosterEmail',
    'rosterBuilding',
    'rosterShift',
    'rosterNotes',
  ];

  const lines = [header.join(',')];

  for (const u of users) {
    const p = u.StaffProfile || {};
    const tenure = p.startDate ? computeTenureLabel(p.startDate) : '';

    const roster =
      rosterByUsername.get(String((p.domainUsername || u.username || '')).toLowerCase()) ||
      rosterByEmail.get(String((u.email || '')).toLowerCase()) ||
      null;

    const row = [
      u.id,
      u.name,
      u.username,
      u.email,
      u.role,
      u.phone || '',
      u.avatarPath || '',
      u.createdAt ? u.createdAt.toISOString() : '',
      u.updatedAt ? u.updatedAt.toISOString() : '',
      p.employeeId || '',
      p.positionType || '',
      p.startDate || '',
      tenure,
      p.dateOfBirth || '',
      p.building ?? '',
      p.shift ?? '',
      p.carMake || '',
      p.carModel || '',
      p.licensePlate || '',
      p.domainName || '',
      p.domainUsername || '',
      p.aboutMe || '',
      p.keyStrengths || '',
      p.developmentFocus || '',
      p.technicalSkills || '',
      p.softSkills || '',
      p.highestEducationLevel || '',
      p.schoolName || '',
      p.degreeName || '',
      p.fieldOfStudy || '',
      p.graduationYear || '',
      p.certificationsText || '',
      roster ? (roster.fullName || '') : '',
      roster ? (roster.email || '') : '',
      roster ? (roster.building || '') : '',
      roster ? (roster.shift || '') : '',
      roster ? (roster.notes || '') : '',
    ].map(csvEscape);

    lines.push(row.join(','));
  }

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'USER',
    summary: `Users/Staff exported as CSV (${users.length} records)`,
    details: { format: 'csv', count: users.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="users_staff_export.csv"');
  res.send(lines.join('\n'));
});

// USERS + STAFF JSON
router.get('/users-staff.json', async (req, res) => {
  const users = await User.findAll({
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const usernames = users.map((u) => (u.username || '').toLowerCase()).filter(Boolean);
  const emails = users.map((u) => (u.email || '').toLowerCase()).filter(Boolean);

  const rosterRows = await RosterEntry.findAll({
    where: {
      [Op.or]: [
        usernames.length ? { domainUsername: { [Op.in]: usernames } } : null,
        emails.length ? { email: { [Op.in]: emails } } : null,
      ].filter(Boolean),
    },
    limit: 10000,
  });

  const rosterByUsername = new Map();
  const rosterByEmail = new Map();
  for (const r of rosterRows) {
    if (r.domainUsername) rosterByUsername.set(String(r.domainUsername).toLowerCase(), r);
    if (r.email) rosterByEmail.set(String(r.email).toLowerCase(), r);
  }

  const payload = users.map((u) => {
    const p = u.StaffProfile || {};
    const tenure = p.startDate ? computeTenureLabel(p.startDate) : '';

    const roster =
      rosterByUsername.get(String((p.domainUsername || u.username || '')).toLowerCase()) ||
      rosterByEmail.get(String((u.email || '')).toLowerCase()) ||
      null;

    return {
      user: {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        phone: u.phone || null,
        avatarPath: u.avatarPath || null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      },
      staffProfile: {
        employeeId: p.employeeId || null,
        positionType: p.positionType || null,
        startDate: p.startDate || null,
        dateOfBirth: p.dateOfBirth || null,
        building: p.building || null,
        shift: p.shift || null,
        carMake: p.carMake || null,
        carModel: p.carModel || null,
        licensePlate: p.licensePlate || null,
        domainName: p.domainName || null,
        domainUsername: p.domainUsername || null,
        aboutMe: p.aboutMe || null,
        keyStrengths: p.keyStrengths || null,
        developmentFocus: p.developmentFocus || null,
        technicalSkills: p.technicalSkills || null,
        softSkills: p.softSkills || null,
        highestEducationLevel: p.highestEducationLevel || null,
        schoolName: p.schoolName || null,
        degreeName: p.degreeName || null,
        fieldOfStudy: p.fieldOfStudy || null,
        graduationYear: p.graduationYear || null,
        certificationsText: p.certificationsText || null,
        tenureLabel: tenure || null,
      },
      rosterEntry: roster
        ? {
            domainUsername: roster.domainUsername || null,
            employeeId: roster.employeeId || null,
            fullName: roster.fullName || null,
            email: roster.email || null,
            building: roster.building || null,
            shift: roster.shift || null,
            notes: roster.notes || null,
          }
        : null,
    };
  });

  const actor = await getExportActor(req);
  await createAuditLog({
    req, actorUser: actor, actionType: 'EXPORT', entityType: 'USER',
    summary: `Users/Staff exported as JSON (${users.length} records)`,
    details: { format: 'json', count: users.length },
  });

  res.setHeader('Content-Disposition', 'attachment; filename="users_staff_export.json"');
  res.json(payload);
});

export default router;
