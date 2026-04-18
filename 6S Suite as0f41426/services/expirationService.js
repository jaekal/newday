// services/expirationService.js
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { fileURLToPath } from 'url';
import { Asset, AuditLog, Calibration, ExpirationHistory, sequelize } from '../models/index.js';
import { getAuditStatus } from '../utils/auditStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pickExisting = (...candidates) => candidates.find((p) => p && fsSync.existsSync(p));

const DATA_DIRS = [
  path.resolve(__dirname, '../data'),
  path.resolve(__dirname, '../Data'),
].filter((p) => fsSync.existsSync(p));

const CONFIG_DIRS = [
  path.resolve(__dirname, '../config'),
  path.resolve(process.cwd(), 'config'),
].filter((p) => fsSync.existsSync(p));

async function readJSONSafe(file, fallback = []) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toDateFlexible(v) {
  if (v == null || v === '') return null;

  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 10_000_000_000) {
      const d = new Date(n);
      return Number.isNaN(+d) ? null : d;
    }
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + n * 86400000);
    return Number.isNaN(+d) ? null : d;
  }

  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
}

function parseISO(d) {
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t) : null;
}

function startOfDay(v = new Date()) {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(v = new Date()) {
  const d = new Date(v);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isoDate(d) {
  if (!d) return '';
  const x = typeof d === 'string' ? toDateFlexible(d) ?? parseISO(d) : d;
  return x ? x.toISOString().slice(0, 10) : '';
}

function daysBetween(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(a) - startOfDay(b)) / MS);
}

function statusFromDue(due) {
  if (!due) return 'missing';
  const today = startOfDay();
  const dd = daysBetween(due, today);
  if (dd < 0) return 'overdue';
  if (dd <= 7) return 'due-7';
  if (dd <= 30) return 'due-30';
  return 'ok';
}

function statusLabel(status) {
  switch (status) {
    case 'overdue': return 'Overdue';
    case 'due-7': return 'Due in 7 days';
    case 'due-30': return 'Due in 30 days';
    case 'ok': return 'OK';
    case 'missing': return 'Needs Setup';
    case 'out-of-service': return 'Out of Service';
    case 'awaiting-vendor': return 'Awaiting Vendor';
    default:
      return String(status || 'Unknown')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

function normalizeOperationalStatus(rawStatus, dueDate) {
  const s = String(rawStatus || '').trim().toLowerCase();
  if (s === 'out of service' || s === 'out-of-service') return 'out-of-service';
  if (s === 'awaiting vendor' || s === 'awaiting-vendor') return 'awaiting-vendor';
  return statusFromDue(dueDate);
}

function buildSummary(items, completedThisWeek = 0) {
  const summary = {
    overdue: 0,
    due7: 0,
    due30: 0,
    ok: 0,
    missing: 0,
    total: items.length,
    completedThisWeek,
  };

  for (const item of items) {
    if (item.status === 'overdue') summary.overdue += 1;
    else if (item.status === 'due-7') summary.due7 += 1;
    else if (item.status === 'due-30') summary.due30 += 1;
    else if (item.status === 'ok') summary.ok += 1;
    else if (item.status === 'missing') summary.missing += 1;
  }

  return summary;
}

function containsText(haystack, needle) {
  return String(haystack || '').toLowerCase().includes(String(needle || '').toLowerCase());
}

function sortItems(items, sort = 'due-asc') {
  const list = [...items];

  const getDueTs = (x) => {
    const d = toDateFlexible(x.dueDate) ?? parseISO(x.dueDate);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
  };

  const getOverdueScore = (x) => {
    if (x.daysUntil == null) return Number.NEGATIVE_INFINITY;
    return x.daysUntil < 0 ? Math.abs(x.daysUntil) : -1;
  };

  switch (sort) {
    case 'due-desc':
      return list.sort((a, b) => getDueTs(b) - getDueTs(a));
    case 'most-overdue':
      return list.sort((a, b) => getOverdueScore(b) - getOverdueScore(a));
    case 'location':
      return list.sort((a, b) => String(a.location || '').localeCompare(String(b.location || '')));
    case 'label':
      return list.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
    case 'updated-desc':
      return list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    case 'due-asc':
    default:
      return list.sort((a, b) => getDueTs(a) - getDueTs(b));
  }
}

async function loadAuditRules() {
  const p = CONFIG_DIRS
    .map((d) => path.join(d, 'auditRules.json'))
    .find((fp) => fsSync.existsSync(fp));

  if (!p) return {};
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return {};
  }
}

async function appendHistory(entry, txn = null) {
  return ExpirationHistory.create(
    {
      itemType: String(entry.itemType || '').trim(),
      itemId: String(entry.itemId || '').trim(),
      action: String(entry.action || 'update').trim(),
      actor: entry.actor || null,
      note: entry.note || '',
      changes: entry.changes || null,
    },
    txn ? { transaction: txn } : undefined
  );
}

async function getHistoryForItem(type, id, limit = 50) {
  const rows = await ExpirationHistory.findAll({
    where: {
      itemType: String(type),
      itemId: String(id),
    },
    order: [['createdAt', 'DESC']],
    limit,
    raw: true,
  });

  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    itemType: r.itemType,
    itemId: r.itemId,
    action: r.action,
    actor: r.actor,
    note: r.note,
    changes: r.changes,
  }));
}

async function countCompletedThisWeek() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday));
  const sunday = endOfDay(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));

  return ExpirationHistory.count({
    where: {
      action: ['mark-complete', 'mark-calibrated', 'complete-pm'],
      createdAt: {
        [sequelize.Sequelize.Op.gte]: monday,
        [sequelize.Sequelize.Op.lte]: sunday,
      },
    },
  });
}

async function loadToolRowsRaw() {
  const toolsPath = pickExisting(
    path.join(DATA_DIRS[0] || '.', 'tools.json'),
    path.join(DATA_DIRS[1] || '.', 'tools.json')
  );

  return readJSONSafe(toolsPath, []);
}

async function loadCalibrationMap() {
  let calBySerial = new Map();

  try {
    const rows = await Calibration.findAll({ raw: true });
    if (rows.length > 0) {
      calBySerial = new Map(rows.map((c) => [String(c.serialNumber || '').trim(), c]));
      return calBySerial;
    }
  } catch (e) {
    console.warn('[expirationService] Calibration DB read failed, trying JSON fallback:', e?.message || e);
  }

  const calPath = pickExisting(
    path.join(DATA_DIRS[0] || '.', 'calibration.json'),
    path.join(DATA_DIRS[1] || '.', 'calibration.json')
  );

  const calJson = await readJSONSafe(calPath, []);
  calBySerial = new Map(
    calJson
      .filter((c) => c?.SerialNumber || c?.serialNumber)
      .map((c) => [String(c.SerialNumber || c.serialNumber).trim(), c])
  );

  return calBySerial;
}

async function loadTools() {
  const [tools, calBySerial] = await Promise.all([
    loadToolRowsRaw(),
    loadCalibrationMap(),
  ]);

  const out = [];

  for (const t of tools) {
    const sn = String(t.SerialNumber || t.serialNumber || '').trim();
    if (!sn) continue;

    const c = calBySerial.get(sn) || {};
    const rawDue =
      c.NextCalibrationDue ??
      c.nextCalibrationDue ??
      t.NextCalibrationDue ??
      t.nextCalibrationDue ??
      '';

    const rawLast =
      c.LastCalibrationDate ??
      c.lastCalibrationDate ??
      t.LastCalibrationDate ??
      t.lastCalibrationDate ??
      '';

    const rawInterval =
      c.CalibrationIntervalDays ??
      c.calibrationIntervalDays ??
      t.CalibrationIntervalDays ??
      t.calibrationIntervalDays ??
      '';

    const dueDate = toDateFlexible(rawDue) ?? parseISO(rawDue);
    const lastCal = toDateFlexible(rawLast) ?? parseISO(rawLast);
    const status = normalizeOperationalStatus(c.status || t.status || '', dueDate);

    out.push({
      id: sn,
      type: 'tool',
      subtype: 'tool',
      label: `${sn} — ${t.Description || t.description || t.Model || t.model || ''}`.trim(),
      serialNumber: sn,
      tagNumber: '',
      model: t.Model || t.model || '',
      description: t.Description || t.description || '',
      location: t.Location || t.location || t.Slot || t.slot || '',
      owner: t.Operator || t.operator || '',
      classification: t.Classification || t.classification || '',
      category: t.Classification || t.classification || '',
      status,
      statusLabel: statusLabel(status),
      dueDate: isoDate(dueDate),
      lastCompletedDate: isoDate(lastCal),
      intervalDays: Number(rawInterval) || null,
      daysUntil: dueDate ? daysBetween(dueDate, new Date()) : null,
      source: 'calibration',
      updatedAt: isoDate(c.updatedAt || c.lastUpdated || t.updatedAt || t.lastUpdated || ''),
      canEdit: true,
      actions: ['mark-calibrated', 'reschedule', 'out-of-service', 'update'],
      meta: {
        slot: t.Slot || t.slot || '',
        torque: t.Torque || t.torque || '',
        classification: t.Classification || t.classification || '',
        model: t.Model || t.model || '',
      },
    });
  }

  return out;
}

async function loadAssets() {
  const auditRules = await loadAuditRules();
  const assets = await Asset.findAll({
    include: [{ model: AuditLog, as: 'auditLogs' }],
  });

  const out = [];

  for (const a of assets) {
    const itemType = String(a.itemType || 'asset').toLowerCase();

    if (itemType === 'equipment') {
      const dueDate = a.nextCalibrationDue
        ? (toDateFlexible(a.nextCalibrationDue) ?? parseISO(a.nextCalibrationDue))
        : null;

      const lastCal = a.lastCalibrationDate
        ? (toDateFlexible(a.lastCalibrationDate) ?? parseISO(a.lastCalibrationDate))
        : null;

      const status = normalizeOperationalStatus(a.status, dueDate);

      out.push({
        id: String(a.id),
        type: 'equipment',
        subtype: a.category || 'equipment',
        label: `${a.tagNumber || a.id} — ${a.name || ''}`.trim(),
        serialNumber: a.serialNumber || '',
        tagNumber: a.tagNumber || '',
        model: a.name || '',
        description: a.name || '',
        location: a.location || '',
        owner: a.checkedOutBy || '',
        classification: a.category || '',
        category: a.category || '',
        status,
        statusLabel: statusLabel(status),
        dueDate: isoDate(dueDate),
        lastCompletedDate: isoDate(lastCal),
        intervalDays: Number(a.calibrationIntervalDays) || null,
        daysUntil: dueDate ? daysBetween(dueDate, new Date()) : null,
        source: 'asset-equipment',
        updatedAt: isoDate(a.updatedAt || ''),
        canEdit: true,
        actions: ['mark-calibrated', 'reschedule', 'out-of-service', 'update'],
        meta: {
          category: a.category || '',
          location: a.location || '',
          rawStatus: a.status || '',
          serialNumber: a.serialNumber || '',
          checkedOutBy: a.checkedOutBy || '',
        },
      });

      continue;
    }

    const audits = (a.auditLogs || [])
      .slice()
      .sort((x, y) => new Date(y.auditDate) - new Date(x.auditDate));

    const lastAudit = audits[0]?.auditDate ? new Date(audits[0].auditDate) : null;
    const statusObj = getAuditStatus(a.toJSON(), auditRules, audits);

    // Fleet items are PM-driven only. Never fall back to calibration dates
    // here — those belong to the equipment branch above and would otherwise
    // surface phantom "due" rows for fleet assets carrying stray cal data.
    const dueDate = statusObj?.nextDue
      ? (toDateFlexible(statusObj.nextDue) ?? parseISO(statusObj.nextDue))
      : null;

    const status = normalizeOperationalStatus(a.status, dueDate);

    out.push({
      id: String(a.id),
      type: 'asset',
      subtype: a.category || 'asset',
      label: `${a.tagNumber || a.id} — ${a.name || ''}`.trim(),
      serialNumber: a.serialNumber || '',
      tagNumber: a.tagNumber || '',
      model: a.name || '',
      description: a.name || '',
      location: a.location || '',
      owner: a.checkedOutBy || '',
      classification: a.category || '',
      category: a.category || '',
      status,
      statusLabel: statusLabel(status),
      dueDate: isoDate(dueDate),
      lastCompletedDate: isoDate(lastAudit || ''),
      intervalDays: null,
      daysUntil: dueDate ? daysBetween(dueDate, new Date()) : null,
      source: 'asset',
      updatedAt: isoDate(a.updatedAt || ''),
      canEdit: true,
      actions: ['complete-pm', 'reschedule', 'out-of-service', 'update'],
      meta: {
        category: a.category || '',
        location: a.location || '',
        rawStatus: a.status || '',
        lastAudit: isoDate(lastAudit),
      },
    });
  }

  return out;
}

async function loadAllItems() {
  const [tools, assets] = await Promise.all([loadTools(), loadAssets()]);
  return [...tools, ...assets];
}

function filterItems(items, {
  days = 120,
  type = '',
  status = '',
  search = '',
  location = '',
  owner = '',
  onlyMine = false,
  currentUser = '',
  sort = 'due-asc',
} = {}) {
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() + Number(days || 120));

  let list = items.filter((it) => {
    const due = toDateFlexible(it.dueDate) ?? parseISO(it.dueDate);
    if (!due) return status === 'missing' || !status;
    return due <= cutoff;
  });

  if (type) list = list.filter((x) => String(x.type) === String(type));
  if (status) list = list.filter((x) => String(x.status) === String(status));
  if (location) list = list.filter((x) => containsText(x.location, location));
  if (owner) list = list.filter((x) => containsText(x.owner, owner));

  if (search) {
    list = list.filter((x) => {
      const blob = [
        x.label,
        x.serialNumber,
        x.tagNumber,
        x.model,
        x.description,
        x.location,
        x.owner,
        x.classification,
        x.category,
      ].join(' ');
      return containsText(blob, search);
    });
  }

  if (onlyMine && currentUser) {
    list = list.filter((x) => containsText(x.owner, currentUser));
  }

  return sortItems(list, sort);
}

function uniqueValues(items, key) {
  return [...new Set(items.map((x) => String(x[key] || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

async function updateTool(serialNumber, updates, actor = 'system', txn = null) {
  const currentMap = await loadCalibrationMap();
  const existing = currentMap.get(String(serialNumber).trim()) || {};

  const payload = {
    serialNumber: String(serialNumber).trim(),
    lastCalibrationDate:
      updates.lastCompletedDate ||
      updates.lastCalibrationDate ||
      existing.lastCalibrationDate ||
      existing.LastCalibrationDate ||
      null,
    nextCalibrationDue:
      updates.dueDate ||
      updates.nextCalibrationDue ||
      existing.nextCalibrationDue ||
      existing.NextCalibrationDue ||
      null,
    calibrationIntervalDays:
      updates.intervalDays ??
      existing.calibrationIntervalDays ??
      existing.CalibrationIntervalDays ??
      null,
    status: updates.rawStatus || updates.status || existing.status || 'Active',
    certificateNumber: updates.certificateNumber ?? existing.certificateNumber ?? null,
    vendor: updates.vendor ?? existing.vendor ?? null,
    notes: updates.notes ?? existing.notes ?? null,
    updatedAt: new Date(),
  };

  await Calibration.upsert(payload, txn ? { transaction: txn } : undefined);

  await appendHistory({
    itemType: 'tool',
    itemId: String(serialNumber).trim(),
    action: updates._action || 'update',
    actor,
    changes: payload,
    note: updates.reason || updates.notes || '',
  }, txn);

  return payload;
}

async function updateAssetLike(type, id, updates, actor = 'system', txn = null) {
  const row = await Asset.findByPk(id, txn ? { transaction: txn } : undefined);
  if (!row) {
    const err = new Error(`${type} not found`);
    err.status = 404;
    throw err;
  }

  const patch = {};

  if ('location' in updates) patch.location = updates.location || row.location;
  if ('owner' in updates) patch.checkedOutBy = updates.owner || row.checkedOutBy;
  if ('intervalDays' in updates) {
    patch.calibrationIntervalDays =
      updates.intervalDays == null || updates.intervalDays === ''
        ? null
        : Number(updates.intervalDays);
  }
  if ('lastCompletedDate' in updates || 'lastCalibrationDate' in updates) {
    patch.lastCalibrationDate = updates.lastCompletedDate || updates.lastCalibrationDate || null;
  }
  if ('dueDate' in updates || 'nextCalibrationDue' in updates) {
    patch.nextCalibrationDue = updates.dueDate || updates.nextCalibrationDue || null;
  }
  if ('rawStatus' in updates || 'status' in updates) {
    patch.status = updates.rawStatus || updates.status || row.status;
  }
  if ('category' in updates) patch.category = updates.category || row.category;

  if ('notes' in updates && updates.notes) {
    const prior = row.notes ? `${row.notes}\n` : '';
    patch.notes = `${prior}[${new Date().toISOString()}] ${actor}: ${updates.notes}`.trim();
  }

  await row.update(patch, txn ? { transaction: txn } : undefined);

  await appendHistory({
    itemType: type,
    itemId: String(id),
    action: updates._action || 'update',
    actor,
    changes: patch,
    note: updates.reason || updates.notes || '',
  }, txn);

  return row.toJSON();
}

function computeNextDue(lastCompletedDate, intervalDays) {
  const last = toDateFlexible(lastCompletedDate) ?? parseISO(lastCompletedDate);
  const days = Number(intervalDays);
  if (!last || !Number.isFinite(days) || days <= 0) return null;
  const due = new Date(last);
  due.setDate(due.getDate() + days);
  return isoDate(due);
}

const expirationService = {
  async getUpcoming(options = {}) {
    const {
      days = 120,
      type = '',
      status = '',
      search = '',
      location = '',
      owner = '',
      onlyMine = false,
      currentUser = '',
      sort = 'due-asc',
    } = options;

    const all = await loadAllItems();
    const filtered = filterItems(all, {
      days,
      type,
      status,
      search,
      location,
      owner,
      onlyMine,
      currentUser,
      sort,
    });

    const completedThisWeek = await countCompletedThisWeek();

    return {
      items: filtered,
      summary: buildSummary(filtered, completedThisWeek),
      filters: {
        types: uniqueValues(all, 'type'),
        locations: uniqueValues(all, 'location'),
        owners: uniqueValues(all, 'owner'),
      },
    };
  },

  async getCalendar({ months = 6, type = '', search = '', location = '', owner = '', currentUser = '', onlyMine = false } = {}) {
    const days = Number(months) * 31;
    const { items } = await this.getUpcoming({
      days,
      type,
      search,
      location,
      owner,
      currentUser,
      onlyMine,
      sort: 'due-asc',
    });

    const map = new Map();
    for (const item of items) {
      const d = toDateFlexible(item.dueDate) ?? parseISO(item.dueDate);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }

    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    }

    return Object.fromEntries([...map.entries()].sort());
  },

  async getItem(type, id) {
    const all = await loadAllItems();
    const item = all.find((x) => String(x.type) === String(type) && String(x.id) === String(id));
    if (!item) {
      const err = new Error('Item not found');
      err.status = 404;
      throw err;
    }

    const history = await getHistoryForItem(type, id, 25);
    return { ...item, history };
  },

  async getHistory(type, id, limit = 50) {
    return getHistoryForItem(type, id, limit);
  },

  async updateItem(type, id, updates, actor = 'system') {
    const safe = { ...updates };

    if (safe.intervalDays != null && safe.intervalDays !== '') {
      safe.intervalDays = Number(safe.intervalDays);
    }

    if (!safe.dueDate && (safe.lastCompletedDate || safe.lastCalibrationDate) && safe.intervalDays) {
      safe.dueDate = computeNextDue(safe.lastCompletedDate || safe.lastCalibrationDate, safe.intervalDays);
    }

    await sequelize.transaction(async (txn) => {
      if (type === 'tool') {
        await updateTool(id, safe, actor, txn);
      } else if (type === 'equipment' || type === 'asset') {
        await updateAssetLike(type, id, safe, actor, txn);
      } else {
        const err = new Error(`Unsupported type: ${type}`);
        err.status = 400;
        throw err;
      }
    });

    return this.getItem(type, id);
  },

  async markComplete(type, id, payload = {}, actor = 'system') {
    const lastCompletedDate =
      payload.lastCompletedDate ||
      payload.lastCalibrationDate ||
      isoDate(new Date());

    const intervalDays =
      payload.intervalDays == null || payload.intervalDays === ''
        ? null
        : Number(payload.intervalDays);

    const dueDate = payload.dueDate || computeNextDue(lastCompletedDate, intervalDays);

    const updates = {
      lastCompletedDate,
      intervalDays,
      dueDate,
      rawStatus: payload.rawStatus || 'Active',
      vendor: payload.vendor || '',
      certificateNumber: payload.certificateNumber || '',
      notes: payload.notes || '',
      reason: payload.reason || '',
      _action: type === 'asset' ? 'complete-pm' : 'mark-calibrated',
    };

    return this.updateItem(type, id, updates, actor);
  },

  async bulkUpdate({ ids = [], type = '', action = 'reschedule', updates = {}, actor = 'system' } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      const err = new Error('No items selected');
      err.status = 400;
      throw err;
    }
    if (!type) {
      const err = new Error('Type is required for bulk update');
      err.status = 400;
      throw err;
    }

    const results = [];
    for (const id of ids) {
      const payload = { ...updates, _action: `bulk-${action}` };

      if (action === 'out-of-service') {
        payload.rawStatus = 'Out of Service';
      }
      if (action === 'reschedule' && !payload.dueDate) {
        continue;
      }

      const updated = await this.updateItem(type, id, payload, actor);
      results.push(updated);
    }

    return { ok: true, count: results.length, results };
  },
};

export default expirationService;