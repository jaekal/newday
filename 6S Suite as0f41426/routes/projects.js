// routes/projects.js  (updated)
// ────────────────────────────────────────────────────────────────────────────
// Changes from original:
//  1. GET / now serves public/projects/index.html (the new unified page)
//  2. PATCH /api/:id — true partial-update endpoint (subset of PUT)
//  3. PUT /api/:id — now also accepts priority and assignee at top-level
//     (mirrored into meta so the UI and service both see them)
//  4. listHandler now accepts domain=project filter from query params
// ────────────────────────────────────────────────────────────────────────────
import express from 'express';
import Joi from 'joi';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProjectCatalogTemplates } from '../config/templateCatalog.js';
import taskService from '../services/taskService.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { normalizeBuilding } from '../utils/buildings.js';
import { loadJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import { s, lc } from '../utils/text.js';
import { ownerFromRequest } from '../utils/taskRequest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OWNER_ROLES = new Set(['lead', 'coordinator']);

// Roles allowed to mutate project tasks. Kiosk-only users ('user') cannot
// edit or move project tasks even if they know a task id.
const requireTaskWriter = requireRole('admin', 'lead', 'management', 'coordinator');
const dedupeTemplates = (items = []) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${lc(item.title)}|${lc(item.meta?.repeatCadence)}|${lc(item.kind)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const createSchema = Joi.object({
  title:       Joi.string().required(),
  description: Joi.string().allow('').default(''),
  bucket:      Joi.string().valid('todo','doing','blocked','done').default('todo'),
  dueDate:     Joi.string().allow('').default(''),
  category:    Joi.string().allow('').default(''),
  ownerId:     Joi.string().allow('').optional(),
  ownerName:   Joi.string().allow('').optional(),
  ownerLabel:  Joi.string().allow('').optional(),
  building:    Joi.string().allow('').optional(),
  meta:        Joi.object().unknown(true).default({}),
});

const templateSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow('').default(''),
  category: Joi.string().allow('').default(''),
  ownerId: Joi.string().allow('').optional(),
  ownerName: Joi.string().allow('').optional(),
  ownerLabel: Joi.string().allow('').optional(),
  building: Joi.string().allow('').optional(),
  meta: Joi.object().unknown(true).default({}),
});

const selectiveInstantiateSchema = Joi.object({
  templateIds: Joi.array().items(Joi.string()).min(1).required(),
  title: Joi.string().allow('').optional(),
  scope: Joi.string().allow('').optional(),
  startDate: Joi.string().required(),
  targetDate: Joi.string().required(),
  notes: Joi.string().allow('').optional(),
  area: Joi.string().allow('').optional(),
  relatedRef: Joi.string().allow('').optional(),
  ownerId: Joi.string().allow('').optional(),
  ownerName: Joi.string().allow('').optional(),
  ownerLabel: Joi.string().allow('').optional(),
  building: Joi.string().allow('').optional(),
});

const moveSchema = Joi.object({
  id:     Joi.string().required(),
  bucket: Joi.string().valid('todo','doing','blocked','done').required(),
});

// PATCH accepts any subset of allowed fields
const patchSchema = Joi.object({
  title:       Joi.string(),
  description: Joi.string().allow(''),
  bucket:      Joi.string().valid('todo','doing','blocked','done'),
  dueDate:     Joi.string().allow(''),
  category:    Joi.string().allow(''),
  priority:    Joi.string().allow(''),
  assignee:    Joi.string().allow(''),
  ownerId:     Joi.string().allow(''),
  ownerName:   Joi.string().allow(''),
  ownerLabel:  Joi.string().allow(''),
  building:    Joi.string().allow(''),
  meta:        Joi.object().unknown(true),
}).min(1); // at least one field required

function parseCSV(v) {
  return new Set(s(v).split(',').map(x => lc(x)).filter(Boolean));
}
function toYMonth(d) {
  const x = new Date(d);
  if (Number.isNaN(+x)) return '';
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`;
}
function buildFacets(items) {
  const categories = {};
  const buckets = { todo:0, doing:0, blocked:0, done:0 };
  const openedMonths = {};
  for (const t of items) {
    const cat = lc(t.category || t?.meta?.category || '');
    if (cat) categories[cat] = (categories[cat] || 0) + 1;
    const b = lc(t.bucket || 'todo');
    if (b in buckets) buckets[b] += 1;
    const ym = toYMonth(t.createdAt || t.updatedAt || t.dueDate || Date.now());
    if (ym) openedMonths[ym] = (openedMonths[ym] || 0) + 1;
  }
  return { categories, buckets, openedMonths };
}

async function listHandler(req, res) {
  const page  = Math.max(1, parseInt(s(req.query.page  || '1'),  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(s(req.query.limit || '30'), 10) || 30));
  const q     = lc(req.query.q || '');
  const cats  = parseCSV(req.query.category || '');
  const bks   = parseCSV(req.query.bucket   || '');
  const includeFacets = s(req.query.includeFacets || '1') !== '0';
  const building = normalizeBuilding(req.query.building, { allowBlank: true });

  const openedFrom = s(req.query.openedFrom || '');
  const openedTo   = s(req.query.openedTo   || '');
  const fromTs = openedFrom ? +new Date(openedFrom + 'T00:00:00') : null;
  const toTs   = openedTo   ? +new Date(openedTo   + 'T23:59:59.999') : null;

  const all  = await taskService.getAll();
  // Exclude audit mirror tasks — audits are now managed on /audits directly
  const base = all.filter(t =>
    lc(t.domain) === 'project' &&
    t.meta?.template !== true &&
    !t.meta?.mirrorOf?.startsWith('audit:') &&
    (!building || t.building === building)
  );

  const afterTextDate = base.filter(t => {
    if (q) {
      const hay = `${s(t.id)} ${s(t.title)} ${s(t.description)} ${s(t.category)} ${JSON.stringify(t.meta||{})}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fromTs || toTs) {
      const opened = +new Date(t.createdAt || t.updatedAt || t.dueDate || Date.now());
      if (Number.isNaN(opened)) return false;
      if (fromTs && opened < fromTs) return false;
      if (toTs   && opened > toTs)   return false;
    }
    return true;
  });

  const filtered = afterTextDate.filter(t => {
    if (cats.size) {
      const cat = lc(t.category || t?.meta?.category || '');
      if (!cats.has(cat)) return false;
    }
    if (bks.size) {
      const b = lc(t.bucket || 'todo');
      if (!bks.has(b)) return false;
    }
    return true;
  });

  // Sort: support `sort=field:dir`
  const [sortField, sortDirRaw] = s(req.query.sort || 'createdAt:desc').split(':');
  const sortDir = sortDirRaw?.toUpperCase() === 'ASC' ? 1 : -1;
  const SORT_FIELDS = new Set(['title','bucket','dueDate','createdAt','updatedAt','category']);
  const sf = SORT_FIELDS.has(sortField) ? sortField : 'createdAt';

  filtered.sort((a, b) => {
    const av = String(a[sf] ?? '');
    const bv = String(b[sf] ?? '');
    return av.localeCompare(bv) * sortDir;
  });

  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const p          = Math.min(page, totalPages);
  const start      = (p - 1) * limit;
  const items      = filtered.slice(start, start + limit);
  const facets     = includeFacets ? buildFacets(afterTextDate) : undefined;

  res.json({ items, total, page: p, limit, totalPages, facets });
}

export default function projectRoutes(io) {
  const router = express.Router();

  // ── UI — serve unified page ───────────────────────────────────────────
  router.get('/', requireAuth, (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'projects', 'index.html'));
  });

  // ── Health probe ──────────────────────────────────────────────────────
  router.get('/api/ping', requireAuth, (_req, res) => {
    res.json({ ok: true, where: '/projects/api/ping' });
  });

  // ── List ──────────────────────────────────────────────────────────────
  router.get(['/api', '/api/', '/api/list', '/list'], requireAuth, listHandler);

  router.get('/api/templates', requireAuth, async (_req, res, next) => {
    try {
      const catalogOnly = lc(_req.query.catalogOnly || '') === '1' || lc(_req.query.catalogOnly || '') === 'true';
      if (catalogOnly) {
        return res.json(getProjectCatalogTemplates());
      }
      const all = await taskService.getAll();
      const saved = all.filter((t) => t.domain === 'project' && t.meta?.template === true);
      res.json(dedupeTemplates(saved.concat(getProjectCatalogTemplates())));
    } catch (e) { next(e); }
  });

  router.get(
    '/api/owners',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (_req, res, next) => {
      try {
        const users = await loadJSON(PATHS.USER_PATH, []);
        const owners = users
          .map((u) => {
            const id = s(u.username);
            const name = s(u.name || u.displayName || id);
            const role = lc(u.role || 'user');
            return { id, name, role };
          })
          .filter((u) => u.id && OWNER_ROLES.has(u.role))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) => ({
            ...u,
            label: `${u.name} (${u.id}) - ${u.role === 'lead' ? 'Lead' : 'Coordinator'}`,
          }));

        res.json(owners);
      } catch (e) { next(e); }
    }
  );

  // ── Create ────────────────────────────────────────────────────────────
  router.post(
    '/api',
    requireAuth,
    requireRole('admin','lead','management'),
    async (req, res, next) => {
      try {
        const { error, value } = createSchema.validate(req.body || {}, { abortEarly:false, allowUnknown:true });
        if (error) return res.status(400).json({ message:'Validation failed', details:error.details });

        const owner = ownerFromRequest(value, req.session?.user);
        const payload = {
          ...value,
          building: normalizeBuilding(value.building || value.meta?.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
          domain: 'project',
          kind:   'project',
          source: s((value.meta && value.meta.source) || 'manual'),
          ...owner,
          meta:   {
            ...(value.meta || {}),
            building: normalizeBuilding(value.building || value.meta?.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
            category: s(value.category || value.meta?.category || ''),
            owner: owner.ownerLabel,
            ownerId: owner.ownerId,
            ownerName: owner.ownerName,
            ownerLabel: owner.ownerLabel,
          },
        };

        const t = await taskService.createTask(req.session?.user, payload);
        io?.publish?.projectsUpdated?.({ id: t.id, reason: 'create' });
        res.json({ message:'Created', task: t });
      } catch (e) { next(e); }
    }
  );

  router.post(
    '/api/template',
    requireAuth,
    requireRole('admin','lead','management'),
    async (req, res, next) => {
      try {
        const { error, value } = templateSchema.validate(req.body || {}, { abortEarly:false, allowUnknown:true });
        if (error) return res.status(400).json({ message:'Validation failed', details:error.details });

        const owner = ownerFromRequest(value, req.session?.user);
        const payload = {
          ...value,
          building: normalizeBuilding(value.building || value.meta?.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
          domain: 'project',
          kind: 'project',
          source: 'manual',
          bucket: 'todo',
          ...owner,
          meta: {
            ...(value.meta || {}),
            building: normalizeBuilding(value.building || value.meta?.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
            template: true,
            category: s(value.category || value.meta?.category || ''),
            owner: owner.ownerLabel,
            ownerId: owner.ownerId,
            ownerName: owner.ownerName,
            ownerLabel: owner.ownerLabel,
            templateCreatedBy: taskService.actorFrom(req.session?.user),
          },
        };

        const t = await taskService.createTask(req.session?.user, payload);
        io?.publish?.projectsUpdated?.({ id: t.id, reason: 'template.create' });
        res.status(201).json({ message:'Template created', task: t });
      } catch (e) { next(e); }
    }
  );

  router.post(
    '/instantiate/selective',
    requireAuth,
    requireRole('admin','lead','management'),
    async (req, res, next) => {
      try {
        const { error, value } = selectiveInstantiateSchema.validate(req.body || {}, { abortEarly:false });
        if (error) return res.status(400).json({ message:'Validation failed', details:error.details });

        const owner = ownerFromRequest(value, req.session?.user);
        const created = await taskService.ensureSelectiveProjectInstances(
          new Date(),
          value.templateIds,
          {
            actor: taskService.actorFrom(req.session?.user),
            owner,
            context: {
              title: s(value.title || ''),
              scope: s(value.scope || ''),
              startDate: s(value.startDate || ''),
              targetDate: s(value.targetDate || ''),
              notes: s(value.notes || ''),
              area: s(value.area || ''),
              relatedRef: s(value.relatedRef || ''),
              building: normalizeBuilding(value.building || req.query?.building || req.session?.user?.building, { allowBlank: false }),
            },
          }
        );

        if (created) io?.publish?.projectsUpdated?.({ reason: 'selective_instantiate' });
        res.json({ message:'Selective instantiate complete', created });
      } catch (e) { next(e); }
    }
  );

  // ── PUT /api/:id (full update — original behaviour preserved) ─────────
  router.put('/api/:id', requireAuth, requireTaskWriter, async (req, res, next) => {
    try {
      const id    = s(req.params.id);
      const patch = { ...req.body };

      // Mirror top-level priority / assignee into meta
      if (patch.priority != null) {
        patch.meta = { ...(patch.meta || {}), priority: s(patch.priority) };
      }
      if (patch.assignee != null) {
        patch.meta = { ...(patch.meta || {}), assignee: s(patch.assignee) };
      }
      if (patch.category != null) {
        patch.category = s(patch.category);
        patch.meta = { ...(patch.meta || {}), category: patch.category };
      }
      if (patch.building != null || patch.meta?.building != null) {
        const building = normalizeBuilding(patch.building || patch.meta?.building || req.session?.user?.building, { allowBlank: false });
        patch.building = building;
        patch.meta = { ...(patch.meta || {}), building };
      }
      if (patch.ownerId != null || patch.ownerName != null || patch.ownerLabel != null) {
        const owner = ownerFromRequest(patch, req.session?.user);
        patch.meta = { ...(patch.meta || {}), owner: owner.ownerLabel, ...owner };
        Object.assign(patch, owner);
      }

      const updated = await taskService.updateTask(id, patch, { actor: req.session?.user });
      io?.publish?.projectsUpdated?.({ id, reason: 'update' });
      res.json({ message:'Updated', task: updated });
    } catch (e) { next(e); }
  });

  // ── PATCH /api/:id (partial update — NEW) ─────────────────────────────
  router.patch('/api/:id', requireAuth, requireTaskWriter, async (req, res, next) => {
    try {
      const id = s(req.params.id);

      const { error, value } = patchSchema.validate(req.body || {}, { abortEarly:false, allowUnknown:false });
      if (error) return res.status(400).json({ message:'Validation failed', details:error.details });

      const patch = { ...value };

      // Mirror convenience fields into meta (same logic as PUT)
      if (patch.priority != null) {
        patch.meta = { ...(patch.meta || {}), priority: s(patch.priority) };
        delete patch.priority;
      }
      if (patch.assignee != null) {
        patch.meta = { ...(patch.meta || {}), assignee: s(patch.assignee) };
        delete patch.assignee;
      }
      if (patch.category != null) {
        patch.category = s(patch.category);
        patch.meta = { ...(patch.meta || {}), category: patch.category };
      }
      if (patch.building != null || patch.meta?.building != null) {
        const building = normalizeBuilding(patch.building || patch.meta?.building || req.session?.user?.building, { allowBlank: false });
        patch.building = building;
        patch.meta = { ...(patch.meta || {}), building };
      }
      if (patch.ownerId != null || patch.ownerName != null || patch.ownerLabel != null) {
        const owner = ownerFromRequest(patch, req.session?.user);
        patch.meta = { ...(patch.meta || {}), owner: owner.ownerLabel, ...owner };
        Object.assign(patch, owner);
      }

      const updated = await taskService.updateTask(id, patch, { actor: req.session?.user });
      io?.publish?.projectsUpdated?.({ id, reason: 'update' });
      res.json({ message:'Patched', task: updated });
    } catch (e) { next(e); }
  });

  // ── Move between buckets ──────────────────────────────────────────────
  router.post('/api/move', requireAuth, requireTaskWriter, async (req, res, next) => {
    try {
      const { error, value } = moveSchema.validate(req.body || {}, { abortEarly:false });
      if (error) return res.status(400).json({ message:'Validation failed', details:error.details });
      const t = await taskService.moveBucket(value.id, value.bucket, { actor: req.session?.user });
      io?.publish?.projectsUpdated?.({ id: value.id, reason: 'move' });
      res.json({ message:'Moved', task: t });
    } catch (e) { next(e); }
  });

  // ── Delete ────────────────────────────────────────────────────────────

  // ── Bulk delete by ID list ─────────────────────────────────────────────
  // DELETE /projects/api/bulk   body: { ids: ['uuid',…] }
  // Deletes all listed IDs in a single read → filter → write cycle.
  router.delete(
    '/api/bulk',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    async (req, res, next) => {
      try {
        const raw = req.body?.ids;
        if (!Array.isArray(raw) || !raw.length)
          return res.status(400).json({ message: 'ids[] array required' });

        const toDelete = new Set(raw.map(String));
        const all      = await taskService.getAll();
        const kept     = all.filter(t => !toDelete.has(t.id));
        const removed  = all.length - kept.length;

        await taskService.saveAllDirect(kept);            // see patch note below
        io?.publish?.projectsUpdated?.({ reason: 'bulk-delete', count: removed });
        res.json({ message: `Deleted ${removed} task(s)`, removed });
      } catch (e) { next(e); }
    }
  );

  // ── Purge by filter ────────────────────────────────────────────────────
  // DELETE /projects/api/purge
  // body: {
  //   domain?:        'project' | 'audit' | 'all'
  //   kind?:          'project' | 'daily' | 'weekly' | 'all'
  //   source?:        'manual' | 'expiration' | 'kiosk' | 'system' | 'all'
  //   bucket?:        'todo' | 'doing' | 'blocked' | 'done' | 'all'
  //   olderThanDays?: number   (filter by updatedAt/createdAt)
  //   preserveTemplates?: boolean  (default true — keeps audit templates)
  // }
  router.delete(
    '/api/purge',
    requireAuth,
    requireRole('admin', 'lead'),
    async (req, res, next) => {
      try {
        const {
          domain   = 'all',
          kind     = 'all',
          source   = 'all',
          bucket   = 'all',
          olderThanDays,
          preserveTemplates = true,
          dryRun = false,
        } = req.body || {};

        const cutoff = olderThanDays
          ? new Date(Date.now() - Number(olderThanDays) * 86400000)
          : null;

        const all  = await taskService.getAll();
        const kept = [];

        for (const t of all) {
          // Always keep audit templates if preserveTemplates is set
          if (preserveTemplates && t.meta?.template === true) { kept.push(t); continue; }

          const matchDomain = domain === 'all' || lc(t.domain || '') === lc(domain);
          const matchKind   = kind   === 'all' || lc(t.kind   || '') === lc(kind);
          const matchSource = source === 'all' || lc(t.source || '') === lc(source);
          const matchBucket = bucket === 'all' || lc(t.bucket || '') === lc(bucket);

          // Date filter on updatedAt then createdAt
          let matchAge = true;
          if (cutoff) {
            const ref = t.updatedAt || t.createdAt;
            matchAge  = ref ? new Date(ref) < cutoff : true;
          }

          const shouldDelete = matchDomain && matchKind && matchSource && matchBucket && matchAge;
          if (!shouldDelete) kept.push(t);
        }

        const removed = all.length - kept.length;
        if(!dryRun) await taskService.saveAllDirect(kept);
        if(!dryRun) io?.publish?.projectsUpdated?.({ reason: 'purge', count: removed });
        res.json({ message: `Purged ${removed} task(s)`, removed, remaining: kept.length });
      } catch (e) { next(e); }
    }
  );


  router.delete(
    '/api/:id',
    requireAuth,
    requireRole('admin','lead','management'),
    async (req, res, next) => {
      try {
        const id      = s(req.params.id);
        const removed = await taskService.deleteTask(req.session?.user, id);
        io?.publish?.projectsUpdated?.({ id, reason: 'delete' });
        res.json({ message:'Deleted', id: removed.id });
      } catch (e) { next(e); }
    }
  );

  // ── Categories (filter helper) ────────────────────────────────────────
  router.get('/api/categories', requireAuth, async (_req, res, next) => {
    try {
      const all = await taskService.getAll();
      const set = new Set();
      for (const t of all) {
        if (lc(t.domain) !== 'project') continue;
        const cat = s(t.category || t?.meta?.category || '');
        if (cat) set.add(cat);
      }
      res.json({ categories: Array.from(set).sort((a,b) => a.localeCompare(b)) });
    } catch (e) { next(e); }
  });


  return router;
}
// Export listHandler for server.js shim (pre-gated /projects/api endpoint)
export { listHandler };
