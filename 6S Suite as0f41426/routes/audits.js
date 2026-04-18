// routes/audits.js
import express from 'express';
import Joi from 'joi';
import { getAuditCatalogTemplates } from '../config/templateCatalog.js';
import taskService from '../services/taskService.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { normalizeBuilding } from '../utils/buildings.js';
import { loadJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import { parseDrtqExport } from '../utils/drtqImport.js';
import { s, lc } from '../utils/text.js';
import { ownerFromRequest } from '../utils/taskRequest.js';

// Roles allowed to mutate audit tasks (create/update/move/delete).
const requireAuditWriter = requireRole('admin', 'lead', 'management', 'coordinator');
const shiftSchema = Joi.alternatives().try(
  Joi.number().integer().min(1).max(3),
  Joi.string().trim().uppercase().valid('WKND')
);
const dedupeTemplates = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${lc(item.title)}|${lc(item.kind)}|${lc(item.weekMode)}|${lc(item.shiftMode)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const templateSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow(''),
  kind: Joi.string().valid('daily', 'weekly', 'monthly').required(),
  shiftMode: Joi.string()
    .valid('per-shift', 'once')
    .when('kind', { is: 'daily', then: Joi.required(), otherwise: Joi.optional() }),
  weekMode: Joi.string()
    .valid('weekly', 'biweekly')
    .when('kind', { is: 'weekly', then: Joi.required(), otherwise: Joi.optional() }),
  category: Joi.string().allow('').optional(),
});

const createSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow('').default(''),
  bucket: Joi.string().valid('todo', 'doing', 'blocked', 'done').default('todo'),
  dueDate: Joi.string().allow('').default(''),
  kind: Joi.string().valid('daily', 'weekly', 'monthly').default('daily'),
  shift: shiftSchema.allow(null).optional(),
  category: Joi.string().allow('').default(''),
  ownerId: Joi.string().allow('').optional(),
  ownerName: Joi.string().allow('').optional(),
  ownerLabel: Joi.string().allow('').optional(),
  building: Joi.string().allow('').optional(),
  meta: Joi.object().unknown(true).default({}),
});

const selectiveInstantiateSchema = Joi.object({
  templateIds: Joi.array().items(Joi.string()).min(1).required(),
  shift: shiftSchema.allow(null).optional(),
  ownerId: Joi.string().allow('').optional(),
  ownerName: Joi.string().allow('').optional(),
  ownerLabel: Joi.string().allow('').optional(),
  building: Joi.string().allow('').optional(),
});

const moveSchema = Joi.object({
  id: Joi.string().required(),
  bucket: Joi.string().valid('todo', 'doing', 'blocked', 'done').required(),
});

const toolVerifySchema = Joi.object({
  serialNumbers: Joi.array().items(Joi.string().trim().allow('')).required(),
  classifications: Joi.array()
    .items(Joi.string().trim().lowercase().valid('manual', 'wired', 'wireless'))
    .min(1)
    .required(),
});

const torqueImportSchema = Joi.object({
  fileName: Joi.string().trim().allow('').default(''),
  content: Joi.string().min(20).max(500000).required(),
});

const updateSchema = Joi.object({
  title: Joi.string(),
  description: Joi.string().allow(''),
  bucket: Joi.string().valid('todo', 'doing', 'blocked', 'done'),
  dueDate: Joi.string().allow(''),
  priority: Joi.string().allow(''),
  shift: shiftSchema.allow(null),
  kind: Joi.string().valid('daily', 'weekly', 'monthly', 'project'),
  shiftMode: Joi.string().valid('per-shift', 'once'),
  weekMode: Joi.string().valid('weekly', 'biweekly'),
  category: Joi.string().allow(''),
  ownerId: Joi.string().allow(''),
  ownerName: Joi.string().allow(''),
  ownerLabel: Joi.string().allow(''),
  building: Joi.string().allow(''),
  meta: Joi.object().unknown(true),
}).min(1);

function normalizeSerial(value) {
  return s(value).replace(/\u00A0/g, ' ').replace(/[\s-]+/g, '').toUpperCase();
}

function normalizeClassification(value) {
  return lc(value);
}

export default function auditsRouter(io) {
  const router = express.Router();

  router.get('/', requireAuth, (_req, res) => {
    res.redirect(302, '/projects?domain=audit');
  });

  router.get(['/index.html', '/audits.html'], requireAuth, (_req, res) => {
    res.redirect(302, '/projects?domain=audit');
  });

  router.get('/api', requireAuth, async (req, res, next) => {
    try {
      const kind  = lc(req.query.kind || '');
      const shift = s(req.query.shift || '').toUpperCase() || null;
      const building = normalizeBuilding(req.query.building, { allowBlank: true });

      const all = await taskService.getAll();
      let audits = all.filter((t) => t.domain === 'audit' && !t.meta?.template && (!building || t.building === building));

      if (kind)  audits = audits.filter((t) => lc(t.kind) === kind);
      if (shift) audits = audits.filter((t) => !t.shift || String(t.shift).toUpperCase() === shift);

      res.json(audits);
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/api',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (req, res, next) => {
      try {
        const { error, value } = createSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: true,
        });
        if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

        const owner = ownerFromRequest(value, req.session?.user);
        const building = normalizeBuilding(value.building || value.meta?.building || req.query?.building || req.session?.user?.building, { allowBlank: false });

        const t = await taskService.createTask(req.session?.user, {
          title: value.title,
          description: value.description,
          bucket: value.bucket,
          dueDate: value.dueDate,
          building,
          domain: 'audit',
          kind: value.kind,
          shift: value.shift ?? null,
          source: s((value.meta && value.meta.source) || 'manual'),
          category: value.category || '',
          ...owner,
        meta: {
          ...(value.meta || {}),
          building,
          category: value.category || '',
          priority: s(value.meta?.priority || value.priority || ''),
          owner: owner.ownerLabel,
          ownerId: owner.ownerId,
            ownerName: owner.ownerName,
            ownerLabel: owner.ownerLabel,
          },
        });

        io?.publish?.auditUpdated?.({ id: t.id, reason: 'create' });
        res.status(201).json({ message: 'Created', task: t });
      } catch (e) {
        next(e);
      }
    }
  );

  router.get('/api/templates', requireAuth, async (_req, res, next) => {
    try {
      const catalogOnly = lc(_req.query.catalogOnly || '') === '1' || lc(_req.query.catalogOnly || '') === 'true';
      if (catalogOnly) {
        return res.json(getAuditCatalogTemplates());
      }
      const all = await taskService.getAll();
      const saved = all.filter((t) => t.domain === 'audit' && t.meta?.template === true);
      res.json(dedupeTemplates(saved.concat(getAuditCatalogTemplates())));
    } catch (e) {
      next(e);
    }
  });

  router.post(
    '/api/template',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (req, res, next) => {
      try {
        const { error, value } = templateSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: true,
        });
        if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

        const actor = taskService.actorFrom(req.session?.user);
        const owner = ownerFromRequest({}, req.session?.user);

        const t = await taskService.createTask(req.session?.user, {
          title: value.title,
          description: value.description,
          building: normalizeBuilding(value.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
          domain: 'audit',
          kind: value.kind,
          shiftMode: value.shiftMode,
          weekMode: value.weekMode,
          source: 'manual',
          bucket: 'todo',
          category: value.category || '',
          ...owner,
          meta: {
            template: true,
            building: normalizeBuilding(value.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
            category: value.category || '',
            owner: owner.ownerLabel,
            ownerId: owner.ownerId,
            ownerName: owner.ownerName,
            ownerLabel: owner.ownerLabel,
            templateCreatedBy: actor,
          },
        });

        io?.publish?.auditUpdated?.({ id: t.id, reason: 'template.create' });
        res.status(201).json({ message: 'Template created', task: t });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post('/api/move', requireAuth, requireAuditWriter, async (req, res, next) => {
    try {
      const { error, value } = moveSchema.validate(req.body || {}, { abortEarly: false });
      if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

      const t = await taskService.moveBucket(value.id, value.bucket, { actor: req.session?.user });
      io?.publish?.auditUpdated?.({ id: value.id, reason: 'move' });
      res.json({ message: 'Moved', task: t });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/:id/tool-verify', requireAuth, async (req, res, next) => {
    try {
      const id = s(req.params.id);
      const { error, value } = toolVerifySchema.validate(req.body || {}, {
        abortEarly: false,
        allowUnknown: true,
      });
      if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

      const allTasks = await taskService.getAll();
      const audit = allTasks.find((item) => item.id === id && item.domain === 'audit');
      if (!audit) return res.status(404).json({ message: 'Audit not found' });

      const classifications = [...new Set((value.classifications || []).map(normalizeClassification))];
      const auditBuilding = normalizeBuilding(audit.building || audit.meta?.building, { allowBlank: false });
      const allTools = await loadJSON(PATHS.TOOL_PATH, []);
      const expectedInventory = allTools
        .map((tool) => ({
          serialNumber: normalizeSerial(tool.serialNumber || tool.serial || tool.SerialNumber),
          classification: normalizeClassification(tool.classification),
          building: normalizeBuilding(tool.building || auditBuilding, { allowBlank: false }),
        }))
        .filter((tool) => tool.serialNumber && tool.building === auditBuilding && classifications.includes(tool.classification));

      const expectedSerials = [...new Set(expectedInventory.map((tool) => tool.serialNumber))].sort();
      const expectedSet = new Set(expectedSerials);

      const scanCounts = new Map();
      for (const rawSerial of value.serialNumbers || []) {
        const serialNumber = normalizeSerial(rawSerial);
        if (!serialNumber) continue;
        scanCounts.set(serialNumber, (scanCounts.get(serialNumber) || 0) + 1);
      }

      const scannedSerials = [...scanCounts.keys()].sort();
      const scannedSet = new Set(scannedSerials);
      const confirmed = expectedSerials.filter((serialNumber) => scannedSet.has(serialNumber));
      const missing = expectedSerials.filter((serialNumber) => !scannedSet.has(serialNumber));
      const unexpected = scannedSerials.filter((serialNumber) => !expectedSet.has(serialNumber));
      const duplicateScans = [...scanCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([serialNumber, count]) => ({ serialNumber, count }))
        .sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));

      const verification = {
        type: 'tool-verify',
        label: audit.meta?.moduleToolLabel || 'Tool Verify',
        auditType: 'Screwdriver and Drill Audit',
        building: auditBuilding,
        classifications,
        scannedAt: new Date().toISOString(),
        scannedBy: taskService.actorFrom(req.session?.user),
        expectedCount: expectedSerials.length,
        scannedCount: scannedSerials.length,
        confirmedCount: confirmed.length,
        missingCount: missing.length,
        unexpectedCount: unexpected.length,
        duplicateCount: duplicateScans.length,
        allConfirmed: missing.length === 0 && unexpected.length === 0 && expectedSerials.length > 0,
        confirmed,
        missing,
        unexpected,
        duplicateScans,
        scannedSerials,
      };

      const updated = await taskService.updateTask(id, {
        meta: {
          toolVerify: verification,
          moduleTool: 'tool-verify',
          moduleToolLabel: audit.meta?.moduleToolLabel || 'Tool Verify',
        },
      }, { actor: req.session?.user });

      io?.publish?.auditUpdated?.({ id, reason: 'tool_verify' });
      res.json({ message: 'Verification complete', verification, task: updated });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/:id/torque-import', requireAuth, async (req, res, next) => {
    try {
      const id = s(req.params.id);
      const { error, value } = torqueImportSchema.validate(req.body || {}, {
        abortEarly: false,
        allowUnknown: true,
      });
      if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

      const allTasks = await taskService.getAll();
      const audit = allTasks.find((item) => item.id === id && item.domain === 'audit');
      if (!audit) return res.status(404).json({ message: 'Audit not found' });

      const torqueImport = parseDrtqExport(value.content, value.fileName);
      torqueImport.auditType = audit.title || 'Torque calibration';
      torqueImport.importedBy = taskService.actorFrom(req.session?.user);
      torqueImport.building = normalizeBuilding(audit.building || audit.meta?.building, { allowBlank: false });
      const torqueImportHistory = [
        torqueImport,
        ...((Array.isArray(audit.meta?.torqueImportHistory) ? audit.meta.torqueImportHistory : [])),
      ].slice(0, 10);

      const updated = await taskService.updateTask(id, {
        meta: {
          torqueImport,
          torqueImportHistory,
          moduleTool: 'torque-import',
          moduleToolLabel: audit.meta?.moduleToolLabel || 'Torque Import',
        },
      }, { actor: req.session?.user });

      io?.publish?.auditUpdated?.({ id, reason: 'torque_import' });
      res.json({ message: 'Torque import complete', torqueImport, task: updated });
    } catch (e) {
      next(e);
    }
  });

  router.put('/api/:id', requireAuth, requireAuditWriter, async (req, res, next) => {
    try {
      const id = s(req.params.id);
      const { error, value } = updateSchema.validate(req.body || {}, {
        abortEarly: false,
        allowUnknown: true,
      });
      if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

      const patch = { ...value };

      if (patch.category != null) {
        patch.category = s(patch.category);
        patch.meta = { ...(patch.meta || {}), category: patch.category };
      }
      if (patch.priority != null) {
        patch.meta = { ...(patch.meta || {}), priority: s(patch.priority) };
        delete patch.priority;
      }
      if (patch.building != null || patch.meta?.building != null) {
        const building = normalizeBuilding(patch.building || patch.meta?.building || req.session?.user?.building, { allowBlank: false });
        patch.building = building;
        patch.meta = { ...(patch.meta || {}), building };
      }

      if (patch.ownerId != null || patch.ownerName != null || patch.ownerLabel != null) {
        const owner = ownerFromRequest(patch, req.session?.user);
        patch.meta = {
          ...(patch.meta || {}),
          ...owner,
        };
        Object.assign(patch, owner);
      }

      const updated = await taskService.updateTask(id, patch, { actor: req.session?.user });
      io?.publish?.auditUpdated?.({ id, reason: 'update' });
      res.json({ message: 'Updated', task: updated });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/:id', requireAuth, requireAuditWriter, async (req, res, next) => {
    try {
      const id = s(req.params.id);
      const patch = { ...(req.body || {}) };
      if (patch.priority != null) {
        patch.meta = { ...(patch.meta || {}), priority: s(patch.priority) };
        delete patch.priority;
      }
      if (patch.building != null || patch.meta?.building != null) {
        const building = normalizeBuilding(patch.building || patch.meta?.building || req.session?.user?.building, { allowBlank: false });
        patch.building = building;
        patch.meta = { ...(patch.meta || {}), building };
      }

      if (patch.ownerId != null || patch.ownerName != null || patch.ownerLabel != null) {
        const owner = ownerFromRequest(patch, req.session?.user);
        patch.meta = {
          ...(patch.meta || {}),
          ...owner,
        };
        Object.assign(patch, owner);
      }

      const updated = await taskService.updateTask(id, patch, { actor: req.session?.user });
      io?.publish?.auditUpdated?.({ id, reason: 'patch' });
      res.json({ message: 'Updated', task: updated });
    } catch (e) {
      next(e);
    }
  });

  router.delete(
    '/api/:id',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (req, res, next) => {
      try {
        const id = s(req.params.id);
        const removed = await taskService.deleteTask(req.session?.user, id);
        io?.publish?.auditUpdated?.({ id, reason: 'delete' });
        res.json({ message: 'Deleted', id: removed.id });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post(
    '/instantiate/selective',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (req, res, next) => {
      try {
        const { error, value } = selectiveInstantiateSchema.validate(req.body || {}, { abortEarly: false });
        if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

        const actor = taskService.actorFrom(req.session?.user);

        const owner = ownerFromRequest(value, req.session?.user);

        const created = await taskService.ensureSelectiveInstances(
          new Date(),
          value.templateIds,
          {
            shift: value.shift || null,
            actor,
            owner,
            building: normalizeBuilding(value.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
          }
        );

        if (created) io?.publish?.auditUpdated?.({ reason: 'selective_instantiate' });
        res.json({ message: 'Selective instantiate complete', created });
      } catch (e) {
        next(e);
      }
    }
  );

  return router;
}
