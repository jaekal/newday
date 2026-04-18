// src/routes/goals.js
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { Goal, User, GoalCheckIn } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';
import { computeGoalMeta } from '../utils/goals.js';
import { createAuditLog } from '../utils/auditLogger.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

const ALLOWED_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'ON_HOLD'];
const ALLOWED_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

function clampProgress(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeStatus(value, fallback = 'OPEN') {
  const s = String(value || '').trim().toUpperCase();
  return ALLOWED_STATUSES.includes(s) ? s : fallback;
}

function normalizePriority(value) {
  const p = String(value || '').trim().toUpperCase();
  return ALLOWED_PRIORITIES.includes(p) ? p : null;
}

function normalizeCategory(value) {
  const v = String(value || '').trim().toUpperCase();
  return v || null;
}

function normalizeText(value) {
  const v = String(value || '').trim();
  return v || null;
}

function currentActorId(req) {
  return req.session?.user?.id || req.user?.id || null;
}

async function getSessionActor(req) {
  const id = req.session?.userId;
  if (!id) return null;
  return User.findByPk(id, { attributes: ['id', 'username', 'email', 'role'] });
}

async function loadLatestCheckInMap(goalIds) {
  const map = {};
  if (!goalIds.length) return map;

  const rows = await GoalCheckIn.findAll({
    where: { goalId: goalIds },
    include: [{ model: User, as: 'Author' }],
    order: [['createdAt', 'DESC']],
  });

  for (const row of rows) {
    const plain = row.get({ plain: true });
    if (!map[plain.goalId]) {
      map[plain.goalId] = plain;
    }
  }

  return map;
}

async function loadGoalsWithMeta() {
  const goals = await Goal.findAll({
    include: [{ model: User, as: 'Owner' }],
    order: [
      ['dueDate', 'ASC'],
      ['createdAt', 'DESC'],
    ],
  });

  const plainGoals = goals.map((g) => g.get({ plain: true }));
  const latestCheckInMap = await loadLatestCheckInMap(plainGoals.map((g) => g.id));

  return plainGoals.map((plain) => {
    plain.meta = computeGoalMeta(plain);
    plain.latestCheckIn = latestCheckInMap[plain.id] || null;
    return plain;
  });
}

async function loadStaffOptions() {
  return User.findAll({
    where: { role: 'STAFF' },
    order: [['name', 'ASC']],
  });
}

async function loadOwnerGoalStats() {
  const goals = await Goal.findAll({
    include: [{ model: User, as: 'Owner' }],
    order: [['createdAt', 'DESC']],
  });

  const stats = {};

  goals.forEach((goalModel) => {
    const goal = goalModel.get({ plain: true });
    const ownerId = goal.ownerId;
    if (!ownerId) return;

    const meta = computeGoalMeta(goal);

    if (!stats[ownerId]) {
      stats[ownerId] = {
        totalOpen: 0,
        atRisk: 0,
        overdue: 0,
        done: 0,
        onHold: 0,
      };
    }

    const s = stats[ownerId];
    const status = String(goal.status || '').toUpperCase();

    if (status === 'DONE') s.done += 1;
    else if (status === 'ON_HOLD') s.onHold += 1;
    else s.totalOpen += 1;

    if (meta.healthKey === 'WARN' || meta.healthKey === 'RISK') s.atRisk += 1;
    if (meta.isOverdue) s.overdue += 1;
  });

  return stats;
}

// GET /goals
router.get('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const goals = await loadGoalsWithMeta();
  res.render('goals/list', {
    goals,
    importSummary: null,
    importError: null,
  });
});

// GET /goals/new
router.get('/new', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const [staff, ownerGoalStats] = await Promise.all([
    loadStaffOptions(),
    loadOwnerGoalStats(),
  ]);

  const defaultOwnerId = req.query.ownerId ? Number(req.query.ownerId) : null;

  res.render('goals/new', {
    staff,
    defaultOwnerId,
    ownerGoalStats,
  });
});

// POST /goals
router.post('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const {
    title,
    description,
    ownerId,
    dueDate,
    category,
    priority,
    type: goalType,
    successCriteria,
    measure,
  } = req.body;

  const VALID_GOAL_TYPES = ['PERFORMANCE', 'DEVELOPMENT', 'PROJECT'];
  const normalizedType = goalType && VALID_GOAL_TYPES.includes(String(goalType).toUpperCase())
    ? String(goalType).toUpperCase() : 'DEVELOPMENT';

  const goal = await Goal.create({
    title: String(title || '').trim(),
    description: normalizeText(description),
    ownerId: Number(ownerId),
    dueDate: normalizeText(dueDate),
    category: normalizeCategory(category),
    priority: normalizePriority(priority),
    type: normalizedType,
    successCriteria: normalizeText(successCriteria),
    measure: normalizeText(measure),
    progress: 0,
    status: 'OPEN',
  });

  await GoalCheckIn.create({
    goalId: goal.id,
    userId: currentActorId(req),
    note: 'Goal created.',
    progressSnapshot: 0,
    statusSnapshot: 'OPEN',
    entryType: 'SYSTEM',
  });

  const actor = await getSessionActor(req);
  await createAuditLog({
    req,
    actorUser: actor,
    actionType: 'CREATE',
    entityType: 'GOAL',
    entityId: goal.id,
    targetName: goal.title,
    summary: `Goal created: "${goal.title}"`,
    details: { ownerId: goal.ownerId, priority: goal.priority, dueDate: goal.dueDate, category: goal.category },
  });

  res.redirect('/goals');
});

// GET /goals/:id
router.get('/:id', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const goalModel = await Goal.findByPk(req.params.id, {
    include: [{ model: User, as: 'Owner' }],
  });

  if (!goalModel) return res.status(404).send('Goal not found');

  const goal = goalModel.get({ plain: true });
  goal.meta = computeGoalMeta(goal);

  const checkIns = await GoalCheckIn.findAll({
    where: { goalId: goal.id },
    include: [{ model: User, as: 'Author' }],
    order: [['createdAt', 'DESC']],
  });

  const plainCheckIns = checkIns.map((c) => c.get({ plain: true }));

  res.render('goals/show', {
    goal,
    checkIns: plainCheckIns,
  });
});

// GET /goals/:id/edit
router.get('/:id/edit', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const [goal, staff, ownerGoalStats] = await Promise.all([
    Goal.findByPk(req.params.id),
    loadStaffOptions(),
    loadOwnerGoalStats(),
  ]);

  if (!goal) return res.status(404).send('Goal not found');

  res.render('goals/edit', {
    goal: goal.get({ plain: true }),
    staff,
    ownerGoalStats,
  });
});

// POST /goals/:id/update
router.post('/:id/update', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const goalId = Number(req.params.id);
  const existing = await Goal.findByPk(goalId);
  if (!existing) return res.status(404).send('Goal not found');

  const {
    title,
    description,
    ownerId,
    status,
    progress,
    dueDate,
    category,
    priority,
    type: goalType,
    successCriteria,
    measure,
  } = req.body;

  const VALID_GOAL_TYPES = ['PERFORMANCE', 'DEVELOPMENT', 'PROJECT'];
  const normalizedType = goalType && VALID_GOAL_TYPES.includes(String(goalType).toUpperCase())
    ? String(goalType).toUpperCase() : (existing.type || 'DEVELOPMENT');

  let finalStatus = normalizeStatus(status);
  let finalProgress = clampProgress(progress);

  if (finalProgress >= 100 && finalStatus !== 'ON_HOLD') {
    finalStatus = 'DONE';
  }

  if (finalStatus === 'DONE' && finalProgress < 100) {
    finalProgress = 100;
  }

  await Goal.update(
    {
      title: String(title || '').trim(),
      description: normalizeText(description),
      ownerId: Number(ownerId),
      status: finalStatus,
      progress: finalProgress,
      dueDate: normalizeText(dueDate),
      category: normalizeCategory(category),
      priority: normalizePriority(priority),
      type: normalizedType,
      successCriteria: normalizeText(successCriteria),
      measure: normalizeText(measure),
    },
    { where: { id: goalId } }
  );

  await GoalCheckIn.create({
    goalId,
    userId: currentActorId(req),
    note: 'Goal details updated.',
    progressSnapshot: finalProgress,
    statusSnapshot: finalStatus,
    entryType: 'SYSTEM',
  });

  const actor = await getSessionActor(req);
  await createAuditLog({
    req,
    actorUser: actor,
    actionType: 'UPDATE',
    entityType: 'GOAL',
    entityId: goalId,
    targetName: String(title || '').trim(),
    summary: `Goal updated: status=${finalStatus}, progress=${finalProgress}%`,
    details: { status: finalStatus, progress: finalProgress, dueDate: normalizeText(dueDate), priority: normalizePriority(priority) },
  });

  res.redirect('/goals');
});

// POST /goals/:id/check-ins
router.post('/:id/check-ins', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  try {
    const goalId = Number(req.params.id);
    if (!Number.isFinite(goalId)) return res.status(400).send('Invalid goal id');

    const goal = await Goal.findByPk(goalId);
    if (!goal) return res.status(404).send('Goal not found');

    const rawStatus = normalizeStatus(req.body.status || goal.status);
    let progressNum = clampProgress(req.body.progress ?? goal.progress);
    const note = normalizeText(req.body.note);

    let finalStatus = rawStatus;
    let finalProgress = progressNum;

    if (finalProgress >= 100 && finalStatus !== 'ON_HOLD') {
      finalStatus = 'DONE';
    }

    if (finalStatus === 'DONE' && finalProgress < 100) {
      finalProgress = 100;
    }

    await Goal.update(
      {
        status: finalStatus,
        progress: finalProgress,
      },
      { where: { id: goalId } }
    );

    await GoalCheckIn.create({
      goalId,
      userId: currentActorId(req),
      note,
      progressSnapshot: finalProgress,
      statusSnapshot: finalStatus,
      entryType: 'MANUAL',
    });

    return res.redirect(`/goals/${goalId}`);
  } catch (err) {
    console.error('GOAL CHECK-IN ERROR:', err);
    return res.status(500).send('Failed to save goal check-in.');
  }
});

// POST /goals/:id/quick-update
router.post('/:id/quick-update', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  try {
    const goalId = Number(req.params.id);
    if (!Number.isFinite(goalId)) return res.status(400).send('Invalid goal id');

    const goal = await Goal.findByPk(goalId);
    if (!goal) return res.status(404).send('Goal not found');

    const status = normalizeStatus(req.body.status);
    const progressNum = clampProgress(req.body.progress);

    let finalStatus = status;
    let finalProgress = progressNum;

    if (finalProgress >= 100 && status !== 'ON_HOLD') {
      finalStatus = 'DONE';
    }

    if (finalStatus === 'DONE' && finalProgress < 100) {
      finalProgress = 100;
    }

    await Goal.update(
      { status: finalStatus, progress: finalProgress },
      { where: { id: goalId } }
    );

    await GoalCheckIn.create({
      goalId,
      userId: currentActorId(req),
      note: `Quick update saved. Status: ${finalStatus.replace(/_/g, ' ')}. Progress: ${finalProgress}%.`,
      progressSnapshot: finalProgress,
      statusSnapshot: finalStatus,
      entryType: 'QUICK_UPDATE',
    });

    const ref = req.get('referer');
    if (ref && typeof ref === 'string' && ref.includes('/goals')) {
      return res.redirect(ref);
    }
    return res.redirect('/goals');
  } catch (err) {
    console.error('GOALS QUICK UPDATE ERROR:', err);
    return res.status(500).send('Failed to quick update goal.');
  }
});

// POST /goals/:id/delete
router.post('/:id/delete', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const existing = await Goal.findByPk(req.params.id);
  const actor = await getSessionActor(req);
  await Goal.destroy({ where: { id: req.params.id } });
  await createAuditLog({
    req,
    actorUser: actor,
    actionType: 'DELETE',
    entityType: 'GOAL',
    entityId: req.params.id,
    targetName: existing?.title || null,
    summary: `Goal deleted: "${existing?.title || req.params.id}"`,
  });
  res.redirect('/goals');
});

// POST /goals/import
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      const goals = await loadGoalsWithMeta();
      return res.status(400).render('goals/list', {
        goals,
        importSummary: null,
        importError: 'No file uploaded.',
      });
    }

    const originalName = req.file.originalname.toLowerCase();
    const isExcel = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
    const isCsv = originalName.endsWith('.csv');

    if (!isExcel && !isCsv) {
      const goals = await loadGoalsWithMeta();
      return res.status(400).render('goals/list', {
        goals,
        importSummary: null,
        importError: 'Unsupported file type. Please upload CSV or Excel (.xlsx).',
      });
    }

    let rows = [];
    try {
      if (isExcel) {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } else {
        const text = req.file.buffer.toString('utf8');
        rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
      }
    } catch (err) {
      console.error('GOAL IMPORT → parse error:', err);
      const goals = await loadGoalsWithMeta();
      return res.status(400).render('goals/list', {
        goals,
        importSummary: null,
        importError: 'Failed to parse file. Check format and headers.',
      });
    }

    let created = 0;
    let errors = 0;
    const errorDetails = [];

    for (const raw of rows) {
      const row = {};
      Object.keys(raw).forEach((key) => {
        row[key.trim()] = typeof raw[key] === 'string' ? raw[key].trim() : raw[key];
      });

      const title = row.title;
      const ownerUsername = row.ownerUsername || '';
      const ownerEmail = row.ownerEmail || '';
      const description = row.description || '';
      const status = normalizeStatus(row.status || 'OPEN');
      const progress = clampProgress(row.progress);
      const dueDate = normalizeText(row.dueDate);
      const category = normalizeCategory(row.category);
      const priority = normalizePriority(row.priority);
      const successCriteria = normalizeText(row.successCriteria);
      const measure = normalizeText(row.measure);

      if (!title || (!ownerUsername && !ownerEmail)) {
        errors++;
        errorDetails.push(`Missing title or owner (username/email) for row: "${title || 'N/A'}"`);
        continue;
      }

      try {
        let owner = null;
        if (ownerUsername) owner = await User.findOne({ where: { username: ownerUsername } });
        else if (ownerEmail) owner = await User.findOne({ where: { email: ownerEmail } });

        if (!owner) {
          errors++;
          errorDetails.push(`Owner not found for goal "${title}" (username=${ownerUsername}, email=${ownerEmail})`);
          continue;
        }

        const goal = await Goal.create({
          title,
          description: normalizeText(description),
          ownerId: owner.id,
          status,
          progress,
          dueDate,
          category,
          priority,
          successCriteria,
          measure,
        });

        await GoalCheckIn.create({
          goalId: goal.id,
          userId: currentActorId(req),
          note: 'Goal imported.',
          progressSnapshot: progress,
          statusSnapshot: status,
          entryType: 'SYSTEM',
        });

        created++;
      } catch (err) {
        console.error('GOAL IMPORT → row error:', err);
        errors++;
        errorDetails.push(`Error creating goal "${title}": ${err.message}`);
      }
    }

    const actor = await getSessionActor(req);
    await createAuditLog({
      req,
      actorUser: actor,
      actionType: 'IMPORT',
      entityType: 'GOAL',
      summary: `Goal import completed: ${created} created, ${errors} errors`,
      details: { created, errors, file: req.file.originalname, errorSamples: errorDetails.slice(0, 5) },
    });

    const goals = await loadGoalsWithMeta();
    const summaryLines = [];
    summaryLines.push(`Created: ${created}`);
    summaryLines.push(`Errors: ${errors}`);
    if (errorDetails.length > 0) {
      summaryLines.push('Some errors:');
      errorDetails.slice(0, 5).forEach((line) => summaryLines.push(`- ${line}`));
      if (errorDetails.length > 5) summaryLines.push(`...and ${errorDetails.length - 5} more`);
    }

    return res.render('goals/list', {
      goals,
      importSummary: summaryLines.join('\n'),
      importError: null,
    });
  }
);

export default router;