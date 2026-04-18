// src/routes/roster.js
import express from 'express';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { Op } from 'sequelize';

import sequelize from '../db.js';
import { ensureRole } from '../middleware/auth.js';
import {
  User,
  StaffProfile,
  RosterEntry,
  StaffAlias,
} from '../models/index.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

const ALLOWED_SORT_FIELDS = new Set([
  'domainUsername',
  'employeeId',
  'fullName',
  'email',
  'building',
  'shift',
  'linkedUserName',
]);

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function normalizeKey(k) {
  return String(k || '').trim();
}

function normalizeVal(v) {
  if (v == null) return '';
  return typeof v === 'string' ? v.trim() : String(v).trim();
}

function normalizeLower(v) {
  return normalizeVal(v).toLowerCase();
}

function safeArray(val) {
  return Array.isArray(val) ? val : [];
}

function toPositiveInt(value, fallback) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parsePageSize(value) {
  const raw = normalizeLower(value);
  if (raw === 'all') {
    return { showAll: true, pageSize: null };
  }

  const parsed = toPositiveInt(value, 25);
  const allowed = new Set([10, 25, 50, 100]);
  return {
    showAll: false,
    pageSize: allowed.has(parsed) ? parsed : 25,
  };
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseFile(buffer, originalName) {
  const lower = normalizeLower(originalName);
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');

  if (!isExcel && !isCsv) {
    throw new Error('Unsupported file type. Upload CSV or Excel.');
  }

  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const text = buffer.toString('utf8');
  return parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });
}

function extractRosterFields(raw) {
  const row = {};
  for (const k of Object.keys(raw || {})) {
    row[normalizeKey(k)] = raw[k];
  }

  const domainUsername =
    row.domainUsername ??
    row.DomainUsername ??
    row.domain ??
    row.Domain ??
    row.username ??
    row.Username;

  const employeeId =
    row.employeeId ??
    row.EmployeeId ??
    row['Emp.Id'] ??
    row['Emp ID'] ??
    row['Employee ID'];

  const fullName =
    row.fullName ??
    row.FullName ??
    row.name ??
    row.Name ??
    row['Employee Name'];

  const email = row.email ?? row.Email;
  const building = row.building ?? row.Building;
  const shift = row.shift ?? row.Shift;
  const notes = row.notes ?? row.Notes;

  return {
    domainUsername: normalizeLower(domainUsername),
    employeeId: normalizeVal(employeeId),
    fullName: normalizeVal(fullName),
    email: normalizeLower(email),
    building: normalizeVal(building),
    shift: normalizeVal(shift),
    notes: normalizeVal(notes),
  };
}

function pickBetterValue(preferredVal, fallbackVal) {
  const preferred = normalizeVal(preferredVal);
  if (preferred) return preferred;
  const fallback = normalizeVal(fallbackVal);
  return fallback || null;
}

function scoreRow(r) {
  let s = 0;
  if (normalizeVal(r.domainUsername)) s += 3;
  if (normalizeVal(r.employeeId)) s += 3;
  if (normalizeVal(r.email)) s += 2;
  if (normalizeVal(r.fullName)) s += 2;
  if (normalizeVal(r.building)) s += 1;
  if (normalizeVal(r.shift)) s += 1;
  if (normalizeVal(r.notes)) s += 1;
  return s;
}

function userDisplayName(user, profile) {
  const candidates = [
    user?.fullName,
    user?.name,
    [user?.firstName, user?.lastName].filter(Boolean).join(' '),
    profile?.fullName,
    profile?.name,
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' '),
    user?.username,
    user?.email,
  ];

  for (const candidate of candidates) {
    const v = normalizeVal(candidate);
    if (v) return v;
  }

  return 'User';
}

function sortRows(rows, sortBy, sortDir) {
  const dir = normalizeUpper(sortDir) === 'DESC' ? -1 : 1;
  const key = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : 'domainUsername';

  return [...rows].sort((a, b) => {
    const av = normalizeLower(a?.[key]);
    const bv = normalizeLower(b?.[key]);

    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;

    const aId = Number(a?.id || 0);
    const bId = Number(b?.id || 0);
    return (aId - bId) * dir;
  });
}

function normalizeUpper(v) {
  return normalizeVal(v).toUpperCase();
}

function paginateRows(allRows, page, pageSize, showAll) {
  const totalRows = allRows.length;

  if (showAll) {
    return {
      rows: allRows,
      pagination: {
        page: 1,
        pageSize: 'all',
        totalRows,
        totalPages: totalRows > 0 ? 1 : 1,
        from: totalRows ? 1 : 0,
        to: totalRows,
        showAll: true,
      },
    };
  }

  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageRows = allRows.slice(startIdx, endIdx);

  return {
    rows: pageRows,
    pagination: {
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
      from: totalRows ? startIdx + 1 : 0,
      to: Math.min(endIdx, totalRows),
      showAll: false,
    },
  };
}

function buildBaseWhere({ building, shift, q }) {
  const where = {};

  if (building) where.building = building;
  if (shift) where.shift = shift;

  if (q) {
    where[Op.or] = [
      { domainUsername: { [Op.like]: `%${normalizeLower(q)}%` } },
      { employeeId: { [Op.like]: `%${q}%` } },
      { fullName: { [Op.like]: `%${q}%` } },
      { email: { [Op.like]: `%${normalizeLower(q)}%` } },
    ];
  }

  return where;
}

async function loadFilterOptions() {
  const [buildingVals, shiftVals] = await Promise.all([
    RosterEntry.findAll({
      attributes: ['building'],
      where: {
        building: {
          [Op.and]: [
            { [Op.not]: null },
            { [Op.ne]: '' },
          ],
        },
      },
      group: ['building'],
      order: [['building', 'ASC']],
      raw: true,
    }),
    RosterEntry.findAll({
      attributes: ['shift'],
      where: {
        shift: {
          [Op.and]: [
            { [Op.not]: null },
            { [Op.ne]: '' },
          ],
        },
      },
      group: ['shift'],
      order: [['shift', 'ASC']],
      raw: true,
    }),
  ]);

  return {
    buildingOptions: buildingVals.map((x) => x.building).filter(Boolean),
    shiftOptions: shiftVals.map((x) => x.shift).filter(Boolean),
  };
}

async function enrichRosterRows(rows) {
  const plainRows = safeArray(rows).map((r) => (typeof r.get === 'function' ? r.get({ plain: true }) : { ...r }));

  if (!plainRows.length) return [];

  const domainUsernames = [...new Set(plainRows.map((r) => normalizeLower(r.domainUsername)).filter(Boolean))];
  const emails = [...new Set(plainRows.map((r) => normalizeLower(r.email)).filter(Boolean))];
  const employeeIds = [...new Set(plainRows.map((r) => normalizeVal(r.employeeId)).filter(Boolean))];
  const fullNames = [...new Set(plainRows.map((r) => normalizeLower(r.fullName)).filter(Boolean))];

  const aliasOr = [];
  if (domainUsernames.length) {
    aliasOr.push({
      aliasType: 'DOMAIN_USERNAME',
      aliasValue: { [Op.in]: domainUsernames },
    });
    aliasOr.push({
      aliasType: 'USERNAME',
      aliasValue: { [Op.in]: domainUsernames },
    });
  }
  if (employeeIds.length) {
    aliasOr.push({
      aliasType: 'EMPLOYEE_ID',
      aliasValue: { [Op.in]: employeeIds.map((x) => normalizeLower(x)) },
    });
  }
  if (fullNames.length) {
    aliasOr.push({
      aliasType: 'NAME',
      aliasValue: { [Op.in]: fullNames },
    });
  }

  const [directUsers, profileRows, aliasRows] = await Promise.all([
    User.findAll({
      where: {
        [Op.or]: [
          domainUsernames.length ? { username: { [Op.in]: domainUsernames } } : null,
          emails.length ? { email: { [Op.in]: emails } } : null,
        ].filter(Boolean),
      },
      raw: true,
    }),
    StaffProfile.findAll({
      where: employeeIds.length ? { employeeId: { [Op.in]: employeeIds } } : undefined,
      raw: true,
    }),
    aliasOr.length
      ? StaffAlias.findAll({
          where: { [Op.or]: aliasOr },
          raw: true,
        })
      : Promise.resolve([]),
  ]);

  const userIdsToLoad = new Set(directUsers.map((u) => u.id));

  for (const p of profileRows) {
    if (p.userId) userIdsToLoad.add(p.userId);
  }
  for (const a of aliasRows) {
    if (a.staffId) userIdsToLoad.add(a.staffId);
  }

  const linkedUsers = userIdsToLoad.size
    ? await User.findAll({
        where: { id: { [Op.in]: [...userIdsToLoad] } },
        raw: true,
      })
    : [];

  const userById = new Map(linkedUsers.map((u) => [u.id, u]));
  const directByUsername = new Map(
    directUsers
      .filter((u) => normalizeLower(u.username))
      .map((u) => [normalizeLower(u.username), userById.get(u.id) || u])
  );
  const directByEmail = new Map(
    directUsers
      .filter((u) => normalizeLower(u.email))
      .map((u) => [normalizeLower(u.email), userById.get(u.id) || u])
  );

  const profileByEmployeeId = new Map();
  const profileByUserId = new Map();
  for (const p of profileRows) {
    if (normalizeVal(p.employeeId)) {
      profileByEmployeeId.set(normalizeVal(p.employeeId), p);
    }
    if (p.userId) {
      profileByUserId.set(p.userId, p);
    }
  }

  const aliasMap = new Map();
  for (const a of aliasRows) {
    const key = `${normalizeUpper(a.aliasType)}::${normalizeLower(a.aliasValue)}`;
    aliasMap.set(key, a);
  }

  return plainRows.map((r) => {
    const domain = normalizeLower(r.domainUsername);
    const empId = normalizeVal(r.employeeId);
    const email = normalizeLower(r.email);
    const fullName = normalizeLower(r.fullName);

    const aliasDomain = aliasMap.get(`DOMAIN_USERNAME::${domain}`);
    const aliasUsername = aliasMap.get(`USERNAME::${domain}`);
    const aliasEmp = aliasMap.get(`EMPLOYEE_ID::${normalizeLower(empId)}`);
    const aliasName = aliasMap.get(`NAME::${fullName}`);
    const empProfile = profileByEmployeeId.get(empId);

    let linkedUser =
      (aliasDomain && userById.get(aliasDomain.staffId)) ||
      (aliasUsername && userById.get(aliasUsername.staffId)) ||
      (aliasEmp && userById.get(aliasEmp.staffId)) ||
      (empProfile && userById.get(empProfile.userId)) ||
      directByUsername.get(domain) ||
      directByEmail.get(email) ||
      (aliasName && userById.get(aliasName.staffId)) ||
      null;

    const linkedProfile =
      (linkedUser && profileByUserId.get(linkedUser.id)) ||
      empProfile ||
      null;

    const linkedUserName = linkedUser ? userDisplayName(linkedUser, linkedProfile) : '';
    const linkedUsername = linkedUser ? normalizeVal(linkedUser.username) : '';

    return {
      ...r,
      isLinkedToUser: !!linkedUser,
      linkedUserId: linkedUser?.id || null,
      linkedUserName,
      linkedUsername,
      linkedEmployeeId: linkedProfile?.employeeId || null,
    };
  });
}

async function buildDuplicateGroups() {
  const all = await RosterEntry.findAll({ raw: true });
  const byEmp = new Map();

  for (const r of all) {
    const emp = normalizeVal(r.employeeId);
    if (!emp) continue;
    if (!byEmp.has(emp)) byEmp.set(emp, []);
    byEmp.get(emp).push(r);
  }

  const groups = [];

  for (const [employeeId, list] of byEmp.entries()) {
    if (list.length <= 1) continue;

    const allRows = [...list].sort((a, b) => {
      const ds = scoreRow(b) - scoreRow(a);
      if (ds !== 0) return ds;
      const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bu - au;
    });

    const keepId = allRows[0]?.id || null;
    const duplicateRows = allRows.slice(1);

    groups.push({
      employeeId,
      keepId,
      allRows,
      duplicateRows,
    });
  }

  groups.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  return groups;
}

/**
 * Remove duplicates by employeeId.
 * Keeps the “best” record per employeeId.
 */
async function removeEmployeeIdDuplicates() {
  const all = await RosterEntry.findAll();
  const byEmp = new Map();

  for (const r of all) {
    const emp = normalizeVal(r.employeeId);
    if (!emp) continue;

    if (!byEmp.has(emp)) {
      byEmp.set(emp, [r]);
    } else {
      byEmp.get(emp).push(r);
    }
  }

  let deleted = 0;
  const deletedIds = [];

  for (const [, list] of byEmp.entries()) {
    if (list.length <= 1) continue;

    const sorted = [...list].sort((a, b) => {
      const ds = scoreRow(b) - scoreRow(a);
      if (ds !== 0) return ds;
      const au = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bu = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bu - au;
    });

    const keep = sorted[0];
    const losers = sorted.slice(1);

    for (const loser of losers) {
      await keep.update({
        domainUsername: pickBetterValue(keep.domainUsername, loser.domainUsername),
        employeeId: pickBetterValue(keep.employeeId, loser.employeeId),
        email: pickBetterValue(keep.email, loser.email),
        fullName: pickBetterValue(keep.fullName, loser.fullName),
        building: pickBetterValue(keep.building, loser.building),
        shift: pickBetterValue(keep.shift, loser.shift),
        notes: pickBetterValue(keep.notes, loser.notes),
      });

      await loser.destroy();
      deleted += 1;
      deletedIds.push(loser.id);
    }
  }

  return { deleted, deletedIds };
}

async function getRosterViewData(query) {
  const building = normalizeVal(query.building);
  const shift = normalizeVal(query.shift);
  const q = normalizeVal(query.q);
  const linkStatus = normalizeUpper(query.linkStatus);
  const sortBy = ALLOWED_SORT_FIELDS.has(normalizeVal(query.sortBy))
    ? normalizeVal(query.sortBy)
    : 'domainUsername';
  const sortDir = normalizeUpper(query.sortDir) === 'DESC' ? 'DESC' : 'ASC';

  const { showAll, pageSize } = parsePageSize(query.pageSize);
  const page = toPositiveInt(query.page, 1);

  const where = buildBaseWhere({ building, shift, q });

  const [baseRows, filterOptions] = await Promise.all([
    RosterEntry.findAll({
      where,
      raw: true,
    }),
    loadFilterOptions(),
  ]);

  let enrichedRows = await enrichRosterRows(baseRows);

  if (linkStatus === 'LINKED') {
    enrichedRows = enrichedRows.filter((r) => r.isLinkedToUser);
  } else if (linkStatus === 'UNLINKED') {
    enrichedRows = enrichedRows.filter((r) => !r.isLinkedToUser);
  }

  enrichedRows = sortRows(enrichedRows, sortBy, sortDir);

  const { rows, pagination } = paginateRows(
    enrichedRows,
    page,
    pageSize || 25,
    showAll
  );

  return {
    rows,
    allRows: enrichedRows,
    pagination,
    filters: {
      q,
      building,
      shift,
      linkStatus,
      sortBy,
      sortDir,
      ...filterOptions,
    },
  };
}

// GET /roster
router.get(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  asyncHandler(async (req, res) => {
    const { rows, pagination, filters } = await getRosterViewData(req.query);

    return res.render('roster/index', {
      pageTitle: 'Roster',
      user: req.session?.user || null,
      rows,
      pagination,
      filters,
    });
  })
);

// GET /roster/export.csv
router.get(
  '/export.csv',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  asyncHandler(async (req, res) => {
    const { allRows } = await getRosterViewData({
      ...req.query,
      pageSize: 'all',
      page: 1,
    });

    const headers = [
      'id',
      'domainUsername',
      'employeeId',
      'fullName',
      'email',
      'building',
      'shift',
      'linkedStatus',
      'linkedUserName',
      'linkedUsername',
      'notes',
    ];

    const lines = [
      headers.join(','),
      ...allRows.map((r) =>
        [
          r.id,
          r.domainUsername || '',
          r.employeeId || '',
          r.fullName || '',
          r.email || '',
          r.building || '',
          r.shift || '',
          r.isLinkedToUser ? 'LINKED' : 'UNLINKED',
          r.linkedUserName || '',
          r.linkedUsername || '',
          r.notes || '',
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="roster-export.csv"');
    return res.send(lines.join('\n'));
  })
);

// GET /roster/duplicates
router.get(
  '/duplicates',
  ensureRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const groups = await buildDuplicateGroups();

    return res.render('roster/duplicates', {
      pageTitle: 'Roster Duplicates',
      user: req.session?.user || null,
      groups,
    });
  })
);

// GET /roster/import
router.get(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  asyncHandler(async (req, res) => {
    return res.render('roster/import', {
      pageTitle: 'Roster Import',
      user: req.session?.user || null,
      importSummary: null,
      importError: null,
    });
  })
);

// POST /roster/import
// Step 1 (file upload): parse + validate, show preview.
// Step 2 (confirmation): importPayload in body, apply the import.
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    // ── Step 2: confirm & apply ──────────────────────────────
    if (req.body && req.body.importPayload) {
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(req.body.importPayload);
      } catch (e) {
        return res.status(400).render('roster/import', {
          pageTitle: 'Roster Import',
          user: req.session?.user || null,
          importSummary: null,
          importError: 'Invalid import payload. Please re-upload your file.',
        });
      }
      const rows = parsedPayload;
      // fall through to the main import logic below with rows already populated
      return applyRosterImport({ rows, req, res });
    }

    // ── Step 1: parse file and show preview ─────────────────
    if (!req.file) {
      return res.status(400).render('roster/import', {
        pageTitle: 'Roster Import',
        user: req.session?.user || null,
        importSummary: null,
        importError: 'No file uploaded.',
      });
    }

    let rawRows = [];
    try {
      rawRows = parseFile(req.file.buffer, req.file.originalname);
    } catch (e) {
      return res.status(400).render('roster/import', {
        pageTitle: 'Roster Import',
        user: req.session?.user || null,
        importSummary: null,
        importError: `Failed to parse file: ${e.message}`,
      });
    }

    const previewRows = rawRows.map((raw, idx) => {
      const f = extractRosterFields(raw);
      const issues = [];
      const warnings = [];
      if (!f.employeeId) issues.push('Missing employeeId');
      if (!f.domainUsername) issues.push('Missing domainUsername');
      if (!f.fullName) warnings.push('No full name');
      if (!f.building) warnings.push('No building');
      if (!f.shift) warnings.push('No shift');
      return {
        rowNumber: idx + 1,
        isValid: issues.length === 0,
        domainUsername: f.domainUsername,
        employeeId: f.employeeId,
        fullName: f.fullName,
        email: f.email,
        building: f.building,
        shift: f.shift,
        issues,
        warnings,
        _fields: f,
      };
    });

    // Serialize valid rows as the payload for the confirm step
    const importPayload = JSON.stringify(
      previewRows.filter(r => r.isValid).map(r => r._fields)
    );

    return res.render('roster/importPreview', {
      pageTitle: 'Roster Import Preview',
      user: req.session?.user || null,
      previewRows,
      importPayload,
    });
  })
);

async function applyRosterImport({ rows, req, res }) {

    let created = 0;
    let updated = 0;
    let invalid = 0;
    let merged = 0;
    let linkedToUser = 0;
    const issues = [];

    for (const raw of rows) {
      const f = extractRosterFields(raw);

      if (!f.employeeId) {
        invalid++;
        issues.push(`Missing employeeId for domain "${f.domainUsername || 'unknown'}".`);
        continue;
      }

      if (!f.domainUsername) {
        invalid++;
        issues.push(`Missing domainUsername for employeeId "${f.employeeId}".`);
        continue;
      }

      try {
        await sequelize.transaction(async (t) => {
          const existingByEmp = await RosterEntry.findOne({
            where: { employeeId: f.employeeId },
            transaction: t,
          });

          const existingByDomain = await RosterEntry.findOne({
            where: { domainUsername: f.domainUsername },
            transaction: t,
          });

          let target = existingByEmp || existingByDomain;

          if (existingByEmp && existingByDomain && existingByEmp.id !== existingByDomain.id) {
            await existingByEmp.update(
              {
                domainUsername: f.domainUsername,
                email: pickBetterValue(f.email, existingByEmp.email),
                fullName: pickBetterValue(f.fullName, existingByEmp.fullName),
                building: pickBetterValue(f.building, existingByEmp.building),
                shift: pickBetterValue(f.shift, existingByEmp.shift),
                notes: pickBetterValue(f.notes, existingByEmp.notes),
              },
              { transaction: t }
            );

            await existingByDomain.destroy({ transaction: t });

            target = existingByEmp;
            merged++;
            updated++;
            return;
          }

          if (!target) {
            await RosterEntry.create(
              {
                domainUsername: f.domainUsername,
                employeeId: f.employeeId,
                fullName: f.fullName || null,
                email: f.email || null,
                building: f.building || null,
                shift: f.shift || null,
                notes: f.notes || null,
              },
              { transaction: t }
            );
            created++;
          } else {
            await target.update(
              {
                domainUsername: f.domainUsername || target.domainUsername,
                employeeId: f.employeeId || target.employeeId,
                fullName: pickBetterValue(f.fullName, target.fullName),
                email: pickBetterValue(f.email, target.email),
                building: pickBetterValue(f.building, target.building),
                shift: pickBetterValue(f.shift, target.shift),
                notes: pickBetterValue(f.notes, target.notes),
              },
              { transaction: t }
            );
            updated++;
          }
        });

        let matchedUser = null;

        if (f.domainUsername) {
          matchedUser = await User.findOne({ where: { username: f.domainUsername } });
        }
        if (!matchedUser && f.email) {
          matchedUser = await User.findOne({ where: { email: f.email } });
        }

        if (matchedUser && f.employeeId) {
          const profile = await StaffProfile.findOne({ where: { userId: matchedUser.id } });
          if (profile && !profile.employeeId) {
            await profile.update({ employeeId: f.employeeId });
          }
          linkedToUser++;
        }
      } catch (e) {
        invalid++;
        issues.push(`Error for employeeId "${f.employeeId}" (${f.domainUsername}): ${e.message}`);
      }
    }

    let dedupeDeleted = 0;
    try {
      const result = await removeEmployeeIdDuplicates();
      dedupeDeleted = result.deleted;
    } catch (e) {
      issues.push(`Post-import dedupe failed: ${e.message}`);
    }

    const summary = [
      `ROSTER IMPORT → Created: ${created}`,
      `ROSTER IMPORT → Updated: ${updated}`,
      `ROSTER IMPORT → Merged duplicates: ${merged}`,
      `ROSTER IMPORT → Post-import duplicates removed: ${dedupeDeleted}`,
      `ROSTER IMPORT → Linked to existing Users (best effort): ${linkedToUser}`,
      `ROSTER IMPORT → Invalid/errored rows: ${invalid}`,
    ];

    if (issues.length) {
      summary.push('Top issues:');
      issues.slice(0, 6).forEach((x) => summary.push(`- ${x}`));
      if (issues.length > 6) summary.push(`...and ${issues.length - 6} more`);
    }

    return res.render('roster/import', {
      pageTitle: 'Roster Import',
      user: req.session?.user || null,
      importSummary: summary.join('\n'),
      importError: null,
    });
}

// GET /roster/:id/edit
router.get(
  '/:id/edit',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  asyncHandler(async (req, res) => {
    const id = toPositiveInt(req.params.id, 0);
    const row = id ? await RosterEntry.findByPk(id, { raw: true }) : null;

    if (!row) {
      return res.status(404).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: null,
        error: 'Roster entry not found.',
      });
    }

    const [enriched] = await enrichRosterRows([row]);

    return res.render('roster/edit', {
      pageTitle: 'Edit Roster Entry',
      user: req.session?.user || null,
      row: enriched,
      error: null,
    });
  })
);

// POST /roster/:id/update
router.post(
  '/:id/update',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  asyncHandler(async (req, res) => {
    const id = toPositiveInt(req.params.id, 0);
    const row = id ? await RosterEntry.findByPk(id) : null;

    if (!row) {
      return res.status(404).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: null,
        error: 'Roster entry not found.',
      });
    }

    const updates = {
      domainUsername: normalizeLower(req.body.domainUsername),
      employeeId: normalizeVal(req.body.employeeId),
      fullName: normalizeVal(req.body.fullName) || null,
      email: normalizeLower(req.body.email) || null,
      building: normalizeVal(req.body.building) || null,
      shift: normalizeVal(req.body.shift) || null,
      notes: normalizeVal(req.body.notes) || null,
    };

    if (!updates.domainUsername) {
      const [enriched] = await enrichRosterRows([row.get({ plain: true })]);
      return res.status(400).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: { ...enriched, ...updates },
        error: 'Domain Username is required.',
      });
    }

    if (!updates.employeeId) {
      const [enriched] = await enrichRosterRows([row.get({ plain: true })]);
      return res.status(400).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: { ...enriched, ...updates },
        error: 'Employee ID is required.',
      });
    }

    const existingEmp = await RosterEntry.findOne({
      where: {
        employeeId: updates.employeeId,
        id: { [Op.ne]: row.id },
      },
    });

    if (existingEmp) {
      const [enriched] = await enrichRosterRows([row.get({ plain: true })]);
      return res.status(400).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: { ...enriched, ...updates },
        error: `Employee ID "${updates.employeeId}" is already used by another roster entry.`,
      });
    }

    const existingDomain = await RosterEntry.findOne({
      where: {
        domainUsername: updates.domainUsername,
        id: { [Op.ne]: row.id },
      },
    });

    if (existingDomain) {
      const [enriched] = await enrichRosterRows([row.get({ plain: true })]);
      return res.status(400).render('roster/edit', {
        pageTitle: 'Edit Roster Entry',
        user: req.session?.user || null,
        row: { ...enriched, ...updates },
        error: `Domain Username "${updates.domainUsername}" is already used by another roster entry.`,
      });
    }

    await row.update(updates);
    return res.redirect('/roster');
  })
);

// POST /roster/delete
router.post(
  '/delete',
  ensureRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    const idsRaw = req.body.ids;
    const ids = Array.isArray(idsRaw) ? idsRaw : idsRaw ? [idsRaw] : [];

    const numericIds = ids
      .map((x) => parseInt(String(x), 10))
      .filter((n) => Number.isFinite(n));

    if (!numericIds.length) {
      return res.redirect('/roster');
    }

    await RosterEntry.destroy({ where: { id: numericIds } });
    return res.redirect('/roster');
  })
);

// POST /roster/dedupe
router.post(
  '/dedupe',
  ensureRole(['ADMIN']),
  asyncHandler(async (req, res) => {
    await removeEmployeeIdDuplicates();
    return res.redirect('/roster');
  })
);

export default router;