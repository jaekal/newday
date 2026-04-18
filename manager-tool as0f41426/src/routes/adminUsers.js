// src/routes/adminUsers.js
import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Op } from 'sequelize';

import { ensureRole } from '../middleware/auth.js';
import { User, StaffProfile, RosterEntry, ManagerScope } from '../models/index.js';
import { createAuditLog } from '../utils/auditLogger.js';

const router = express.Router();

/* ─────────────────────────────────────────────────────────────
 * Uploaders
 * ───────────────────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

const ROLES = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD', 'STAFF'];
const POSITION_TYPES = ['TECHNICIAN', 'LEAD', 'CHAMPION', 'SPECIALIST', 'SUPERVISOR', 'MANAGER'];
const EMPLOYMENT_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED'];

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────── */
function norm(v) {
  return String(v ?? '').trim();
}
function normLower(v) {
  return norm(v).toLowerCase();
}
function toNullIfBlank(v) {
  const s = norm(v);
  return s.length ? s : null;
}
function toUpper(v) {
  return norm(v).toUpperCase();
}
function uniqSorted(list) {
  return [...new Set((list || []).map(norm).filter(Boolean))].sort();
}
function normalizeMultiValue(raw) {
  if (Array.isArray(raw)) return uniqSorted(raw);
  if (!raw) return [];
  return uniqSorted([raw]);
}
function normalizeEmploymentStatus(value, fallback = 'ACTIVE') {
  const v = toUpper(value);
  return EMPLOYMENT_STATUSES.includes(v) ? v : fallback;
}
function isInactiveEmploymentStatus(value) {
  const v = normalizeEmploymentStatus(value, 'ACTIVE');
  return v === 'RESIGNED' || v === 'TERMINATED';
}
function deriveEnabledFromStatus(status, explicitValue) {
  if (String(explicitValue ?? '').trim() !== '') {
    return ['true', '1', 'yes', 'on'].includes(String(explicitValue).trim().toLowerCase());
  }
  return normalizeEmploymentStatus(status, 'ACTIVE') === 'ACTIVE';
}

function normalizeDomainUsername(value) {
  let v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  const slashIdx = v.lastIndexOf('\\');
  if (slashIdx !== -1) v = v.slice(slashIdx + 1);
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(0, atIdx);
  return v.replace(/^"+|"+$/g, '').trim();
}

function parseDateOnly(value) {
  const v = norm(value);
  if (!v) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  if (!Number.isNaN(Number(v)) && String(v).match(/^\d+(\.\d+)?$/)) {
    const n = Number(v);
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = n * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseFile(buffer, originalName) {
  const lower = (originalName || '').toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');
  if (!isExcel && !isCsv) throw new Error('Unsupported file type. Upload CSV or Excel.');

  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const text = buffer.toString('utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true });
}

function normalizeRow(raw) {
  const row = {};
  for (const k of Object.keys(raw || {})) row[String(k || '').trim()] = raw[k];
  return row;
}

function buildRosterMap(rosterRows) {
  const byDomain = new Map();
  const byEmail = new Map();
  const byEmployeeId = new Map();

  (rosterRows || []).forEach((r) => {
    const dn = normalizeDomainUsername(r.domainUsername);
    const em = normLower(r.email);
    const ei = norm(r.employeeId);

    if (dn) byDomain.set(dn, r);
    if (em) byEmail.set(em, r);
    if (ei) byEmployeeId.set(ei, r);
  });

  return { byDomain, byEmail, byEmployeeId };
}

function getRosterIdentity(userPlain, rosterMaps) {
  const prof = userPlain?.StaffProfile || null;

  const profDomain = normalizeDomainUsername(prof?.domainUsername || prof?.domainName || '');
  const userDomain = normalizeDomainUsername(userPlain?.username || '');
  const emailKey = normLower(userPlain?.email || '');
  const empKey = norm(prof?.employeeId || '');

  const r =
    (profDomain && rosterMaps.byDomain.get(profDomain)) ||
    (userDomain && rosterMaps.byDomain.get(userDomain)) ||
    (emailKey && rosterMaps.byEmail.get(emailKey)) ||
    (empKey && rosterMaps.byEmployeeId.get(empKey)) ||
    null;

  return {
    roster: r || null,
    domainDisplay:
      normalizeDomainUsername(r?.domainUsername) ||
      normalizeDomainUsername(prof?.domainUsername) ||
      normalizeDomainUsername(userPlain?.username) ||
      '',
    domainSource: r?.domainUsername ? 'Roster' : prof?.domainUsername ? 'StaffProfile' : 'User',
  };
}

function getProfilePlacement(userPlain) {
  const prof = userPlain?.StaffProfile || null;
  return {
    profileBuilding: prof?.building ? norm(prof.building) : '',
    profileShift: prof?.shift ? norm(prof.shift) : '',
  };
}

async function getCurrentUser(req) {
  const idRaw = req.session?.userId;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;

  return User.findByPk(id, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
}

async function getActor(req) {
  const idRaw = req.session?.userId;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;

  return User.findByPk(id, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });
}

function isAdmin(actorPlain) {
  return toUpper(actorPlain?.role) === 'ADMIN';
}
function isManager(actorPlain) {
  const r = toUpper(actorPlain?.role);
  return r === 'MANAGER' || r === 'SENIOR_MANAGER';
}

function getManagerShifts(actorPlain) {
  const scopes = actorPlain?.ManagerScopes || [];
  return uniqSorted(scopes.map((s) => norm(s.shift)).filter(Boolean));
}

function getManagerBuildings(actorPlain) {
  const scopes = actorPlain?.ManagerScopes || [];
  return uniqSorted(scopes.map((s) => norm(s.building)).filter(Boolean));
}

function getManagerScopePairs(actorPlain) {
  const scopes = actorPlain?.ManagerScopes || [];
  return scopes
    .map((s) => ({
      building: norm(s.building),
      shift: norm(s.shift),
    }))
    .filter((x) => x.building && x.shift);
}

async function canManagerEditUser(actorPlain, userPlain) {
  if (isAdmin(actorPlain)) return true;
  if (!isManager(actorPlain)) return false;

  const scopePairs = getManagerScopePairs(actorPlain);
  if (!scopePairs.length) return false;

  const { profileBuilding: b, profileShift: sh } = getProfilePlacement(userPlain);
  if (!b || !sh) return false;

  return scopePairs.some((s) => s.building === b && s.shift === sh);
}

async function getPlacementOptionsForActor(actorPlain, admin, manager) {
  const profileRows = await StaffProfile.findAll({
    attributes: ['building', 'shift'],
    limit: 100000,
  });

  const rosterRows = await RosterEntry.findAll({ limit: 100000 });
  const rosterBuildings = rosterRows.map((r) => r?.building).filter(Boolean);
  const rosterShifts = rosterRows.map((r) => r?.shift).filter(Boolean);

  const profileBuildings = profileRows.map((p) => p?.building).filter(Boolean);
  const profileShifts = profileRows.map((p) => p?.shift).filter(Boolean);

  // Also pull from existing manager scopes so options are always populated
  // even when StaffProfiles/RosterEntries are empty
  const scopeRows = await ManagerScope.findAll({ attributes: ['building', 'shift'], limit: 100000 });
  const scopeBuildings = scopeRows.map((s) => s?.building).filter(Boolean);
  const scopeShifts = scopeRows.map((s) => s?.shift).filter(Boolean);

  let buildingOptions = uniqSorted([...profileBuildings, ...rosterBuildings, ...scopeBuildings]);
  let shiftOptions = uniqSorted([...profileShifts, ...rosterShifts, ...scopeShifts]);

  if (manager && !admin) {
    buildingOptions = getManagerBuildings(actorPlain);
    shiftOptions = getManagerShifts(actorPlain);
  }

  return { buildingOptions, shiftOptions };
}

/* ─────────────────────────────────────────────────────────────
 * AVATAR UPLOAD (disk)
 * ───────────────────────────────────────────────────────────── */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, avatarDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
    const stamp = Date.now();
    cb(null, `avatar_${req.params.id}_${stamp}${safeExt}`);
  },
});

function avatarFileFilter(req, file, cb) {
  const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.mimetype);
  if (!ok) return cb(new Error('Unsupported image type. Use png/jpg/gif/webp.'), false);
  cb(null, true);
}

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: avatarFileFilter,
});

/* ─────────────────────────────────────────────────────────────
 * Import Template (ADMIN)
 * ───────────────────────────────────────────────────────────── */
router.get('/import/template.csv', ensureRole(['ADMIN']), async (req, res) => {
  const headers = [
    'name',
    'username',
    'email',
    'role',
    'password',
    'phone',
    'avatarPath',
    'employmentStatus',
    'isEnabled',
    'offboardedAt',
    'offboardReason',

    'employeeId',
    'positionType',
    'startDate',
    'dateOfBirth',

    'building',
    'shift',

    'domainName',
    'domainUsernameProfile',

    'carMake',
    'carModel',
    'carColor',
    'carYear',
    'licensePlate',

    'highestEducationLevel',
    'schoolName',
    'degreeName',
    'fieldOfStudy',
    'graduationYear',
    'certificationsText',

    'aboutMe',
    'keyStrengths',
    'developmentFocus',
    'technicalSkills',
    'softSkills',

    'rosterDomainUsername',
    'rosterFullName',
    'rosterEmail',
    'rosterBuilding',
    'rosterShift',
    'rosterNotes',
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="users_import_template.csv"');

  const blank = headers.map(() => '').join(',');
  res.send(`${headers.join(',')}\n${blank}\n`);
});

/* ─────────────────────────────────────────────────────────────
 * LIST USERS (ADMIN + MANAGER)
 * ───────────────────────────────────────────────────────────── */
router.get('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  const actor = await getActor(req);
  if (!actor) return res.status(401).send('Not authenticated');

  const actorPlain = actor.get({ plain: true });
  const admin = isAdmin(actorPlain);
  const manager = isManager(actorPlain);

  const importSummary = req.session?.importSummary || null;
  const importError = req.session?.importError || null;
  if (req.session) {
    req.session.importSummary = null;
    req.session.importError = null;
  }

  const q = norm(req.query.q);
  const role = toUpper(req.query.role);
  const building = norm(req.query.building);
  const shift = norm(req.query.shift);
  const status = normalizeEmploymentStatus(req.query.status, 'ACTIVE');
  const showInactive = String(req.query.showInactive || '').trim().toLowerCase() === 'true';

  const sortBy = norm(req.query.sortBy) || 'name';
  const sortDir = (norm(req.query.sortDir) || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  const pageSizeRaw = norm(req.query.pageSize || '25');
  const page = Math.max(1, Number(req.query.page || 1));
  const showAll = pageSizeRaw === 'all';
  const pageSize = showAll ? 999999 : Math.max(10, Math.min(100, Number(pageSizeRaw) || 25));

  let managerShifts = [];
  let managerBuildings = [];
  let managerScopePairs = [];

  if (manager) {
    managerShifts = getManagerShifts(actorPlain);
    managerBuildings = getManagerBuildings(actorPlain);
    managerScopePairs = getManagerScopePairs(actorPlain);

    if (!managerShifts.length || !managerBuildings.length || !managerScopePairs.length) {
      return res.render('users/list', {
        users: [],
        currentUser: (await getCurrentUser(req))?.get({ plain: true }) || null,
        roles: ROLES,
        positionTypes: POSITION_TYPES,
        employmentStatuses: EMPLOYMENT_STATUSES,
        buildingOptions: [],
        shiftOptions: [],
        filters: {
          q,
          role,
          status: 'ACTIVE',
          building: '',
          shift: '',
          sortBy,
          sortDir,
          showInactive: false,
        },
        pagination: {
          page: 1,
          pageSize: 'all',
          showAll: true,
          totalUsers: 0,
          totalPages: 1,
          from: 0,
          to: 0,
        },
        importSummary,
        importError: importError || 'No manager scope assigned. Ask an admin to assign building(s) and shift(s).',
        isAdmin: false,
        isManager: true,
        managerShift: null,
        managerShifts: [],
        managerBuildings: [],
      });
    }
  }

  const userWhere = {};
  if (role) userWhere.role = role;

  if (!showInactive) {
    userWhere.employmentStatus = status;
  }

  if (q) {
    userWhere[Op.or] = [
      { name: { [Op.like]: `%${q}%` } },
      { username: { [Op.like]: `%${q}%` } },
      { email: { [Op.like]: `%${q}%` } },
    ];
  }

  const usersRaw = await User.findAll({
    where: userWhere,
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const rosterRows = await RosterEntry.findAll({ limit: 100000 });
  const rosterMaps = buildRosterMap(rosterRows);

  let enriched = usersRaw.map((u) => {
    const plain = u.get({ plain: true });
    const ident = getRosterIdentity(plain, rosterMaps);
    const place = getProfilePlacement(plain);
    const employmentStatus = normalizeEmploymentStatus(plain.employmentStatus, 'ACTIVE');

    return {
      ...plain,
      employmentStatus,
      isInactive: isInactiveEmploymentStatus(employmentStatus),
      RosterEntry: ident.roster ? ident.roster.get?.({ plain: true }) || ident.roster : null,
      profileBuilding: place.profileBuilding || '',
      profileShift: place.profileShift || '',
      domainDisplay: ident.domainDisplay || '',
      domainSource: ident.domainSource || 'User',
    };
  });

  if (manager && !admin) {
    enriched = enriched.filter((u) => {
      const b = u.profileBuilding || '';
      const sh = u.profileShift || '';
      if (!b || !sh) return false;
      return managerScopePairs.some((s) => s.building === b && s.shift === sh);
    });
  }

  let filtered = enriched;

  if (building) filtered = filtered.filter((u) => (u.profileBuilding || '') === building);
  if (shift) filtered = filtered.filter((u) => (u.profileShift || '') === shift);

  const allowedSort = new Set([
    'name',
    'username',
    'email',
    'role',
    'employmentStatus',
    'createdAt',
    'profileBuilding',
    'profileShift',
  ]);
  const resolvedSort = allowedSort.has(sortBy) ? sortBy : 'name';

  const statusRank = (value) => {
    const v = normalizeEmploymentStatus(value, 'ACTIVE');
    if (v === 'ACTIVE') return 3;
    if (v === 'RESIGNED') return 2;
    if (v === 'TERMINATED') return 1;
    return 0;
  };

  const valForSort = (u, col) => {
    if (col === 'createdAt') return u.createdAt ? new Date(u.createdAt).getTime() : 0;
    if (col === 'employmentStatus') return statusRank(u.employmentStatus);
    return String(u[col] ?? '').toLowerCase();
  };

  filtered.sort((a, b) => {
    const va = valForSort(a, resolvedSort);
    const vb = valForSort(b, resolvedSort);
    if (va === vb) return 0;
    if (sortDir === 'DESC') return va < vb ? 1 : -1;
    return va < vb ? -1 : 1;
  });

  const totalUsers = filtered.length;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(totalUsers / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const pageRows = showAll ? filtered : filtered.slice(offset, offset + pageSize);

  const from = showAll ? (totalUsers ? 1 : 0) : Math.min(totalUsers, offset + 1);
  const to = showAll ? totalUsers : Math.min(totalUsers, offset + pageRows.length);

  const buildingOptions = uniqSorted(enriched.map((u) => u.profileBuilding).filter(Boolean));
  const shiftOptions = uniqSorted(enriched.map((u) => u.profileShift).filter(Boolean));

  const usersWithPerms = [];
  for (const u of pageRows) {
    const canEdit = admin ? true : await canManagerEditUser(actorPlain, u);
    usersWithPerms.push({ ...u, _canEdit: canEdit });
  }

  const currentUser = await getCurrentUser(req);

  return res.render('users/list', {
    users: usersWithPerms,
    currentUser: currentUser ? currentUser.get({ plain: true }) : null,
    roles: ROLES,
    employmentStatuses: EMPLOYMENT_STATUSES,
    buildingOptions: admin ? buildingOptions : managerBuildings,
    shiftOptions: admin ? shiftOptions : managerShifts,
    filters: {
      q,
      role,
      status,
      building: building || '',
      shift: shift || '',
      sortBy: resolvedSort,
      sortDir,
      showInactive,
    },
    pagination: {
      page: showAll ? 1 : safePage,
      pageSize: showAll ? 'all' : pageSize,
      showAll,
      totalUsers,
      totalPages,
      from,
      to,
    },
    importSummary,
    importError,
    isAdmin: admin,
    isManager: manager && !admin,
    managerShift: managerShifts[0] || null,
    managerShifts,
    managerBuildings,
  });
});

/* ─────────────────────────────────────────────────────────────
 * NEW USER (ADMIN)
 * ───────────────────────────────────────────────────────────── */
router.get('/new', ensureRole(['ADMIN']), async (req, res) => {
  const actor = await getActor(req);
  const actorPlain = actor ? actor.get({ plain: true }) : null;
  const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(actorPlain, true, false);

  res.render('users/new', {
    roles: ROLES,
    positionTypes: POSITION_TYPES,
    employmentStatuses: EMPLOYMENT_STATUSES,
    buildingOptions,
    shiftOptions,
    error: null,
  });
});

/* ─────────────────────────────────────────────────────────────
 * CREATE USER (ADMIN)
 * ───────────────────────────────────────────────────────────── */
router.post('/', ensureRole(['ADMIN']), async (req, res) => {
  try {
    const name = norm(req.body.name);
    const username = normLower(req.body.username);
    const email = normLower(req.body.email);
    const role = toUpper(req.body.role);
    const phone = norm(req.body.phone);
    const password = norm(req.body.password);

    if (!name || !username || !email || !role || !password) {
      throw new Error('Missing required fields (name, username, email, role, password).');
    }
    if (!ROLES.includes(role)) throw new Error('Invalid role.');

    const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(null, true, false);
    const buildingCandidate = toNullIfBlank(req.body.building);
    const shiftCandidate = toNullIfBlank(req.body.shift);

    if (buildingCandidate && buildingOptions.length && !buildingOptions.includes(buildingCandidate)) {
      throw new Error(`Invalid building "${buildingCandidate}". Must match dropdown options.`);
    }
    if (shiftCandidate && shiftOptions.length && !shiftOptions.includes(shiftCandidate)) {
      throw new Error(`Invalid shift "${shiftCandidate}". Must match dropdown options.`);
    }

    const employmentStatus = normalizeEmploymentStatus(req.body.employmentStatus, 'ACTIVE');
    const isEnabled = deriveEnabledFromStatus(employmentStatus, req.body.isEnabled);
    const offboardedAt = parseDateOnly(req.body.offboardedAt);
    const offboardReason = toNullIfBlank(req.body.offboardReason);

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      username,
      email,
      role,
      phone: phone || null,
      passwordHash,
      avatarPath: toNullIfBlank(req.body.avatarPath),
      employmentStatus,
      isEnabled,
      offboardedAt: employmentStatus === 'ACTIVE' ? null : offboardedAt,
      offboardReason: employmentStatus === 'ACTIVE' ? null : offboardReason,
    });

    const profilePayload = {
      userId: user.id,
      employeeId: toNullIfBlank(req.body.employeeId),
      positionType: toNullIfBlank(req.body.positionType) || 'TECHNICIAN',
      startDate: parseDateOnly(req.body.startDate),
      dateOfBirth: parseDateOnly(req.body.dateOfBirth),
      building: buildingCandidate,
      shift: shiftCandidate,
      domainName: toNullIfBlank(req.body.domainName),
      domainUsername: toNullIfBlank(req.body.domainUsernameProfile),

      carMake: toNullIfBlank(req.body.carMake),
      carModel: toNullIfBlank(req.body.carModel),
      carColor: toNullIfBlank(req.body.carColor),
      carYear: toNullIfBlank(req.body.carYear),
      licensePlate: toNullIfBlank(req.body.licensePlate),

      highestEducationLevel: toNullIfBlank(req.body.highestEducationLevel),
      schoolName: toNullIfBlank(req.body.schoolName),
      degreeName: toNullIfBlank(req.body.degreeName),
      fieldOfStudy: toNullIfBlank(req.body.fieldOfStudy),
      graduationYear: toNullIfBlank(req.body.graduationYear),
      certificationsText: toNullIfBlank(req.body.certificationsText),

      aboutMe: toNullIfBlank(req.body.aboutMe),
      keyStrengths: toNullIfBlank(req.body.keyStrengths),
      developmentFocus: toNullIfBlank(req.body.developmentFocus),
      technicalSkills: toNullIfBlank(req.body.technicalSkills),
      softSkills: toNullIfBlank(req.body.softSkills),
    };

    await StaffProfile.create(profilePayload);

    const dn = normalizeDomainUsername(req.body.rosterDomainUsername || req.body.domainUsernameProfile || username);
    if (dn) {
      const existing = await RosterEntry.findOne({ where: { domainUsername: dn } });
      const rosterPayload = {
        domainUsername: dn,
        employeeId: profilePayload.employeeId || null,
        fullName: toNullIfBlank(req.body.rosterFullName) || name || null,
        email: normLower(req.body.rosterEmail || email) || null,
        building: toNullIfBlank(req.body.rosterBuilding) || null,
        shift: toNullIfBlank(req.body.rosterShift) || null,
        notes: toNullIfBlank(req.body.rosterNotes),
      };

      if (!existing) await RosterEntry.create(rosterPayload);
      else {
        await existing.update({
          employeeId: rosterPayload.employeeId || existing.employeeId,
          fullName: rosterPayload.fullName || existing.fullName,
          email: rosterPayload.email || existing.email,
          building: rosterPayload.building || existing.building,
          shift: rosterPayload.shift || existing.shift,
          notes: rosterPayload.notes ?? existing.notes,
        });
      }
    }

    const actor = await User.findByPk(req.session?.userId, { attributes: ['id', 'username', 'email', 'role'] });
    await createAuditLog({
      req,
      actorUser: actor,
      actionType: 'CREATE',
      entityType: 'USER',
      entityId: user.id,
      targetName: user.username,
      summary: `User created: ${user.name} (${user.username}) — role: ${user.role}`,
      details: { name: user.name, username: user.username, email: user.email, role: user.role, employmentStatus: user.employmentStatus },
    });

    return res.redirect('/admin/users');
  } catch (e) {
    const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(null, true, false);

    return res.status(400).render('users/new', {
      roles: ROLES,
      positionTypes: POSITION_TYPES,
      employmentStatuses: EMPLOYMENT_STATUSES,
      buildingOptions,
      shiftOptions,
      error: e.message,
    });
  }
});

/* ─────────────────────────────────────────────────────────────
 * EDIT USER FORM
 * ───────────────────────────────────────────────────────────── */
router.get('/:id/edit', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  const actor = await getActor(req);
  if (!actor) return res.status(401).send('Not authenticated');

  const actorPlain = actor.get({ plain: true });
  const admin = isAdmin(actorPlain);
  const manager = isManager(actorPlain);

  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Invalid user id');

  const user = await User.findByPk(id, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
  if (!user) return res.status(404).send('User not found');

  const rosterRows = await RosterEntry.findAll({ limit: 100000 });
  const rosterMaps = buildRosterMap(rosterRows);

  const userPlain = user.get({ plain: true });

  if (!admin) {
    const ok = await canManagerEditUser(actorPlain, userPlain);
    if (!ok) return res.status(403).send('Not authorized to edit this user.');
  }

  const ident = getRosterIdentity(userPlain, rosterMaps);
  const roster = ident.roster ? (ident.roster.get?.({ plain: true }) || ident.roster) : null;

  const targetScopes = await ManagerScope.findAll({ where: { userId: id } });
  const targetShifts = uniqSorted(targetScopes.map((s) => norm(s.shift)).filter(Boolean));
  const targetBuildings = uniqSorted(targetScopes.map((s) => norm(s.building)).filter(Boolean));

  const currentUser = await getCurrentUser(req);
  const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(actorPlain, admin, manager);

  return res.render('users/edit', {
    user: userPlain,
    profile: userPlain.StaffProfile || null,
    roster,
    currentUser: currentUser ? currentUser.get({ plain: true }) : null,

    roles: ROLES,
    positionTypes: POSITION_TYPES,
    employmentStatuses: EMPLOYMENT_STATUSES,
    buildingOptions,
    shiftOptions,

    isAdmin: admin,
    isManager: manager && !admin,
    viewerManagerShift: manager ? getManagerShifts(actorPlain)[0] || null : null,
    viewerManagerShifts: manager ? getManagerShifts(actorPlain) : [],
    viewerManagerBuildings: manager ? getManagerBuildings(actorPlain) : [],

    targetManagerShift: targetShifts[0] || '',
    targetManagerShifts: targetShifts,
    targetManagerBuildings: targetBuildings,

    error: null,
  });
});

/* ─────────────────────────────────────────────────────────────
 * ADMIN: SET MANAGER SCOPE
 * ───────────────────────────────────────────────────────────── */
router.post('/:id/manager-scope', ensureRole(['ADMIN']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid user id.');

    const managerShifts = normalizeMultiValue(req.body.managerShifts || req.body.managerShift);
    const managerBuildings = normalizeMultiValue(req.body.managerBuildings);

    if (!managerShifts.length) throw new Error('Select at least one shift.');
    if (!managerBuildings.length) throw new Error('Select at least one building.');

    const rows = [];
    for (const shift of managerShifts) {
      for (const building of managerBuildings) {
        rows.push({ userId: id, building, shift });
      }
    }

    await ManagerScope.destroy({ where: { userId: id } });
    await ManagerScope.bulkCreate(rows);

    return res.redirect(`/admin/users/${id}/edit`);
  } catch (e) {
    return res.status(400).send(`Failed to save manager scope: ${e.message}`);
  }
});

/* ─────────────────────────────────────────────────────────────
 * UPDATE USER + PROFILE + ROSTER
 * ───────────────────────────────────────────────────────────── */
router.post('/:id/update', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  const actor = await getActor(req);
  if (!actor) return res.status(401).send('Not authenticated');

  const actorPlain = actor.get({ plain: true });
  const admin = isAdmin(actorPlain);
  const manager = isManager(actorPlain);

  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).send('Invalid user id');

  try {
    const user = await User.findByPk(id, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
    if (!user) return res.status(404).send('User not found');

    const userPlain = user.get({ plain: true });

    if (!admin) {
      const ok = await canManagerEditUser(actorPlain, userPlain);
      if (!ok) return res.status(403).send('Not authorized to update this user.');
    }

    const name = norm(req.body.name);
    const username = normLower(req.body.username);
    const email = normLower(req.body.email);
    const role = toUpper(req.body.role);
    const phone = norm(req.body.phone);

    if (!name || !email) throw new Error('Missing required fields (name, email).');

    if (manager && !admin) {
      await user.update({ name, email, phone: phone || null });
    } else {
      if (!username || !role) throw new Error('Missing required fields (username, role).');
      if (!ROLES.includes(role)) throw new Error('Invalid role.');

      const employmentStatus = normalizeEmploymentStatus(
        req.body.employmentStatus,
        user.employmentStatus || 'ACTIVE'
      );
      const isEnabled = deriveEnabledFromStatus(employmentStatus, req.body.isEnabled);
      const offboardedAt = parseDateOnly(req.body.offboardedAt);
      const offboardReason = toNullIfBlank(req.body.offboardReason);

      await user.update({
        name,
        username,
        email,
        role,
        phone: phone || null,
        employmentStatus,
        isEnabled,
        offboardedAt: employmentStatus === 'ACTIVE' ? null : offboardedAt,
        offboardReason: employmentStatus === 'ACTIVE' ? null : offboardReason,
      });
    }

    const buildingCandidate = toNullIfBlank(req.body.building);
    const shiftCandidate = toNullIfBlank(req.body.shift);

    if (admin) {
      const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(actorPlain, admin, manager);

      if (buildingCandidate && buildingOptions.length && !buildingOptions.includes(buildingCandidate)) {
        throw new Error(`Invalid building "${buildingCandidate}". Must match dropdown options.`);
      }
      if (shiftCandidate && shiftOptions.length && !shiftOptions.includes(shiftCandidate)) {
        throw new Error(`Invalid shift "${shiftCandidate}". Must match dropdown options.`);
      }
    }

    const profilePayload = {
      employeeId: toNullIfBlank(req.body.employeeId),
      positionType: toNullIfBlank(req.body.positionType) || (user.StaffProfile?.positionType ?? 'TECHNICIAN'),
      startDate: parseDateOnly(req.body.startDate),
      dateOfBirth: parseDateOnly(req.body.dateOfBirth),

      building: buildingCandidate,
      shift: shiftCandidate,

      domainName: toNullIfBlank(req.body.domainName),
      domainUsername: toNullIfBlank(req.body.domainUsernameProfile),

      carMake: toNullIfBlank(req.body.carMake),
      carModel: toNullIfBlank(req.body.carModel),
      carColor: toNullIfBlank(req.body.carColor),
      carYear: toNullIfBlank(req.body.carYear),
      licensePlate: toNullIfBlank(req.body.licensePlate),

      highestEducationLevel: toNullIfBlank(req.body.highestEducationLevel),
      schoolName: toNullIfBlank(req.body.schoolName),
      degreeName: toNullIfBlank(req.body.degreeName),
      fieldOfStudy: toNullIfBlank(req.body.fieldOfStudy),
      graduationYear: toNullIfBlank(req.body.graduationYear),
      certificationsText: toNullIfBlank(req.body.certificationsText),

      aboutMe: toNullIfBlank(req.body.aboutMe),
      keyStrengths: toNullIfBlank(req.body.keyStrengths),
      developmentFocus: toNullIfBlank(req.body.developmentFocus),
      technicalSkills: toNullIfBlank(req.body.technicalSkills),
      softSkills: toNullIfBlank(req.body.softSkills),
    };

    if (manager && !admin) {
      const allowedBuildings = new Set(getManagerBuildings(actorPlain));
      const allowedShifts = new Set(getManagerShifts(actorPlain));

      if (profilePayload.building && !allowedBuildings.has(profilePayload.building)) {
        throw new Error('Managers can only assign buildings within their scope.');
      }
      if (profilePayload.shift && !allowedShifts.has(profilePayload.shift)) {
        throw new Error('Managers can only assign shifts within their scope.');
      }

      profilePayload.domainName = user.StaffProfile?.domainName || null;
      profilePayload.domainUsername = user.StaffProfile?.domainUsername || null;
    }

    let profile = user.StaffProfile;
    if (!profile) profile = await StaffProfile.create({ userId: user.id, ...profilePayload });
    else await profile.update(profilePayload);

    if (admin) {
      const newPassword = norm(req.body.newPassword);
      if (newPassword) {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await user.update({ passwordHash });
      }
    }

    if (admin) {
      const rosterDomainUsername = normalizeDomainUsername(
        req.body.rosterDomainUsername || req.body.domainUsernameProfile || user.username
      );

      if (rosterDomainUsername) {
        const existingRoster = await RosterEntry.findOne({
          where: {
            [Op.or]: [
              { domainUsername: rosterDomainUsername },
              { domainUsername: normalizeDomainUsername(user.username) },
              { domainUsername: normalizeDomainUsername(profilePayload.domainUsername) },
              { email: normLower(user.email) },
              ...(profile?.employeeId ? [{ employeeId: profile.employeeId }] : []),
            ].filter(Boolean),
          },
        });

        const rosterPayload = {
          domainUsername: rosterDomainUsername,
          employeeId: profilePayload.employeeId || null,
          fullName: toNullIfBlank(req.body.rosterFullName) || name || null,
          email: normLower(req.body.rosterEmail || email) || null,
          building: toNullIfBlank(req.body.rosterBuilding) || null,
          shift: toNullIfBlank(req.body.rosterShift) || null,
          notes: toNullIfBlank(req.body.rosterNotes),
        };

        if (existingRoster) {
          if (existingRoster.domainUsername !== rosterPayload.domainUsername && rosterPayload.domainUsername) {
            const clash = await RosterEntry.findOne({ where: { domainUsername: rosterPayload.domainUsername } });
            if (clash && clash.id !== existingRoster.id) {
              throw new Error(
                `Roster domainUsername "${rosterPayload.domainUsername}" is already used by another roster entry.`
              );
            }
          }

          await existingRoster.update({
            domainUsername: rosterPayload.domainUsername,
            employeeId: rosterPayload.employeeId || existingRoster.employeeId,
            fullName: rosterPayload.fullName || existingRoster.fullName,
            email: rosterPayload.email || existingRoster.email,
            building: rosterPayload.building || existingRoster.building,
            shift: rosterPayload.shift || existingRoster.shift,
            notes: rosterPayload.notes ?? existingRoster.notes,
          });
        } else {
          await RosterEntry.create(rosterPayload);
        }
      }
    }

    await createAuditLog({
      req,
      actorUser: actorPlain,
      actionType: 'UPDATE',
      entityType: 'USER',
      entityId: id,
      targetName: user.username || user.name,
      summary: `User updated: ${user.name} (${user.username})`,
      details: { name: user.name, username: user.username, role: user.role, employmentStatus: user.employmentStatus },
    });

    return res.redirect(`/admin/users/${user.id}/edit`);
  } catch (e) {
    const user = await User.findByPk(id, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
    const actorPlainLatest = actor.get({ plain: true });
    const adminLatest = isAdmin(actorPlainLatest);
    const managerLatest = isManager(actorPlainLatest);

    const { buildingOptions, shiftOptions } = await getPlacementOptionsForActor(
      actorPlainLatest,
      adminLatest,
      managerLatest
    );

    return res.status(400).render('users/edit', {
      user: user ? user.get({ plain: true }) : null,
      profile: user?.StaffProfile ? user.StaffProfile.get({ plain: true }) : null,
      roster: null,
      currentUser: (await getCurrentUser(req))?.get({ plain: true }) || null,

      roles: ROLES,
      positionTypes: POSITION_TYPES,
      employmentStatuses: EMPLOYMENT_STATUSES,
      buildingOptions,
      shiftOptions,

      isAdmin: adminLatest,
      isManager: managerLatest && !adminLatest,
      viewerManagerShift: managerLatest ? getManagerShifts(actorPlainLatest)[0] || null : null,
      viewerManagerShifts: managerLatest ? getManagerShifts(actorPlainLatest) : [],
      viewerManagerBuildings: managerLatest ? getManagerBuildings(actorPlainLatest) : [],

      targetManagerShift: '',
      targetManagerShifts: [],
      targetManagerBuildings: [],

      error: e.message,
    });
  }
});

/* ─────────────────────────────────────────────────────────────
 * DELETE USER (ADMIN)
 * ───────────────────────────────────────────────────────────── */
router.post('/:id/delete', ensureRole(['ADMIN']), async (req, res) => {
  const id = Number(req.params.id);

  if (req.session?.userId && Number(req.session.userId) === id) {
    return res.status(400).send('You cannot delete your own account.');
  }

  const user = await User.findByPk(id);
  if (!user) return res.redirect('/admin/users');

  const actor = await User.findByPk(req.session?.userId, { attributes: ['id', 'username', 'email', 'role'] });
  const deletedName = user.name;
  const deletedUsername = user.username;

  await StaffProfile.destroy({ where: { userId: id } });
  await ManagerScope.destroy({ where: { userId: id } });
  await user.destroy();

  await createAuditLog({
    req,
    actorUser: actor,
    actionType: 'DELETE',
    entityType: 'USER',
    entityId: id,
    targetName: deletedUsername,
    summary: `User deleted: ${deletedName} (${deletedUsername})`,
  });

  return res.redirect('/admin/users');
});

/* ─────────────────────────────────────────────────────────────
 * AVATAR UPDATE
 * ───────────────────────────────────────────────────────────── */
router.post('/:id/avatar', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), uploadAvatar.single('avatar'), async (req, res) => {
  try {
    const actor = await getActor(req);
    if (!actor) return res.status(401).send('Not authenticated');

    const actorPlain = actor.get({ plain: true });
    const admin = isAdmin(actorPlain);

    const id = Number(req.params.id);

    const target = await User.findByPk(id, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
    if (!target) return res.status(404).send('User not found');

    if (!admin) {
      const ok = await canManagerEditUser(actorPlain, target.get({ plain: true }));
      if (!ok) return res.status(403).send('Not authorized to update this user.');
    }

    if (!req.file) return res.status(400).send('No file uploaded');

    const relativePath = `/uploads/avatars/${req.file.filename}`;
    await target.update({ avatarPath: relativePath });

    return res.redirect(`/admin/users/${id}/edit`);
  } catch (e) {
    return res.status(400).send(`Avatar upload failed: ${e.message}`);
  }
});

/* ─────────────────────────────────────────────────────────────
 * IMPORT HELPERS
 * ───────────────────────────────────────────────────────────── */
function extractImportFields(raw) {
  const row = normalizeRow(raw);

  const name = row.name ?? row.Name ?? row['Full Name'] ?? row.fullName ?? '';
  const username =
    row.username ??
    row.Username ??
    row['App Username'] ??
    row.appUsername ??
    row['Login Username'] ??
    row.loginUsername ??
    row.userUsername ??
    '';

  const email = row.email ?? row.Email ?? '';
  const role = row.role ?? row.Role ?? '';
  const password = row.password ?? row.Password ?? row.pass ?? '';
  const phone = row.phone ?? row.Phone ?? '';
  const avatarPath = row.avatarPath ?? row.AvatarPath ?? row.avatar ?? '';

  const employmentStatus = row.employmentStatus ?? row.EmploymentStatus ?? row.status ?? row.Status ?? '';
  const isEnabled = row.isEnabled ?? row.IsEnabled ?? row.enabled ?? row.Enabled ?? '';
  const offboardedAt = row.offboardedAt ?? row.OffboardedAt ?? '';
  const offboardReason = row.offboardReason ?? row.OffboardReason ?? '';

  const employeeId = row.employeeId ?? row.EmployeeId ?? row['Employee ID'] ?? row['Emp.Id'] ?? '';
  const positionType = row.positionType ?? row.PositionType ?? '';
  const startDate = row.startDate ?? row.StartDate ?? '';
  const dateOfBirth = row.dateOfBirth ?? row.DateOfBirth ?? row.DOB ?? '';

  const building = row.building ?? row.Building ?? '';
  const shift = row.shift ?? row.Shift ?? '';

  const domainName = row.domainName ?? row.DomainName ?? row['Domain Name'] ?? '';
  const domainUsernameProfile =
    row.domainUsernameProfile ??
    row.profileDomainUsername ??
    row.staffDomainUsername ??
    row['Profile Domain Username'] ??
    row['Staff Domain Username'] ??
    '';

  const carMake = row.carMake ?? row.CarMake ?? '';
  const carModel = row.carModel ?? row.CarModel ?? '';
  const carColor = row.carColor ?? row.CarColor ?? '';
  const carYear = row.carYear ?? row.CarYear ?? '';
  const licensePlate = row.licensePlate ?? row.LicensePlate ?? '';

  const rosterDomainUsername =
    row.rosterDomainUsername ??
    row['Roster Domain Username'] ??
    row.rosterDomain ??
    row['Domain Username'] ??
    row.domainUsername ??
    '';

  const rosterFullName = row.rosterFullName ?? row['Roster Full Name'] ?? row.rosterName ?? '';
  const rosterEmail = row.rosterEmail ?? row['Roster Email'] ?? row.roster_mail ?? '';
  const rosterBuilding = row.rosterBuilding ?? row['Roster Building'] ?? '';
  const rosterShift = row.rosterShift ?? row['Roster Shift'] ?? '';
  const rosterNotes = row.rosterNotes ?? row['Roster Notes'] ?? row.notes ?? row.Notes ?? '';

  const highestEducationLevel = row.highestEducationLevel ?? row.HighestEducationLevel ?? '';
  const schoolName = row.schoolName ?? row.SchoolName ?? '';
  const degreeName = row.degreeName ?? row.DegreeName ?? '';
  const fieldOfStudy = row.fieldOfStudy ?? row.FieldOfStudy ?? '';
  const graduationYear = row.graduationYear ?? row.GraduationYear ?? '';
  const certificationsText = row.certificationsText ?? row.CertificationsText ?? '';

  const aboutMe = row.aboutMe ?? row.AboutMe ?? '';
  const keyStrengths = row.keyStrengths ?? row.KeyStrengths ?? '';
  const developmentFocus = row.developmentFocus ?? row.DevelopmentFocus ?? '';
  const technicalSkills = row.technicalSkills ?? row.TechnicalSkills ?? '';
  const softSkills = row.softSkills ?? row.SoftSkills ?? '';

  return {
    name: norm(name),
    username: normLower(username),
    email: normLower(email),
    role: toUpper(role),
    password: norm(password),
    phone: norm(phone),
    avatarPath: norm(avatarPath),

    employmentStatus: norm(employmentStatus),
    isEnabled: norm(isEnabled),
    offboardedAt: norm(offboardedAt),
    offboardReason: norm(offboardReason),

    employeeId: norm(employeeId),
    positionType: norm(positionType),
    startDate: norm(startDate),
    dateOfBirth: norm(dateOfBirth),

    building: norm(building),
    shift: norm(shift),

    domainName: norm(domainName),
    domainUsernameProfile: norm(domainUsernameProfile),

    carMake: norm(carMake),
    carModel: norm(carModel),
    carColor: norm(carColor),
    carYear: norm(carYear),
    licensePlate: norm(licensePlate),

    rosterDomainUsername: norm(rosterDomainUsername),
    rosterFullName: norm(rosterFullName),
    rosterEmail: norm(rosterEmail),
    rosterBuilding: norm(rosterBuilding),
    rosterShift: norm(rosterShift),
    rosterNotes: norm(rosterNotes),

    highestEducationLevel: norm(highestEducationLevel),
    schoolName: norm(schoolName),
    degreeName: norm(degreeName),
    fieldOfStudy: norm(fieldOfStudy),
    graduationYear: norm(graduationYear),
    certificationsText: norm(certificationsText),

    aboutMe: norm(aboutMe),
    keyStrengths: norm(keyStrengths),
    developmentFocus: norm(developmentFocus),
    technicalSkills: norm(technicalSkills),
    softSkills: norm(softSkills),
  };
}

router.post('/import', ensureRole(['ADMIN']), upload.single('file'), async (req, res) => {
  if (!req.file) {
    if (req.session) req.session.importError = 'No file uploaded.';
    return res.redirect('/admin/users');
  }

  let rows = [];
  try {
    rows = parseFile(req.file.buffer, req.file.originalname);
  } catch (e) {
    if (req.session) req.session.importError = `Failed to parse import file: ${e.message}`;
    return res.redirect('/admin/users');
  }

  const opts = await getPlacementOptionsForActor(null, true, false);

  let created = 0;
  let updated = 0;
  let invalid = 0;
  const issues = [];

  for (const raw of rows) {
    const f = extractImportFields(raw);

    if (!f.name || !f.username || !f.email || !f.role) {
      invalid++;
      issues.push(`Missing required (name/username/email/role). username="${f.username || 'N/A'}"`);
      continue;
    }
    if (!ROLES.includes(f.role)) {
      invalid++;
      issues.push(`Invalid role "${f.role}" for username="${f.username}"`);
      continue;
    }

    try {
      const existing =
        (await User.findOne({ where: { username: f.username } })) ||
        (await User.findOne({ where: { email: f.email } }));

      const building = toNullIfBlank(f.building);
      const shift = toNullIfBlank(f.shift);

      if (building && opts.buildingOptions.length && !opts.buildingOptions.includes(building)) {
        throw new Error(`Invalid building "${building}" (must match dropdown options).`);
      }
      if (shift && opts.shiftOptions.length && !opts.shiftOptions.includes(shift)) {
        throw new Error(`Invalid shift "${shift}" (must match dropdown options).`);
      }

      const normalizedEmploymentStatus = normalizeEmploymentStatus(f.employmentStatus, 'ACTIVE');
      const normalizedIsEnabled = deriveEnabledFromStatus(normalizedEmploymentStatus, f.isEnabled);
      const normalizedOffboardedAt = parseDateOnly(f.offboardedAt);
      const normalizedOffboardReason = toNullIfBlank(f.offboardReason);

      if (!existing) {
        if (!f.password) {
          invalid++;
          issues.push(`Missing password for new user "${f.username}"`);
          continue;
        }

        const passwordHash = await bcrypt.hash(f.password, 10);

        const u = await User.create({
          name: f.name,
          username: f.username,
          email: f.email,
          role: f.role,
          phone: toNullIfBlank(f.phone),
          avatarPath: toNullIfBlank(f.avatarPath),
          passwordHash,
          employmentStatus: normalizedEmploymentStatus,
          isEnabled: normalizedIsEnabled,
          offboardedAt: normalizedEmploymentStatus === 'ACTIVE' ? null : normalizedOffboardedAt,
          offboardReason: normalizedEmploymentStatus === 'ACTIVE' ? null : normalizedOffboardReason,
        });

        await StaffProfile.create({
          userId: u.id,
          employeeId: toNullIfBlank(f.employeeId),
          positionType: toNullIfBlank(f.positionType) || 'TECHNICIAN',
          startDate: parseDateOnly(f.startDate),
          dateOfBirth: parseDateOnly(f.dateOfBirth),
          building,
          shift,
          domainName: toNullIfBlank(f.domainName),
          domainUsername: toNullIfBlank(f.domainUsernameProfile),

          carMake: toNullIfBlank(f.carMake),
          carModel: toNullIfBlank(f.carModel),
          carColor: toNullIfBlank(f.carColor),
          carYear: toNullIfBlank(f.carYear),
          licensePlate: toNullIfBlank(f.licensePlate),

          highestEducationLevel: toNullIfBlank(f.highestEducationLevel),
          schoolName: toNullIfBlank(f.schoolName),
          degreeName: toNullIfBlank(f.degreeName),
          fieldOfStudy: toNullIfBlank(f.fieldOfStudy),
          graduationYear: toNullIfBlank(f.graduationYear),
          certificationsText: toNullIfBlank(f.certificationsText),

          aboutMe: toNullIfBlank(f.aboutMe),
          keyStrengths: toNullIfBlank(f.keyStrengths),
          developmentFocus: toNullIfBlank(f.developmentFocus),
          technicalSkills: toNullIfBlank(f.technicalSkills),
          softSkills: toNullIfBlank(f.softSkills),
        });

        const dn = normalizeDomainUsername(f.rosterDomainUsername || f.domainUsernameProfile || f.username);
        if (dn) {
          const existingRoster = await RosterEntry.findOne({ where: { domainUsername: dn } });
          const payload = {
            domainUsername: dn,
            employeeId: toNullIfBlank(f.employeeId),
            fullName: toNullIfBlank(f.rosterFullName) || f.name || null,
            email: normLower(f.rosterEmail || f.email) || null,
            building: toNullIfBlank(f.rosterBuilding) || null,
            shift: toNullIfBlank(f.rosterShift) || null,
            notes: toNullIfBlank(f.rosterNotes),
          };

          if (!existingRoster) await RosterEntry.create(payload);
          else {
            await existingRoster.update({
              employeeId: payload.employeeId || existingRoster.employeeId,
              fullName: payload.fullName || existingRoster.fullName,
              email: payload.email || existingRoster.email,
              building: payload.building || existingRoster.building,
              shift: payload.shift || existingRoster.shift,
              notes: payload.notes ?? existingRoster.notes,
            });
          }
        }

        created++;
      } else {
        const nextStatus = normalizeEmploymentStatus(f.employmentStatus, existing.employmentStatus || 'ACTIVE');

        await existing.update({
          name: f.name || existing.name,
          email: f.email || existing.email,
          role: f.role || existing.role,
          phone: toNullIfBlank(f.phone) ?? existing.phone,
          avatarPath: toNullIfBlank(f.avatarPath) ?? existing.avatarPath,
          employmentStatus: nextStatus,
          isEnabled: deriveEnabledFromStatus(nextStatus, f.isEnabled !== '' ? f.isEnabled : existing.isEnabled),
          offboardedAt:
            nextStatus === 'ACTIVE'
              ? null
              : parseDateOnly(f.offboardedAt) ?? existing.offboardedAt ?? null,
          offboardReason:
            nextStatus === 'ACTIVE'
              ? null
              : toNullIfBlank(f.offboardReason) ?? existing.offboardReason ?? null,
        });

        if (f.password) {
          const passwordHash = await bcrypt.hash(f.password, 10);
          await existing.update({ passwordHash });
        }

        const profile = await StaffProfile.findOne({ where: { userId: existing.id } });
        const profilePatch = {
          employeeId: toNullIfBlank(f.employeeId) ?? profile?.employeeId ?? null,
          positionType: toNullIfBlank(f.positionType) ?? profile?.positionType ?? null,
          startDate: parseDateOnly(f.startDate) ?? profile?.startDate ?? null,
          dateOfBirth: parseDateOnly(f.dateOfBirth) ?? profile?.dateOfBirth ?? null,

          building: building ?? profile?.building ?? null,
          shift: shift ?? profile?.shift ?? null,

          domainName: toNullIfBlank(f.domainName) ?? profile?.domainName ?? null,
          domainUsername: toNullIfBlank(f.domainUsernameProfile) ?? profile?.domainUsername ?? null,

          carMake: toNullIfBlank(f.carMake) ?? profile?.carMake ?? null,
          carModel: toNullIfBlank(f.carModel) ?? profile?.carModel ?? null,
          carColor: toNullIfBlank(f.carColor) ?? profile?.carColor ?? null,
          carYear: toNullIfBlank(f.carYear) ?? profile?.carYear ?? null,
          licensePlate: toNullIfBlank(f.licensePlate) ?? profile?.licensePlate ?? null,

          highestEducationLevel: toNullIfBlank(f.highestEducationLevel) ?? profile?.highestEducationLevel ?? null,
          schoolName: toNullIfBlank(f.schoolName) ?? profile?.schoolName ?? null,
          degreeName: toNullIfBlank(f.degreeName) ?? profile?.degreeName ?? null,
          fieldOfStudy: toNullIfBlank(f.fieldOfStudy) ?? profile?.fieldOfStudy ?? null,
          graduationYear: toNullIfBlank(f.graduationYear) ?? profile?.graduationYear ?? null,
          certificationsText: toNullIfBlank(f.certificationsText) ?? profile?.certificationsText ?? null,

          aboutMe: toNullIfBlank(f.aboutMe) ?? profile?.aboutMe ?? null,
          keyStrengths: toNullIfBlank(f.keyStrengths) ?? profile?.keyStrengths ?? null,
          developmentFocus: toNullIfBlank(f.developmentFocus) ?? profile?.developmentFocus ?? null,
          technicalSkills: toNullIfBlank(f.technicalSkills) ?? profile?.technicalSkills ?? null,
          softSkills: toNullIfBlank(f.softSkills) ?? profile?.softSkills ?? null,
        };

        if (profile) await profile.update(profilePatch);
        else await StaffProfile.create({ userId: existing.id, ...profilePatch });

        const dn = normalizeDomainUsername(f.rosterDomainUsername || f.domainUsernameProfile || f.username);
        if (dn) {
          const existingRoster = await RosterEntry.findOne({ where: { domainUsername: dn } });
          const payload = {
            domainUsername: dn,
            employeeId: toNullIfBlank(f.employeeId),
            fullName: toNullIfBlank(f.rosterFullName) || f.name || null,
            email: normLower(f.rosterEmail || f.email) || null,
            building: toNullIfBlank(f.rosterBuilding) || null,
            shift: toNullIfBlank(f.rosterShift) || null,
            notes: toNullIfBlank(f.rosterNotes),
          };

          if (!existingRoster) await RosterEntry.create(payload);
          else {
            await existingRoster.update({
              employeeId: payload.employeeId || existingRoster.employeeId,
              fullName: payload.fullName || existingRoster.fullName,
              email: payload.email || existingRoster.email,
              building: payload.building || existingRoster.building,
              shift: payload.shift || existingRoster.shift,
              notes: payload.notes ?? existingRoster.notes,
            });
          }
        }

        updated++;
      }
    } catch (e) {
      invalid++;
      issues.push(`Error for username="${f.username}": ${e.message}`);
    }
  }

  const summaryLines = [
    `USERS IMPORT → Created: ${created}`,
    `USERS IMPORT → Updated: ${updated}`,
    `USERS IMPORT → Invalid/Errors: ${invalid}`,
  ];
  if (issues.length) {
    summaryLines.push('Some issues:');
    issues.slice(0, 8).forEach((x) => summaryLines.push(`- ${x}`));
    if (issues.length > 8) summaryLines.push(`...and ${issues.length - 8} more`);
  }

  if (req.session) {
    req.session.importSummary = summaryLines.join('\n');
    req.session.importError = null;
  }

  const importActor = await User.findByPk(req.session?.userId, { attributes: ['id', 'username', 'email', 'role'] });
  await createAuditLog({
    req,
    actorUser: importActor,
    actionType: 'IMPORT',
    entityType: 'USER',
    summary: `User import: ${created} created, ${updated} updated, ${invalid} invalid`,
    details: { created, updated, invalid, file: req.file?.originalname, issueCount: issues.length },
  });

  return res.redirect('/admin/users');
});

export default router;