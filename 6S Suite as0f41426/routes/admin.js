// routes/admin.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Joi from 'joi';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { requireRole } from '../middleware/roleCheck.js';
import { appendAudit } from '../utils/audit.js';
import { queryActivity } from '../utils/activityLog.js';
import userService from '../services/userService.js';
import { PATHS } from '../config/path.js';
import { s, lc } from '../utils/text.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.use(express.json());

/* ───────── validation helpers ───────── */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(
    { body: req.body, params: req.params, query: req.query },
    { abortEarly: false, allowUnknown: true }
  );
  if (error) {
    return res.status(400).json({ message: 'Validation failed', details: error.details });
  }
  req.validatedBody = value.body;
  req.validatedParams = value.params;
  req.validatedQuery = value.query;
  next();
};

const ensureAdmin = requireRole('admin');
const ensureAdminOrLead = requireRole('admin', 'lead');
const ensurePeopleAccess = requireRole('admin', 'lead', 'management');
const ensurePeopleManagers = requireRole('admin', 'management');
const ensureSuiteUsersReaders = requireRole('admin', 'lead', 'management');

const addToolSchema = Joi.object({
  body: Joi.object({
    serialNumber: Joi.string().trim().required(),
    slot: Joi.string().allow(''),
    torque: Joi.string().allow(''),
    classification: Joi.string().allow(''),
    description: Joi.string().allow(''),
    model: Joi.string().allow(''),
    calibrationStatus: Joi.string().allow(''),
    status: Joi.string().valid('in inventory', 'being used').optional(),
    calibrationDate: Joi.string().allow(''),
    nextCalibrationDue: Joi.string().allow(''),
    toolType: Joi.string().allow(''),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const editToolSchema = Joi.object({
  body: Joi.object({
    serialNumber: Joi.string().trim().required(),
    slot: Joi.string().allow(''),
    torque: Joi.string().allow(''),
    classification: Joi.string().allow(''),
    description: Joi.string().allow(''),
    model: Joi.string().allow(''),
    calibrationStatus: Joi.string().allow(''),
    status: Joi.string().valid('in inventory', 'being used').optional(),
    calibrationDate: Joi.string().allow(''),
    nextCalibrationDue: Joi.string().allow(''),
    toolType: Joi.string().allow(''),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const deleteToolSchema = Joi.object({
  body: Joi.object({}),
  params: Joi.object({ serial: Joi.string().trim().required() }),
  query: Joi.object({}),
});

const weeklyAuditSchema = Joi.object({
  body: Joi.object({
    serials: Joi.array().items(Joi.string().trim()).default([]),
    time: Joi.string().allow(''),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const importUsersSchema = Joi.object({
  body: Joi.object({
    users: Joi.array().items(
      Joi.object({
        username: Joi.string().allow(''),
        name: Joi.string().allow(''),
        password: Joi.string().allow(''),
        role: Joi.string().allow(''),
        techId: Joi.string().allow(''),
        building: Joi.string().allow(''),
      })
    ).default([]),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

/* ───────── utilities ───────── */
function diff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].reduce((arr, k) => {
    if (before[k] !== after[k]) arr.push({ field: k, from: before[k], to: after[k] });
    return arr;
  }, []);
}

function findIndexBySerial(tools = [], serial) {
  const target = lc(serial);
  return tools.findIndex((t) => lc(t.serialNumber) === target);
}

/* ───────── router factory (needs io + app) ───────── */
export default (io, app) => {
  if (!app) throw new Error('admin router requires app instance');

  // Fall back to canonical PATHS when app.get(...) returns undefined — this
  // can happen if initData has not finished yet or (historically) failed
  // partway through, leaving the router reading from `undefined` while the
  // activity-logger middleware was happily writing to its own fallback file.
  // Keeping both ends aligned on PATHS.* prevents that silent divergence.
  const getDataPaths = () => ({
    USER:     app.get('userPath')        || PATHS.USER_PATH,
    AUDIT:    app.get('auditLogPath')    || PATHS.AUDIT_LOG_PATH,
    ACTIVITY: app.get('activityLogPath') || PATHS.ACTIVITY_LOG_PATH,
    TOOL:     app.get('toolPath')        || PATHS.TOOL_PATH,
    EMPLOYEE: app.get('employeePath')    || PATHS.EMPLOYEE_PATH,
  });

  // ─── SESSION ──────────────────────────────────────────
  router.get('/session', (req, res) => {
    const u = req.session?.user || null;
    res.json({
      authenticated: Boolean(u),
      username: u?.id || null,
      role: u?.role || null,
    });
  });

  // ─── WEEKLY AUDIT ─────────────────────────────────────
  router.post('/weeklyAudit', ensureAdmin, validate(weeklyAuditSchema), async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const { serials, time } = req.validatedBody;
      await appendAudit({
        path: DATA_PATHS.AUDIT,
        entry: {
          action: 'weeklyAudit',
          serials,
          actor: req.session?.user?.id ?? 'system',
          time: time || new Date().toISOString(),
        },
      });
      io.emit('auditUpdated', { resource: 'tools' });
      res.json({ message: 'Weekly audit recorded' });
    } catch (err) {
      req.log?.error?.({ err }, 'Weekly audit error');
      next(err);
    }
  });

  // ─── AUDIT LOG ────────────────────────────────────────
  router.get('/audit-log', ensureAdmin, async (_req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const audit = await loadJSON(DATA_PATHS.AUDIT, []);
      res.json(audit);
    } catch (err) {
      next(err);
    }
  });

  router.get('/activity', ensureAdmin, async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const filters = {
        module: req.query.module,
        actor: req.query.actor,
        q: req.query.q,
        status: req.query.status,
        range: req.query.range,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit || 250,
      };
      let initialItems = await queryActivity(DATA_PATHS.ACTIVITY, filters);
      if ((!Array.isArray(initialItems) || !initialItems.length) && DATA_PATHS.ACTIVITY) {
        const rawItems = await loadJSON(DATA_PATHS.ACTIVITY, []);
        if (Array.isArray(rawItems) && rawItems.length) {
          initialItems = rawItems.slice().reverse().slice(0, Number(filters.limit) || 250);
        }
      }
      res.render('admin/activity-ledger', {
        user: req.user || req.session?.user,
        cspNonce: res.locals.cspNonce,
        allowedTools: res.locals.allowedTools || [],
        initialItems,
        filters,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/activity/api', ensureAdmin, async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const items = await queryActivity(DATA_PATHS.ACTIVITY, {
        module: req.query.module,
        actor: req.query.actor,
        q: req.query.q,
        status: req.query.status,
        range: req.query.range,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  // Admin page
  router.get('/admin.html', ensureAdmin, (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/Screwdriver/admin.html'));
  });

  // ─── TOOL CRUD ────────────────────────────────────────
  router.post('/addTool', ensureAdmin, validate(addToolSchema), async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const t = req.validatedBody;
      const actor = req.session?.user?.id ?? 'system';

      const tools = await loadJSON(DATA_PATHS.TOOL, []);
      if (findIndexBySerial(tools, t.serialNumber) !== -1) {
        return res.status(409).json({ message: 'Tool already exists' });
      }

      const record = {
        serialNumber: s(t.serialNumber),
        slot: s(t.slot),
        torque: s(t.torque),
        classification: s(t.classification),
        description: s(t.description),
        model: s(t.model),
        toolType: s(t.toolType),
        calibrationStatus: s(t.calibrationStatus),
        status: s(t.status) || 'in inventory',
        calibrationDate: s(t.calibrationDate),
        nextCalibrationDue: s(t.nextCalibrationDue),
        operatorId: '',
        timestamp: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      tools.push(record);
      await saveJSON(DATA_PATHS.TOOL, tools);

      await appendAudit({
        path: DATA_PATHS.AUDIT,
        entry: {
          action: 'addTool',
          serialNumber: record.serialNumber,
          actor,
          changes: diff({}, record),
        },
      });

      io.emit('toolsUpdated', { resource: 'tools', serialNumbers: [record.serialNumber] });
      io.emit('auditUpdated', { resource: 'tools' });

      res.json({ message: 'Tool added', tool: record });
    } catch (err) {
      next(err);
    }
  });

  router.post('/editTool', ensureAdmin, validate(editToolSchema), async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const t = req.validatedBody;
      const actor = req.session?.user?.id ?? 'system';

      const tools = await loadJSON(DATA_PATHS.TOOL, []);
      const idx = findIndexBySerial(tools, t.serialNumber);
      if (idx === -1) return res.status(404).json({ message: 'Tool not found' });

      const before = { ...tools[idx] };

      const allowed = [
        'slot',
        'torque',
        'classification',
        'description',
        'model',
        'toolType',
        'calibrationStatus',
        'calibrationDate',
        'nextCalibrationDue',
        'status',
      ];

      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(t, k)) {
          tools[idx][k] = s(t[k]);
        }
      }

      tools[idx].updatedAt = new Date().toISOString();
      await saveJSON(DATA_PATHS.TOOL, tools);

      const changes = diff(before, tools[idx]);

      await appendAudit({
        path: DATA_PATHS.AUDIT,
        entry: {
          action: 'editTool',
          serialNumber: t.serialNumber,
          changes,
          actor,
        },
      });

      io.emit('toolsUpdated', { resource: 'tools', serialNumbers: [t.serialNumber] });
      io.emit('auditUpdated', { resource: 'tools' });

      res.json({ message: 'Tool updated', tool: tools[idx] });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/deleteTool/:serial', ensureAdmin, validate(deleteToolSchema), async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const { serial } = req.validatedParams;
      const actor = req.session?.user?.id ?? 'system';

      const tools = await loadJSON(DATA_PATHS.TOOL, []);
      const idx = findIndexBySerial(tools, serial);
      if (idx === -1) return res.status(404).json({ message: 'Tool not found' });

      const removed = tools.splice(idx, 1)[0];
      await saveJSON(DATA_PATHS.TOOL, tools);

      await appendAudit({
        path: DATA_PATHS.AUDIT,
        entry: {
          action: 'deleteTool',
          serialNumber: removed.serialNumber,
          changes: diff(removed, {}),
          actor,
        },
      });

      io.emit('toolsUpdated', { resource: 'tools', serialNumbers: [removed.serialNumber] });
      io.emit('auditUpdated', { resource: 'tools' });

      res.json({ message: 'Tool deleted', serialNumber: removed.serialNumber });
    } catch (err) {
      next(err);
    }
  });

  // ── User management ────────────────────────────────────
  router.get('/users', ensureSuiteUsersReaders, async (req, res, next) => {
    try {
      await userService.getAllUsers(req, res, next);
    } catch (e) {
      next(e);
    }
  });

  router.post('/users', ensurePeopleManagers, async (req, res, next) => {
    try {
      await userService.createUser(req, res, next);
    } catch (e) {
      next(e);
    }
  });

  router.post('/users/import', ensurePeopleManagers, validate(importUsersSchema), async (req, res, next) => {
    try {
      const DATA_PATHS = getDataPaths();
      const rows = Array.isArray(req.validatedBody.users) ? req.validatedBody.users : [];
      const actor = req.session?.user?.id ?? 'system';

      if (!rows.length) {
        return res.status(400).json({ message: 'No users provided for import' });
      }

      const results = [];
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const raw of rows) {
        const payload = {
          username: s(raw.username),
          name: s(raw.name),
          password: s(raw.password),
          role: lc(raw.role || 'user'),
          techId: s(raw.techId),
          building: s(raw.building),
        };

        if (!payload.username || !payload.password) {
          failed++;
          results.push({
            username: payload.username || '',
            status: 'failed',
            reason: 'Missing username or password',
          });
          continue;
        }

        let sent = false;
        let localStatus = 200;
        let localPayload = null;

        const fakeReq = {
          ...req,
          body: payload,
        };

        const fakeRes = {
          status(code) {
            localStatus = code;
            return this;
          },
          json(obj) {
            sent = true;
            localPayload = obj;
            return this;
          },
        };

        try {
          await userService.createUser(fakeReq, fakeRes, next);

          if (!sent) {
            failed++;
            results.push({
              username: payload.username,
              status: 'failed',
              reason: 'No response from createUser',
            });
            continue;
          }

          if (localStatus >= 200 && localStatus < 300) {
            created++;
            results.push({
              username: payload.username,
              status: 'created',
            });
          } else if (localStatus === 409) {
            skipped++;
            results.push({
              username: payload.username,
              status: 'skipped',
              reason: localPayload?.message || 'Already exists',
            });
          } else {
            failed++;
            results.push({
              username: payload.username,
              status: 'failed',
              reason: localPayload?.message || 'Create failed',
            });
          }
        } catch (err) {
          failed++;
          results.push({
            username: payload.username,
            status: 'failed',
            reason: err?.message || 'Unexpected error',
          });
        }
      }

      await appendAudit({
        path: DATA_PATHS.AUDIT,
        entry: {
          action: 'importUsers',
          actor,
          time: new Date().toISOString(),
          changes: [
            `created:${created}`,
            `skipped:${skipped}`,
            `failed:${failed}`,
          ],
        },
      }).catch(() => {});

      io.emit('auditUpdated', { resource: 'users' });

      return res.json({
        message: 'User import completed',
        created,
        skipped,
        failed,
        results,
      });
    } catch (err) {
      next(err);
    }
  });

  router.put('/users/:username', async (req, res, next) => {
    const actor = req.session?.user || null;
    if (!actor) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const actorRole = lc(actor.role);
    const targetUsername = lc(req.params.username);
    const actorUsername = lc(actor.id);

    const isAdmin = actorRole === 'admin';
    const isManagement = actorRole === 'management';
    const isLead = actorRole === 'lead';
    const isSelf = actorUsername === targetUsername;

    if (!isAdmin && !isManagement && !isLead && !isSelf) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    try {
      await userService.updateUser(req, res, next);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/users/:username', ensureAdmin, async (req, res, next) => {
    try {
      await userService.deleteUser(req, res, next);
    } catch (e) {
      next(e);
    }
  });

  return router;
};
