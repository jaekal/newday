// routes/employees.js
import express from 'express';
import Joi from 'joi';
import employeeService from '../services/employeeService.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { appendAudit } from '../utils/audit.js';
import { PATHS } from '../config/path.js';
import { loadJSON } from '../utils/fileUtils.js';
import { resolveEmployeeAliases } from '../utils/employeeAliases.js';
import { s, lc } from '../utils/text.js';

const router = express.Router();
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const shiftSchema = Joi.alternatives().try(
  Joi.number().integer().min(1),
  Joi.string().trim().uppercase().valid('WKND')
).default(1);

/* ───────── validation ───────── */
const upsertSchema = Joi.object({
  body: Joi.object({
    originalId: Joi.string().allow(''),
    id: Joi.string().required(),
    name: Joi.string().required(),
    role: Joi.string().allow(''),
    building: Joi.string().allow(''),
    shift: shiftSchema,
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const deleteSchema = Joi.object({
  params: Joi.object({ id: Joi.string().required() }),
  body: Joi.object({}),
  query: Joi.object({}),
});

const listSchema = Joi.object({
  query: Joi.object({
    q: Joi.string().allow(''),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
  }),
  body: Joi.object({}),
  params: Joi.object({}),
});

const getOneSchema = Joi.object({
  params: Joi.object({ id: Joi.string().required() }),
  body: Joi.object({}),
  query: Joi.object({}),
});

const aliasesSchema = Joi.object({
  params: Joi.object({ id: Joi.string().required() }),
  body: Joi.object({}),
  query: Joi.object({}),
});

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(
    { body: req.body, params: req.params, query: req.query },
    { abortEarly: false, allowUnknown: true }
  );
  if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });
  req.validatedBody = value.body;
  req.validatedParams = value.params;
  req.validatedQuery = value.query;
  next();
};

/* ───────── helpers ───────── */
const EMPLOYEE_PATH = PATHS.EMPLOYEE_PATH;
const AUDIT_LOG_PATH = PATHS.AUDIT_LOG_PATH;

function computeChanges(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (before[k] !== after[k]) out.push({ field: k, from: before[k], to: after[k] });
  }
  return out;
}

export default (io, _app) => {
  // LIST
  router.get('/', validate(listSchema), ah(async (req, res) => {
    const q = lc(req.validatedQuery.q || '');
    const page = parseInt(req.validatedQuery.page || '', 10);
    const limit = Math.min(500, parseInt(req.validatedQuery.limit || '', 10) || 100);

    const all = await loadJSON(EMPLOYEE_PATH, []);
    const filtered = q
      ? all.filter((e) =>
          [e.id, e.name, e.role, e.building].filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : all;

    if (!Number.isFinite(page)) return res.json(filtered);

    const total = filtered.length;
    const start = (Math.max(1, page) - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return res.json({ items, total, page: Math.max(1, page), limit });
  }));

  router.get('/aliases/:id', requireAuth, validate(aliasesSchema), ah(async (req, res) => {
    const id = lc(req.validatedParams.id);
    const aliases = await resolveEmployeeAliases(id);
    res.json({ id, aliases, ids: [id, ...aliases] });
  }));

  // GET one employee
  router.get('/:id', validate(getOneSchema), ah(employeeService.getEmployee));

  // Upsert employee (admin + lead)
  router.post(
    '/update',
    requireAuth,
    requireRole('admin', 'lead'),
    validate(upsertSchema),
    ah(async (req, res, next) => {
      // ensure service reads validated body
      req.body = req.validatedBody;

      const beforeList = await loadJSON(EMPLOYEE_PATH, []);
      const targetIdLC = lc(req.validatedBody.id);
      const before = beforeList.find(e => lc(e.id) === targetIdLC) || {};

      const capture = { payload: null, statusCode: 200 };
      const interceptRes = {
        json(payload) {
          capture.payload = payload;
          if (!res.headersSent) res.json(payload);
        },
        status(code) {
          capture.statusCode = code;
          res.status(code);
          return this;
        }
      };

      await employeeService.addOrUpdateEmployee(req, interceptRes, next);
      const after = capture?.payload?.employee || null;

      const actor = req.session?.user?.id ?? 'system';
      await appendAudit({
        path: AUDIT_LOG_PATH,
        entry: {
          action: 'updateEmployee',
          actor,
          targetType: 'employee',
          targetId: targetIdLC,
          changes: computeChanges(before, after || {}),
          time: new Date().toISOString(),
        },
      }).catch(() => {});

      io?.emit?.('employeesUpdated', { resource: 'employees', id: targetIdLC });
      io?.emit?.('auditUpdated', { resource: 'employees' });
    })
  );

  // Delete employee (admin only)
  router.delete(
    '/delete/:id',
    requireAuth,
    requireRole('admin'),
    validate(deleteSchema),
    ah(async (req, res, next) => {
      req.params = { ...req.params, ...req.validatedParams };

      const targetIdLC = lc(req.validatedParams.id);
      const beforeList = await loadJSON(EMPLOYEE_PATH, []);
      const before = beforeList.find(e => lc(e.id) === targetIdLC) || null;

      await employeeService.deleteEmployee(req, res, next);

      const actor = req.session?.user?.id ?? 'system';
      await appendAudit({
        path: AUDIT_LOG_PATH,
        entry: {
          action: 'deleteEmployee',
          actor,
          targetType: 'employee',
          targetId: targetIdLC,
          changes: computeChanges(before || {}, {}),
          time: new Date().toISOString(),
        },
      }).catch(() => {});

      io?.emit?.('employeesUpdated', { resource: 'employees', id: targetIdLC });
      io?.emit?.('auditUpdated', { resource: 'employees' });
    })
  );

  return router;
};
