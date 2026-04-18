// src/routes/training.js
import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { Op } from 'sequelize';
import { Training, StaffProfile, User } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

// Memory storage is fine for imports (small files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * -----------------------------
 * Sanitization + normalization
 * -----------------------------
 */

function sanitizeText(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/\u00A0/g, ' ').trim();
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeHeaderKey(key) {
  return sanitizeText(key)
    .toLowerCase()
    .replace(/[().]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickValueByAliases(rowMap, aliases = []) {
  for (const a of aliases) {
    const k = normalizeHeaderKey(a);
    if (Object.prototype.hasOwnProperty.call(rowMap, k)) {
      const val = rowMap[k];
      if (val !== undefined && val !== null && String(val).trim() !== '') return val;
    }
  }
  return '';
}

function toISODateOnly(val) {
  if (val === undefined || val === null || val === '') return '';

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof val === 'number' && Number.isFinite(val)) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = parsed.y;
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const s = sanitizeText(val);
  if (!s) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return s;
}

function normalizeProgress(overallProgressRaw, statusRaw) {
  const progressStr = sanitizeText(overallProgressRaw);

  if (progressStr) {
    const pctMatch = progressStr.match(/(\d+(\.\d+)?)/);
    if (pctMatch) {
      const n = Number(pctMatch[1]);
      if (Number.isFinite(n)) {
        return Math.max(0, Math.min(100, n));
      }
    }

    const pLower = progressStr.toLowerCase();
    if (pLower.includes('complete')) return 100;
    if (pLower.includes('in progress')) return 50;
    if (pLower.includes('not started')) return 0;
  }

  const statusStr = sanitizeText(statusRaw).toLowerCase();
  if (statusStr.includes('complete')) return 100;
  if (statusStr.includes('in progress')) return 50;
  if (statusStr.includes('not started')) return 0;

  return null;
}

function normalizeTrainingRow(raw) {
  const rowMap = {};

  Object.keys(raw || {}).forEach((key) => {
    const nk = normalizeHeaderKey(key);
    rowMap[nk] = raw[key];
  });

  const employeeId = sanitizeText(
    pickValueByAliases(rowMap, [
      'Employee ID',
      'Emp Id',
      'Emp.ID',
      'EmpId',
      'EmployeeId',
      'employeeId',
    ])
  );

  const employeeName = sanitizeText(
    pickValueByAliases(rowMap, [
      'Employee Name',
      'Name',
      'employeeName',
    ])
  );

  const courseName = sanitizeText(
    pickValueByAliases(rowMap, [
      'Course Name',
      'courseName',
      'Training Name',
      'Title',
    ])
  );

  const courseType = sanitizeText(
    pickValueByAliases(rowMap, [
      'Course Type',
      'courseType',
      'Training Type',
      'Category',
    ])
  );

  const status = pickValueByAliases(rowMap, [
    'Training Certification Status',
    'Certification Status',
    'Status',
  ]);

  const overallProgressRaw = pickValueByAliases(rowMap, [
    'Overall Progress',
    'Progress',
    'Completion',
  ]);

  const overallProgress = normalizeProgress(overallProgressRaw, status);

  const startDate = toISODateOnly(
    pickValueByAliases(rowMap, ['Start Date', 'Start', 'Assigned Date'])
  );

  const endDate = toISODateOnly(
    pickValueByAliases(rowMap, ['End Date', 'End', 'Completed Date', 'Expiration Date'])
  );

  const certificationFrequency = sanitizeText(
    pickValueByAliases(rowMap, [
      'Certification Frequency',
      'Cert Frequency',
      'Frequency',
    ])
  );

  return {
    employeeId,
    employeeName,
    courseName,
    courseType,
    overallProgress,
    startDate,
    endDate,
    certificationFrequency,
  };
}

async function recomputeDuplicateFlags() {
  const all = await Training.findAll();
  const keyCounts = new Map();

  const buildKey = (t) => {
    return [
      t.employeeId || '',
      t.courseName || '',
      t.courseType || '',
      t.startDate || '',
    ]
      .map((v) => String(v || '').trim().toLowerCase())
      .join('||');
  };

  all.forEach((t) => {
    const key = buildKey(t);
    if (!key) return;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  });

  await Promise.all(
    all.map((t) => {
      const key = buildKey(t);
      const count = key ? keyCounts.get(key) || 0 : 0;
      const isDup = count > 1;
      if (t.isDuplicate !== isDup) {
        t.isDuplicate = isDup;
        return t.save();
      }
      return Promise.resolve();
    })
  );
}

async function getViewer(req) {
  if (!req.session || !req.session.userId) return null;
  return User.findByPk(req.session.userId);
}

async function buildTrainingListViewModel({
  req,
  importSummary = null,
  importError = null,
  courseType = '',
  courseName = '',
  searchQuery = '',
  showDuplicates = false,
}) {
  const viewer = await getViewer(req);
  const viewerRole = viewer?.role || 'MANAGER';

  const isAdmin = viewerRole === 'ADMIN';
  const isManager = viewerRole === 'MANAGER' || viewerRole === 'SENIOR_MANAGER';

  const allRecords = await Training.findAll({
    order: [
      ['courseType', 'ASC'],
      ['courseName', 'ASC'],
      ['employeeName', 'ASC'],
    ],
  });

  const typeSet = new Set();
  const nameSetForType = new Set();

  allRecords.forEach((t) => {
    if (t.courseType) typeSet.add(t.courseType);
    if (courseType && t.courseType === courseType && t.courseName) {
      nameSetForType.add(t.courseName);
    }
  });

  const courseTypeOptions = Array.from(typeSet).sort((a, b) => a.localeCompare(b));
  const courseNameOptions = Array.from(nameSetForType).sort((a, b) => a.localeCompare(b));

  let filtered = allRecords;

  if (courseType) filtered = filtered.filter((t) => t.courseType === courseType);
  if (courseName) filtered = filtered.filter((t) => t.courseName === courseName);

  const search = String(searchQuery || '').trim().toLowerCase();
  if (search) {
    filtered = filtered.filter((t) => {
      const fields = [
        t.employeeId || '',
        t.employeeName || '',
        t.courseName || '',
        t.startDate || '',
      ];
      return fields.some((f) => String(f).toLowerCase().includes(search));
    });
  }

  const duplicatesOnly = isAdmin ? !!showDuplicates : false;
  if (duplicatesOnly) {
    filtered = filtered.filter((t) => t.isDuplicate);
  }

  return {
    trainings: filtered,
    courseType,
    courseName,
    courseTypeOptions,
    courseNameOptions,
    searchQuery,
    totalCount: filtered.length,
    duplicateCount: filtered.filter((t) => t.isDuplicate).length,
    isAdmin,
    isManager,
    viewerRole,
    showDuplicates: duplicatesOnly,
    importSummary,
    importError,
  };
}

/**
 * GET /training
 * Training & Certification overview
 * Manager/Admin only
 */
router.get(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const { courseType = '', courseName = '', q = '' } = req.query;
    const showDuplicatesRequested = String(req.query.showDuplicates || '') === '1';

    const vm = await buildTrainingListViewModel({
      req,
      courseType,
      courseName,
      searchQuery: q,
      showDuplicates: showDuplicatesRequested,
    });

    return res.render('training/list', vm);
  }
);

/**
 * GET /training/import
 * Import-focused entry point used by the Imports hub
 * Manager/Admin only
 */
router.get(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const vm = await buildTrainingListViewModel({
      req,
      importSummary: null,
      importError: null,
      courseType: '',
      courseName: '',
      searchQuery: '',
      showDuplicates: false,
    });

    return res.render('training/list', vm);
  }
);

/**
 * GET /training/new
 */
router.get(
  '/new',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    res.render('training/edit', {
      training: null,
      mode: 'create',
      error: null,
    });
  }
);

/**
 * POST /training/create
 */
router.post(
  '/create',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    try {
      const {
        employeeId,
        employeeName,
        courseName,
        courseType,
        overallProgress,
        startDate,
        endDate,
        certificationFrequency,
      } = req.body;

      if (!employeeId || !employeeName || !courseName) {
        return res.status(400).render('training/edit', {
          training: null,
          mode: 'create',
          error: 'Employee ID, Employee Name, and Course Name are required fields.',
        });
      }

      await Training.create({
        employeeId: sanitizeText(employeeId),
        employeeName: sanitizeText(employeeName),
        courseName: sanitizeText(courseName),
        courseType: sanitizeText(courseType) || null,
        overallProgress: overallProgress === '' ? null : overallProgress,
        startDate: startDate || null,
        endDate: endDate || null,
        certificationFrequency: sanitizeText(certificationFrequency) || null,
      });

      await recomputeDuplicateFlags();
      res.redirect('/training');
    } catch (err) {
      console.error('TRAINING CREATE ERROR:', err);
      return res.status(500).render('training/edit', {
        training: null,
        mode: 'create',
        error: 'Error creating training record. Please try again.',
      });
    }
  }
);

/**
 * GET /training/:id/edit
 */
router.get(
  '/:id/edit',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const id = Number(req.params.id);
    const training = await Training.findByPk(id);

    if (!training) return res.status(404).send('Training record not found');

    res.render('training/edit', {
      training,
      mode: 'edit',
      error: null,
    });
  }
);

/**
 * POST /training/:id/update
 */
router.post(
  '/:id/update',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const id = Number(req.params.id);

    try {
      const training = await Training.findByPk(id);
      if (!training) return res.status(404).send('Training record not found');

      const {
        employeeId,
        employeeName,
        courseName,
        courseType,
        overallProgress,
        startDate,
        endDate,
        certificationFrequency,
      } = req.body;

      if (!employeeId || !employeeName || !courseName) {
        return res.status(400).render('training/edit', {
          training,
          mode: 'edit',
          error: 'Employee ID, Employee Name, and Course Name are required fields.',
        });
      }

      await training.update({
        employeeId: sanitizeText(employeeId),
        employeeName: sanitizeText(employeeName),
        courseName: sanitizeText(courseName),
        courseType: sanitizeText(courseType) || null,
        overallProgress: overallProgress === '' ? null : overallProgress,
        startDate: startDate || null,
        endDate: endDate || null,
        certificationFrequency: sanitizeText(certificationFrequency) || null,
      });

      await recomputeDuplicateFlags();
      res.redirect('/training');
    } catch (err) {
      console.error('TRAINING UPDATE ERROR:', err);
      const training = await Training.findByPk(id);
      return res.status(500).render('training/edit', {
        training,
        mode: 'edit',
        error: 'Error updating training record. Please try again.',
      });
    }
  }
);

/**
 * POST /training/:id/delete
 */
router.post(
  '/:id/delete',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    const id = Number(req.params.id);
    try {
      const training = await Training.findByPk(id);
      if (!training) return res.status(404).send('Training record not found');

      await training.destroy();
      await recomputeDuplicateFlags();

      res.redirect('/training');
    } catch (err) {
      console.error('TRAINING DELETE ERROR:', err);
      return res.status(500).send('Error deleting training record.');
    }
  }
);

/**
 * POST /training/bulk-delete
 */
router.post(
  '/bulk-delete',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    try {
      let { ids } = req.body;
      if (!ids) return res.redirect('/training');

      if (!Array.isArray(ids)) ids = [ids];

      const numericIds = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));

      if (numericIds.length) {
        await Training.destroy({
          where: { id: { [Op.in]: numericIds } },
        });
        await recomputeDuplicateFlags();
      }

      res.redirect('/training');
    } catch (err) {
      console.error('TRAINING BULK DELETE ERROR:', err);
      return res.status(500).send('Error deleting selected training records.');
    }
  }
);

/**
 * POST /training/import
 * Bulk import from CSV / Excel.
 *
 * HARD RULE:
 * - Only import rows where Employee ID exists in StaffProfile (User Management roster).
 *
 * Manager/Admin only
 */
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  upload.single('file'),
  async (req, res) => {
    const reloadWith = async ({ statusCode = 200, importError = null, importSummary = null }) => {
      const vm = await buildTrainingListViewModel({
        req,
        importSummary,
        importError,
        courseType: '',
        courseName: '',
        searchQuery: '',
        showDuplicates: false,
      });

      return res.status(statusCode).render('training/list', vm);
    };

    if (!req.file) {
      return reloadWith({ statusCode: 400, importError: 'No file uploaded.' });
    }

    const originalName = req.file.originalname.toLowerCase();
    const isExcel = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
    const isCsv = originalName.endsWith('.csv');

    if (!isExcel && !isCsv) {
      return reloadWith({
        statusCode: 400,
        importError: 'Unsupported file type. Please upload CSV or Excel (.xlsx).',
      });
    }

    const rosterProfiles = await StaffProfile.findAll({
      attributes: ['employeeId'],
      where: { employeeId: { [Op.ne]: null } },
    });

    const validEmployeeIds = new Set(
      rosterProfiles
        .map((p) => sanitizeText(p.employeeId))
        .filter((x) => x !== '')
    );

    let rows = [];
    try {
      if (isExcel) {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      } else {
        const text = req.file.buffer.toString('utf8');
        rows = parse(text, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      }
    } catch (err) {
      console.error('TRAINING IMPORT → parse error:', err);
      return reloadWith({
        statusCode: 400,
        importError: 'Failed to parse file. Check format and headers.',
      });
    }

    let created = 0;
    let errors = 0;
    let skippedNotInRoster = 0;

    const errorDetails = [];
    const skippedDetails = [];

    for (const raw of rows) {
      const row = normalizeTrainingRow(raw);

      if (!row.employeeId || !row.courseName) {
        errors++;
        errorDetails.push(
          `Missing required fields (Employee ID and Course Name). employeeId="${row.employeeId || 'N/A'}", course="${row.courseName || 'N/A'}".`
        );
        continue;
      }

      if (!validEmployeeIds.has(row.employeeId)) {
        skippedNotInRoster++;
        if (skippedDetails.length < 8) {
          skippedDetails.push(
            `Skipped (not in User Management roster): employeeId="${row.employeeId}", course="${row.courseName}".`
          );
        }
        continue;
      }

      try {
        await Training.create({
          employeeId: row.employeeId,
          employeeName: row.employeeName || null,
          courseName: row.courseName,
          courseType: row.courseType || null,
          overallProgress: row.overallProgress != null ? row.overallProgress : null,
          startDate: row.startDate || null,
          endDate: row.endDate || null,
          certificationFrequency: row.certificationFrequency || null,
        });
        created++;
      } catch (err) {
        console.error('TRAINING IMPORT → row error:', err);
        errors++;
        errorDetails.push(
          `Error importing course="${row.courseName}" for employeeId="${row.employeeId}": ${err.message}`
        );
      }
    }

    await recomputeDuplicateFlags();

    const summaryLines = [];
    summaryLines.push(`TRAINING IMPORT → Records created: ${created}`);
    summaryLines.push(`TRAINING IMPORT → Skipped (not in roster): ${skippedNotInRoster}`);
    summaryLines.push(`TRAINING IMPORT → Errors: ${errors}`);

    if (skippedDetails.length > 0) {
      summaryLines.push('');
      summaryLines.push('Sample skipped rows:');
      skippedDetails.forEach((line) => summaryLines.push(`- ${line}`));
      if (skippedNotInRoster > skippedDetails.length) {
        summaryLines.push(`...and ${skippedNotInRoster - skippedDetails.length} more skipped`);
      }
    }

    if (errorDetails.length > 0) {
      summaryLines.push('');
      summaryLines.push('Sample errors:');
      errorDetails.slice(0, 5).forEach((line) => summaryLines.push(`- ${line}`));
      if (errorDetails.length > 5) {
        summaryLines.push(`...and ${errorDetails.length - 5} more errors`);
      }
    }

    return reloadWith({
      statusCode: 200,
      importSummary: summaryLines.join('\n'),
      importError: null,
    });
  }
);

router.post(
  '/purge',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  async (req, res) => {
    try {
      await Training.destroy({ where: {} });
      await recomputeDuplicateFlags();
      res.redirect('/training');
    } catch (err) {
      console.error('TRAINING PURGE ERROR:', err);
      res.status(500).send('Error purging all training records.');
    }
  }
);

export default router;