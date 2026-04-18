import { randomUUID } from 'crypto';
import { PATHS } from '../config/path.js';
import { findAuditCatalogTemplate, findProjectCatalogTemplate } from '../config/templateCatalog.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { withQueue } from '../utils/writeQueue.js';
import expirationService from './expirationService.js';
import { DEFAULT_BUILDING, normalizeBuilding } from '../utils/buildings.js';
import { s, lc } from '../utils/text.js';

const STORE = PATHS.PROJECTS_PATH;

// Mutation lock keyed DIFFERENTLY from saveJSON's per-file queue key
// (which is STORE itself). A distinct key lets us hold a "logical" lock
// around read-modify-write without deadlocking on the inner saveJSON call.
const STORE_MUTEX = `${STORE}::mutate`;

function withStoreLock(label, fn) {
  return withQueue(STORE_MUTEX, fn, { timeoutMs: 30_000, label: label || 'tasks:mutate' });
}

const PROJECTS_MAX = Number(process.env.PROJECTS_MAX || 3000);
const AUDIT_INSTANCE_MAX_CREATE = Number(process.env.AUDIT_INSTANCE_MAX_CREATE || 24);
const EXP_SYNC_MAX_CREATE = Number(process.env.EXP_SYNC_MAX_CREATE || 50);
const PRUNE_DONE_DAYS = Number(process.env.PRUNE_DONE_DAYS || 60);
const AUDIT_INSTANCE_RETENTION = Number(process.env.AUDIT_INSTANCE_RETENTION_DAYS || 30);

const nowIso = () => new Date().toISOString();
const BUCKET_LABELS = { todo: 'To Do', doing: 'In Progress', blocked: 'Blocked', done: 'Done' };

const CREATE_ROLES = new Set(['admin', 'lead', 'management']);
const DELETE_ROLES = CREATE_ROLES;
const SHIFT_CODES = new Set(['WKND']);

function canCreate(user) { return user && CREATE_ROLES.has(lc(user.role || '')); }
function canDelete(user) { return user && DELETE_ROLES.has(lc(user.role || '')); }

let _cache = null;

export function invalidateCache() {
  _cache = null;
}

function actorFrom(user) {
  if (!user) return 'system';
  const name = s(user.name || user.username || user.id || '');
  const id = s(user.id || user.username || '');
  return name && name !== id ? `${name} (${id})` : (id || 'system');
}

function actorMetaFrom(user) {
  return {
    id: s(user?.id || user?.username || ''),
    name: s(user?.name || user?.username || user?.id || ''),
    label: actorFrom(user),
  };
}

function normalizeShiftValue(value) {
  const raw = s(value);
  if (!raw) return null;
  if (SHIFT_CODES.has(raw.toUpperCase())) return raw.toUpperCase();
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatShiftLabel(value) {
  const normalized = normalizeShiftValue(value);
  if (normalized == null) return '';
  return normalized === 'WKND' ? 'WKND' : `Shift ${normalized}`;
}

function normalizeOwner(source = {}, fallback = {}) {
  const ownerId = s(source.ownerId ?? source.id ?? fallback.ownerId ?? fallback.id ?? '');
  const ownerName = s(source.ownerName ?? source.name ?? fallback.ownerName ?? fallback.name ?? '');
  const ownerLabel = s(
    source.ownerLabel ??
    source.label ??
    fallback.ownerLabel ??
    fallback.label ??
    ownerName ??
    ownerId ??
    ''
  );

  return { ownerId, ownerName, ownerLabel };
}

function appendActivity(meta, entry) {
  const activity = Array.isArray(meta?.activity) ? meta.activity.slice() : [];
  activity.push(entry);
  return activity.slice(-100);
}

function bucketLabel(bucket) {
  return BUCKET_LABELS[lc(bucket)] || s(bucket) || '';
}

function deriveAuditModuleMeta(task = {}, meta = {}) {
  const templateInstance = s(meta.templateInstance || task.meta?.templateInstance || '');
  const title = lc(task.title || '');
  const hasToolVerify =
    lc(meta.moduleTool) === 'tool-verify' ||
    templateInstance === 'catalog:audit:screwdriver-and-drill-audit' ||
    title.includes('screwdriver and drill audit');

  if (hasToolVerify) {
    return {
      moduleTool: 'tool-verify',
      moduleToolLabel: 'Tool Verify',
    };
  }

  const hasTorqueImport =
    lc(meta.moduleTool) === 'torque-import' ||
    templateInstance === 'catalog:audit:weekly-torque-calibration' ||
    title.includes('torque calibration');

  if (hasTorqueImport) {
    return {
      moduleTool: 'torque-import',
      moduleToolLabel: 'Torque Import',
    };
  }

  return {};
}

function normalize(t, { touch = false } = {}) {
  const id = s(t.id) || randomUUID();
  const bucket = lc(t.bucket || t.status || 'todo');
  const cleanBucket = ['todo', 'doing', 'blocked', 'done'].includes(bucket) ? bucket : 'todo';
  const domain = lc(t.domain || 'project');
  const kind = lc(t.kind || (domain === 'audit' ? 'daily' : 'project'));

  const meta = { ...(t.meta || {}) };
  const auditModuleMeta = domain === 'audit' ? deriveAuditModuleMeta(t, meta) : {};
  if (meta.templateInstance && meta.template === true) meta.template = false;

  const category = s(t.category || meta.category || '');
  const building = normalizeBuilding(t.building || meta.building, { allowBlank: false, fallback: DEFAULT_BUILDING });
  const owner = normalizeOwner(
    { ownerId: t.ownerId, ownerName: t.ownerName, ownerLabel: t.ownerLabel },
    meta
  );

  const createdAt = t.createdAt || nowIso();
  const updatedAt = touch ? nowIso() : (t.updatedAt || createdAt);

  return {
    id,
    title: s(t.title),
    description: s(t.description),
    domain,
    kind,
    source: lc(t.source || 'manual'),
    bucket: cleanBucket,
    shiftMode: lc(t.shiftMode || ''),
    weekMode: lc(t.weekMode || ''),
    shift: normalizeShiftValue(t.shift),
    dueDate: s(t.dueDate || ''),
    createdAt,
    updatedAt,
    category,
    building,
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    ownerLabel: owner.ownerLabel,
    meta: {
      ...meta,
      ...auditModuleMeta,
      category,
      building,
      ownerId: owner.ownerId,
      ownerName: owner.ownerName,
      ownerLabel: owner.ownerLabel,
    },
  };
}

async function getAll() {
  if (_cache !== null) return _cache.slice();
  const list = await loadJSON(STORE, []);
  _cache = list.map((rec) => normalize(rec, { touch: false }));
  return _cache.slice();
}

async function saveAll(list) {
  const normalized = list.map((rec) => normalize(rec, { touch: false }));
  await saveJSON(STORE, list);
  _cache = normalized;
}

async function size() {
  if (_cache !== null) return _cache.length;
  const list = await loadJSON(STORE, []);
  return list.length;
}

function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function isoDay(d = new Date()) { return startOfDay(d).toISOString().slice(0, 10); }
function mondayOfWeek(d) { const x = startOfDay(d); const day = x.getDay() || 7; if (day !== 1) x.setDate(x.getDate() - (day - 1)); return x; }
function overLimit(len, hardLimit = PROJECTS_MAX) { return len >= hardLimit; }
async function cappedSave(list, hardLimit = PROJECTS_MAX) {
  if (list.length > hardLimit) {
    throw Object.assign(new Error('Store at capacity; save blocked to protect UI'), { status: 429 });
  }
  await saveAll(list);
}

async function createTask(user, payload, { hardLimit = PROJECTS_MAX } = {}) {
  if (!canCreate(user)) throw Object.assign(new Error('Forbidden'), { status: 403 });

  return withStoreLock('createTask', async () => {
  const actor = actorFrom(user);
  const actorMeta = actorMetaFrom(user);
  const owner = normalizeOwner(payload, payload.meta);
  const building = normalizeBuilding(payload.building || payload.meta?.building, { allowBlank: false, fallback: DEFAULT_BUILDING });
  const all = await getAll();
  if (overLimit(all.length + 1, hardLimit)) {
    throw Object.assign(new Error('Store at capacity; creation blocked to protect UI'), { status: 429 });
  }

  const stampAt = nowIso();
  const t = normalize({
    ...payload,
    building,
    ownerId: owner.ownerId,
    ownerName: owner.ownerName,
    ownerLabel: owner.ownerLabel,
    meta: {
      ...(payload.meta || {}),
      building,
      createdBy: s(payload.meta?.createdBy || actor),
      lastActorId: actorMeta.id,
      lastActorName: actorMeta.name,
      lastActor: actorMeta.label,
      lastAction: 'create',
      lastActionAt: stampAt,
      activity: appendActivity(payload.meta, {
        at: stampAt,
        action: 'create',
        actorId: actorMeta.id,
        actorName: actorMeta.name,
        actorLabel: actorMeta.label,
      }),
    },
  }, { touch: true });

  all.push(t);
  await saveAll(all);
  return t;
  });
}

async function updateTask(id, patch, { actor = null } = {}) {
  return withStoreLock('updateTask', async () => {
  const all = await getAll();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });

  const current = all[idx];
  const allowed = [
    'title', 'description', 'bucket', 'dueDate', 'meta', 'shift',
    'kind', 'shiftMode', 'weekMode', 'category',
    'ownerId', 'ownerName', 'ownerLabel', 'building',
  ];

  for (const k of Object.keys(patch || {})) {
    if (!allowed.includes(k) || k === 'meta') continue;
    all[idx][k] = patch[k];
  }

  all[idx].meta = {
    ...(current.meta || {}),
    ...(patch?.meta || {}),
  };

  if (patch?.category != null) {
    all[idx].category = s(patch.category);
    all[idx].meta = { ...(all[idx].meta || {}), category: s(patch.category) };
  } else if (patch?.meta?.category != null) {
    all[idx].category = s(patch.meta.category);
  }

  if (patch?.building != null || patch?.meta?.building != null) {
    const nextBuilding = normalizeBuilding(
      patch?.building ?? patch?.meta?.building,
      { allowBlank: false, fallback: current.building || DEFAULT_BUILDING }
    );
    all[idx].building = nextBuilding;
    all[idx].meta = { ...(all[idx].meta || {}), building: nextBuilding };
  }

  const ownerPatchProvided =
    patch?.ownerId != null ||
    patch?.ownerName != null ||
    patch?.ownerLabel != null ||
    patch?.meta?.ownerId != null ||
    patch?.meta?.ownerName != null ||
    patch?.meta?.ownerLabel != null;

  if (ownerPatchProvided) {
    const nextOwner = normalizeOwner(
      {
        ownerId: patch?.ownerId ?? patch?.meta?.ownerId,
        ownerName: patch?.ownerName ?? patch?.meta?.ownerName,
        ownerLabel: patch?.ownerLabel ?? patch?.meta?.ownerLabel,
      },
      current
    );

    all[idx].ownerId = nextOwner.ownerId;
    all[idx].ownerName = nextOwner.ownerName;
    all[idx].ownerLabel = nextOwner.ownerLabel;
    all[idx].meta = {
      ...(all[idx].meta || {}),
      ownerId: nextOwner.ownerId,
      ownerName: nextOwner.ownerName,
      ownerLabel: nextOwner.ownerLabel,
    };
  }

  if (actor) {
    const stampAt = nowIso();
    const actorMeta = actorMetaFrom(actor);
    const fromBucket = lc(current.bucket || 'todo');
    const toBucket = lc(all[idx].bucket || fromBucket);
    const ownerChanged =
      ownerPatchProvided &&
      (
        s(current.ownerId) !== s(all[idx].ownerId) ||
        s(current.ownerName) !== s(all[idx].ownerName) ||
        s(current.ownerLabel) !== s(all[idx].ownerLabel)
      );
    const action = ownerChanged ? 'reassign' : (patch.bucket ? 'move' : 'update');

    all[idx].meta = {
      ...(all[idx].meta || {}),
      lastActorId: actorMeta.id,
      lastActorName: actorMeta.name,
      lastActor: actorMeta.label,
      lastAction: action,
      lastActionAt: stampAt,
      activity: appendActivity(all[idx].meta, {
        at: stampAt,
        action,
        actorId: actorMeta.id,
        actorName: actorMeta.name,
        actorLabel: actorMeta.label,
        ...(action === 'move' ? {
          fromBucket,
          fromBucketLabel: bucketLabel(fromBucket),
          toBucket,
          toBucketLabel: bucketLabel(toBucket),
        } : {}),
        ...(ownerChanged ? {
          fromOwnerId: s(current.ownerId),
          fromOwnerName: s(current.ownerName),
          fromOwnerLabel: s(current.ownerLabel),
          toOwnerId: s(all[idx].ownerId),
          toOwnerName: s(all[idx].ownerName),
          toOwnerLabel: s(all[idx].ownerLabel),
        } : {}),
      }),
    };
  }

  all[idx] = normalize(all[idx], { touch: true });
  await saveAll(all);
  return all[idx];
  });
}

async function moveBucket(id, newBucket, { actor = null } = {}) {
  return updateTask(
    id,
    { bucket: ['todo', 'doing', 'blocked', 'done'].includes(lc(newBucket)) ? lc(newBucket) : 'todo' },
    { actor }
  );
}

async function deleteTask(user, id) {
  if (!canDelete(user)) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return withStoreLock('deleteTask', async () => {
    const all = await getAll();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) throw Object.assign(new Error('Not found'), { status: 404 });
    const removed = all.splice(idx, 1)[0];
    await saveAll(all);
    return removed;
  });
}

function buildInstanceFromTemplate(tpl, base, ownerMeta, actor) {
  const stampAt = nowIso();
  return normalize({
    ...tpl,
    id: undefined,
    ...base,
    meta: {
      ...tpl.meta,
      ...base.meta,
      templateInstance: tpl.id,
      template: false,
      initiatedBy: s(actor || ''),
      initiatedAt: stampAt,
      lastActor: s(actor || ''),
      lastAction: 'instantiate',
      lastActionAt: stampAt,
      activity: appendActivity(tpl.meta, {
        at: stampAt,
        action: 'instantiate',
        actorLabel: s(actor || 'system'),
        toOwnerId: ownerMeta.ownerId,
        toOwnerName: ownerMeta.ownerName,
        toOwnerLabel: ownerMeta.ownerLabel,
      }),
      ...ownerMeta,
    },
    ownerId: ownerMeta.ownerId,
    ownerName: ownerMeta.ownerName,
    ownerLabel: ownerMeta.ownerLabel,
    createdAt: stampAt,
  }, { touch: true });
}

async function ensureSelectiveInstances(today = new Date(), templateIds = [], { shift = null, actor = null, owner = null, building = '', hardLimit = PROJECTS_MAX } = {}) {
  if (!templateIds?.length) return 0;

  return withStoreLock('ensureSelectiveInstances', async () => {
  const idSet = new Set(templateIds.map(String));
  const list = await getAll();

  const dayKey = isoDay(today);
  const monday = mondayOfWeek(today);
  const weekKey = isoDay(monday);
  const weekIndex = Math.floor((monday - new Date(monday.getFullYear(), 0, 1)) / (7 * 86400000));

  const templates = list.filter((t) =>
    t.domain === 'audit' && t.meta?.template === true && idSet.has(t.id)
  );
  const catalogTemplates = [...idSet]
    .filter((id) => id.startsWith('catalog:audit:'))
    .map((id) => findAuditCatalogTemplate(id))
    .filter(Boolean);

  const toCreate = [];
  const ownerMeta = normalizeOwner(owner, owner);
  const scopedBuilding = normalizeBuilding(building, { allowBlank: false, fallback: DEFAULT_BUILDING });
  const sameBuilding = (task) =>
    normalizeBuilding(task?.building || task?.meta?.building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === scopedBuilding;

  for (const tpl of templates.concat(catalogTemplates)) {
    if (lc(tpl.kind) === 'daily') {
      if (tpl.shiftMode === 'per-shift' && shift) {
        const exists = list.find((t) =>
          t.meta?.templateInstance === tpl.id &&
          t.dueDate === dayKey &&
          String(t.shift) === String(shift) &&
          sameBuilding(t)
        );
        if (!exists) {
          toCreate.push(buildInstanceFromTemplate(tpl, {
            title: `${tpl.title} (${formatShiftLabel(shift)})`,
            bucket: 'todo',
            dueDate: dayKey,
            shift,
            building: scopedBuilding,
          }, ownerMeta, actor));
        }
      } else {
        const exists = list.find((t) =>
          t.meta?.templateInstance === tpl.id &&
          t.dueDate === dayKey &&
          sameBuilding(t) &&
          (!shift || !t.shift || t.shift === shift)
        );
        if (!exists) {
          toCreate.push(buildInstanceFromTemplate(tpl, {
            title: tpl.title,
            bucket: 'todo',
            dueDate: dayKey,
            building: scopedBuilding,
            ...(shift ? { shift } : {}),
          }, ownerMeta, actor));
        }
      }
    } else if (lc(tpl.kind) === 'weekly') {
      const biweekly = lc(tpl.weekMode) === 'biweekly';
      if (biweekly && (weekIndex % 2) !== 0) continue;

      const exists = list.find((t) =>
        t.meta?.templateInstance === tpl.id &&
        t.dueDate === weekKey &&
        sameBuilding(t)
      );
      if (!exists) {
        toCreate.push(buildInstanceFromTemplate(tpl, {
          title: `${tpl.title} (${biweekly ? 'Biweekly' : 'Weekly'})`,
          bucket: 'todo',
          dueDate: weekKey,
          building: scopedBuilding,
          ...(shift ? { shift } : {}),
        }, ownerMeta, actor));
      }
    } else if (lc(tpl.kind) === 'monthly') {
      const monthKey = dayKey.slice(0, 7);
      const exists = list.find((t) =>
        t.meta?.templateInstance === tpl.id &&
        sameBuilding(t) &&
        (t.dueDate || '').startsWith(monthKey)
      );
      if (!exists) {
        toCreate.push(buildInstanceFromTemplate(tpl, {
          title: `${tpl.title} (Monthly)`,
          bucket: 'todo',
          dueDate: dayKey,
          building: scopedBuilding,
          ...(shift ? { shift } : {}),
        }, ownerMeta, actor));
      }
    }
  }

  if (!toCreate.length) return 0;

  if (overLimit(list.length + toCreate.length, hardLimit)) {
    const slots = Math.max(0, hardLimit - list.length);
    toCreate.length = Math.min(toCreate.length, slots);
  }

  await saveAll(list.concat(toCreate));
  return toCreate.length;
  });
}

async function ensureSelectiveProjectInstances(today = new Date(), templateIds = [], { actor = null, owner = null, context = {}, hardLimit = PROJECTS_MAX } = {}) {
  if (!templateIds?.length) return 0;

  return withStoreLock('ensureSelectiveProjectInstances', async () => {
  const idSet = new Set(templateIds.map(String));
  const list = await getAll();
  const templates = list.filter((t) =>
    t.domain === 'project' && t.meta?.template === true && idSet.has(t.id)
  );
  const catalogTemplates = [...idSet]
    .filter((id) => id.startsWith('catalog:project:'))
    .map((id) => findProjectCatalogTemplate(id))
    .filter(Boolean);

  const toCreate = [];
  const ownerMeta = normalizeOwner(owner, owner);
  const startDate = s(context.startDate || '');
  const targetDate = s(context.targetDate || '');
  const scope = s(context.scope || '');
  const notes = s(context.notes || '');
  const area = s(context.area || '');
  const building = normalizeBuilding(context.building, { allowBlank: false, fallback: DEFAULT_BUILDING });
  const relatedRef = s(context.relatedRef || '');
  const titleOverride = s(context.title || '');

  for (const tpl of templates.concat(catalogTemplates)) {
    const templateKey = `${tpl.id}|${building}|${targetDate || 'no-date'}|${ownerMeta.ownerLabel || 'no-owner'}|${titleOverride || tpl.title}`;
    const exists = list.find((t) =>
      t.domain === 'project' &&
      t.meta?.templateInstance === tpl.id &&
      normalizeBuilding(t.building || t.meta?.building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === building &&
      s(t.meta?.instanceKey) === templateKey
    );
    if (exists) continue;

    const descriptionParts = [
      scope || s(tpl.meta?.objective || ''),
      notes || s(tpl.meta?.notes || ''),
    ].filter(Boolean);

    toCreate.push(buildInstanceFromTemplate(tpl, {
      title: titleOverride || tpl.title,
      description: descriptionParts.join('\n\n'),
      bucket: 'todo',
      dueDate: targetDate,
      building,
      meta: {
        area: area || s(tpl.meta?.area || ''),
        building,
        notes: notes || s(tpl.meta?.notes || ''),
        objective: scope || s(tpl.meta?.objective || ''),
        relatedRef: relatedRef || s(tpl.meta?.relatedRef || ''),
        repeatCadence: s(tpl.meta?.repeatCadence || ''),
        plan: {
          ...(tpl.meta?.plan || {}),
          startDate,
          targetDate,
        },
        instanceKey: templateKey,
      },
    }, ownerMeta, actor));
  }

  if (!toCreate.length) return 0;

  if (overLimit(list.length + toCreate.length, hardLimit)) {
    const slots = Math.max(0, hardLimit - list.length);
    toCreate.length = Math.min(toCreate.length, slots);
  }

  await saveAll(list.concat(toCreate));
  return toCreate.length;
  });
}

async function ensureDailyInstances(today = new Date(), { shift = null, maxCreate = AUDIT_INSTANCE_MAX_CREATE, hardLimit = PROJECTS_MAX } = {}) {
  const list = await getAll();
  const templateIds = list
    .filter((t) => t.domain === 'audit' && t.meta?.template === true && lc(t.kind) === 'daily')
    .slice(0, maxCreate)
    .map((t) => t.id);

  return ensureSelectiveInstances(today, templateIds, { shift, hardLimit });
}

async function ensureWeeklyInstances(today = new Date(), { shift = null, maxCreate = AUDIT_INSTANCE_MAX_CREATE, hardLimit = PROJECTS_MAX } = {}) {
  const list = await getAll();
  const templateIds = list
    .filter((t) => t.domain === 'audit' && t.meta?.template === true && ['weekly', 'monthly'].includes(lc(t.kind)))
    .slice(0, maxCreate)
    .map((t) => t.id);

  return ensureSelectiveInstances(today, templateIds, { shift, hardLimit });
}

async function upsertMirrorFromAudit(auditTask, { hardLimit = PROJECTS_MAX } = {}) {
  return withStoreLock('upsertMirrorFromAudit', async () => {
  const all = await getAll();
  const key = `audit:${auditTask.id}`;
  const idx = all.findIndex((t) => t.domain === 'project' && t.meta?.mirrorOf === key);

  if (idx === -1 && overLimit(all.length + 1, hardLimit)) return;

  const base = normalize({
    id: idx === -1 ? undefined : all[idx].id,
    domain: 'project',
    kind: 'project',
    source: auditTask.source || 'manual',
    title: auditTask.title,
    description: auditTask.description,
    bucket: auditTask.bucket === 'done' ? 'done' : (idx === -1 ? 'todo' : all[idx].bucket),
    meta: { ...(idx === -1 ? {} : all[idx].meta), mirrorOf: key, auditId: auditTask.id },
    dueDate: auditTask.dueDate || '',
  }, { touch: true });

  if (idx === -1) {
    all.push(base);
  } else {
    all[idx] = { ...all[idx], ...base, updatedAt: nowIso() };
  }
  await cappedSave(all, hardLimit);
  });
}

async function deleteProjectMirrorForAudit(auditId) {
  return withStoreLock('deleteProjectMirrorForAudit', async () => {
    const all = await getAll();
    const key = `audit:${auditId}`;
    const idx = all.findIndex((t) => t.domain === 'project' && t.meta?.mirrorOf === key);
    if (idx !== -1) {
      all.splice(idx, 1);
      await saveAll(all);
    }
  });
}

async function propagateProjectBucketToAudit(auditId, bucket) {
  return withStoreLock('propagateProjectBucketToAudit', async () => {
    const all = await getAll();
    const idx = all.findIndex((t) => t.id === auditId && t.domain === 'audit');
    if (idx === -1) return;
    all[idx].bucket = bucket;
    all[idx].updatedAt = nowIso();
    await saveAll(all);
  });
}

function expKeyFor(item) {
  return `exp:${item.type}:${item.id}:${item.dueDate}`;
}

async function syncExpirationsToProjects({ days = 365, maxCreate = EXP_SYNC_MAX_CREATE, hardLimit = PROJECTS_MAX } = {}) {
  return withStoreLock('syncExpirationsToProjects', async () => {
  const list = await getAll();
  if (overLimit(list.length, hardLimit)) return { created: 0, skipped: 0, reason: 'capacity' };

  const items = await expirationService.getUpcoming({ days });
  const create = [];
  let created = 0;
  let skipped = 0;

  for (const it of items) {
    if (!['overdue', 'due-soon'].includes(it.status)) continue;
    const key = expKeyFor(it);
    const idx = list.findIndex((t) => t.domain === 'project' && t.meta?.expKey === key);
    if (idx === -1) {
      if (created >= maxCreate || overLimit(list.length + create.length + 1, hardLimit)) {
        skipped += 1;
        continue;
      }
      create.push(normalize({
        domain: 'project',
        kind: 'project',
        source: 'expiration',
        title: it.type === 'tool' ? `Recalibration: ${it.id}` : `Audit Due: ${it.label}`,
        description: `${it.label} - due ${it.dueDate}`,
        bucket: 'todo',
        dueDate: it.dueDate || '',
        meta: { expKey: key, expType: it.type, status: it.status },
      }, { touch: true }));
      created += 1;
    } else {
      const cur = list[idx];
      if (cur.bucket !== 'done') {
        list[idx] = {
          ...cur,
          dueDate: it.dueDate || cur.dueDate,
          meta: { ...cur.meta, status: it.status },
          updatedAt: nowIso(),
        };
      }
    }
  }

  if (create.length) await saveAll(list.concat(create));
  else await saveAll(list);
  return { created, skipped };
  });
}

async function addKioskTicket(ticket) {
  const t = normalize({
    domain: 'project',
    kind: 'project',
    source: 'kiosk',
    title: s(ticket.title || `Kiosk Ticket ${ticket.id || ''}`),
    description: s(ticket.description || ''),
    bucket: 'todo',
    meta: { kioskId: s(ticket.id || ''), ...(ticket.meta || {}) },
  }, { touch: true });
  return withStoreLock('addKioskTicket', async () => {
    const all = await getAll();
    if (overLimit(all.length + 1)) return t;
    all.push(t);
    await saveAll(all);
    return t;
  });
}

async function seedDefaults() {
  return 0;
}

async function seedKanbanDemo() {
  return 0;
}

function olderThan(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(+d)) return false;
  const cutoff = Date.now() - days * 86400000;
  return +d < cutoff;
}

async function prune({ doneOlderThanDays = PRUNE_DONE_DAYS, auditInstanceOlderThanDays = AUDIT_INSTANCE_RETENTION, hardLimit = PROJECTS_MAX } = {}) {
  return withStoreLock('prune', async () => {
  const list = await getAll();
  if (!list.length) return { removed: 0 };

  const keep = [];
  const toRemoveAuditIds = [];

  for (const t of list) {
    if (t.domain === 'project') {
      const ageRef = t.dueDate || t.updatedAt || t.createdAt;
      if (t.bucket === 'done' && olderThan(ageRef, doneOlderThanDays)) continue;
      keep.push(t);
    } else if (t.domain === 'audit') {
      if (t.meta?.template === true) {
        keep.push(t);
        continue;
      }
      const ageRef = t.dueDate || t.updatedAt || t.createdAt;
      if (olderThan(ageRef, auditInstanceOlderThanDays)) {
        toRemoveAuditIds.push(t.id);
        continue;
      }
      keep.push(t);
    } else {
      keep.push(t);
    }
  }

  if (toRemoveAuditIds.length) {
    const auditKeys = new Set(toRemoveAuditIds.map((id) => `audit:${id}`));
    for (let i = keep.length - 1; i >= 0; i -= 1) {
      const t = keep[i];
      if (t.domain === 'project' && t.meta?.mirrorOf && auditKeys.has(t.meta.mirrorOf)) {
        keep.splice(i, 1);
      }
    }
  }

  await cappedSave(keep, hardLimit);
  return { removed: list.length - keep.length, removedAudits: toRemoveAuditIds.length };
  });
}

async function addAuditObservation(auditId, observation) {
  return withStoreLock('addAuditObservation', async () => {
  const all = await getAll();
  const idx = all.findIndex((t) => t.id === s(auditId));
  if (idx === -1) throw new Error('Audit not found');
  const t = all[idx];
  if (t.domain !== 'audit' || t?.meta?.template === true) throw new Error('Not an audit instance');

  const obs = {
    id: randomUUID(),
    at: nowIso(),
    state: s(observation?.state || 'found'),
    assetId: observation?.assetId || null,
    barcode: s(observation?.barcode || ''),
    note: s(observation?.note || ''),
    locationId: s(observation?.locationId || ''),
    actor: s(observation?.actor || 'system'),
  };

  const meta = { ...(t.meta || {}) };
  meta.observations = Array.isArray(meta.observations) ? meta.observations.slice() : [];
  meta.observations.push(obs);

  all[idx] = normalize({ ...t, meta }, { touch: true });
  await saveAll(all);
  return obs;
  });
}

export default {
  getAll,
  saveAll,
  saveAllDirect: saveAll,
  size,
  createTask,
  updateTask,
  deleteTask,
  moveBucket,
  actorFrom,
  ensureDailyInstances,
  ensureWeeklyInstances,
  ensureSelectiveInstances,
  ensureSelectiveProjectInstances,
  upsertMirrorFromAudit,
  deleteProjectMirrorForAudit,
  propagateProjectBucketToAudit,
  syncExpirationsToProjects,
  addKioskTicket,
  seedDefaults,
  seedKanbanDemo,
  prune,
  addAuditObservation,
};
