// services/assetsService.js  (updated)
// ─────────────────────────────────────────────────────────────────────────────
// Changes from original:
//   1. FIELDS and sanitizeAssetData now include all new columns.
//   2. createAsset / updateAsset handle the new fields.
//   3. updateCalibration — new handler: PATCH /asset-catalog/:id/calibration
//      Records a calibration date and auto-advances nextCalibrationDue.
//   4. checkoutEquipment — new handler: POST /asset-catalog/:id/checkout
//      Sets status → 'Checked Out', records checkedOutBy/At.
//   5. checkinEquipment  — new handler: POST /asset-catalog/:id/checkin
//      Sets status → 'Available', clears checkout fields.
//   6. renderCatalog passes itemType filter from query string.
//   7. Joi schemas in assetCatalog.js need updating (see routes patch).
// ─────────────────────────────────────────────────────────────────────────────
import { Asset, AuditLog, sequelize, Op } from '../models/index.js';
import { Parser } from 'json2csv';
import fs      from 'fs';
import fsp     from 'fs/promises';
import path    from 'path';
import multer  from 'multer';
import csvParser from 'csv-parser';
import { getAuditStatus } from '../utils/auditStatus.js';
import { csvSafeObject } from '../utils/csv.js';
import taskService from './taskService.js';
import { loadJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import { normalizeBuilding, DEFAULT_BUILDING } from '../utils/buildings.js';
import * as esdCartsService from './esdCarts.js';

// Build a rich actor string from the session user
function sessionActor(req) {
  const u = req.session?.user;
  if (!u) return req.ip || 'system';
  const name = (u.name || u.username || u.id || '').trim();
  const id   = (u.id   || u.username || '').trim();
  return name && name !== id ? `${name} (${id})` : (id || req.ip || 'system');
}


// ── Audit rules cache ─────────────────────────────────────────────────────────
let auditRules = null;
export const loadAuditRules = async () => {
  if (!auditRules) {
    const filePath = path.resolve('config/auditRules.json');
    const raw = await fsp.readFile(filePath, 'utf-8');
    auditRules = JSON.parse(raw);
  }
  return auditRules;
};

const upload = multer({ dest: path.join(process.cwd(), 'tmp') });

// ── Field list ────────────────────────────────────────────────────────────────
// Shared fields (both itemTypes)
const SHARED_FIELDS = [
  'name', 'tagNumber', 'category', 'location', 'status', 'description',
  'itemType', 'building', 'equipmentClass', 'managedSource', 'torque', 'toolClassification',
];

// Equipment-only fields
const EQUIPMENT_FIELDS = [
  'serialNumber',
  'lastCalibrationDate',
  'nextCalibrationDue',
  'calibrationIntervalDays',
];

const ALL_FIELDS = [...SHARED_FIELDS, ...EQUIPMENT_FIELDS];

const STATUS_ALIASES = new Map([
  ['active', 'Available'],
  ['available', 'Available'],
  ['good', 'Available'],
  ['ok', 'Available'],
  ['expired', 'Expired'],
  ['defective', 'Defective'],
  ['damaged', 'Defective'],
  ['physical damage', 'Defective'],
  ['missing keys', 'Defective'],
  ['maintenance', 'Maintenance'],
  ['needs inspection', 'Maintenance'],
  ['in use', 'In Use'],
  ['in-use', 'In Use'],
  ['inuse', 'In Use'],
  ['checked out', 'Checked Out'],
  ['checked-out', 'Checked Out'],
  ['checkedout', 'Checked Out'],
]);
const ALLOWED_ASSET_STATUSES = new Set([
  'Available',
  'Expired',
  'Defective',
  'Maintenance',
  'In Use',
  'Checked Out',
]);

const ITEM_TYPE_ALIASES = new Map([
  ['fleet', 'fleet'],
  ['equipment', 'equipment'],
  ['test equipment', 'equipment'],
]);

function firstScalar(value) {
  if (Array.isArray(value)) return value.find((entry) => entry !== undefined && entry !== null && `${entry}`.trim() !== '') ?? value[0];
  return value;
}

function normalizedText(value, fallback = '') {
  const scalar = firstScalar(value);
  if (scalar === undefined || scalar === null) return fallback;
  return String(scalar).trim();
}

function normalizeAssetStatus(value) {
  const raw = normalizedText(value);
  if (!raw) return 'Available';
  const canonical = STATUS_ALIASES.get(raw.toLowerCase()) || raw;
  return ALLOWED_ASSET_STATUSES.has(canonical) ? canonical : 'Available';
}

function normalizeItemType(value) {
  const raw = normalizedText(value).toLowerCase();
  if (!raw) return 'fleet';
  return ITEM_TYPE_ALIASES.get(raw) || 'fleet';
}

const sanitizeAssetData = (data = {}) => {
  const clean = {};
  for (const f of ALL_FIELDS) {
    const v = firstScalar(data[f]);
    if (f === 'calibrationIntervalDays') {
      // Store as integer or null
      const n = parseInt(v, 10);
      clean[f] = Number.isFinite(n) && n > 0 ? n : null;
    } else if (f === 'building') {
      clean[f] = normalizeBuilding(v, { allowBlank: true, fallback: '' });
    } else {
      clean[f] = normalizedText(v);
    }
  }
  clean.itemType = normalizeItemType(clean.itemType);
  if (!clean.managedSource) clean.managedSource = 'asset-catalog';
  clean.status = normalizeAssetStatus(clean.status);

  // Fleet items are PM-audited by category — they must not carry calibration
  // dates, checkout state, or torque values. Clearing these on save prevents
  // stale equipment data from leaking into the expiration dashboard or kiosk
  // APIs after an item is reclassified from equipment -> fleet.
  if (clean.itemType === 'fleet') {
    clean.lastCalibrationDate = null;
    clean.nextCalibrationDue = null;
    clean.calibrationIntervalDays = null;
    clean.checkedOutBy = null;
    clean.checkedOutAt = null;
    clean.torque = '';
    if (clean.status === 'Checked Out') clean.status = 'Available';
  }

  // Auto-compute nextCalibrationDue whenever the date + interval are provided.
  if (
    clean.itemType === 'equipment' &&
    clean.lastCalibrationDate &&
    clean.calibrationIntervalDays
  ) {
    const last = new Date(clean.lastCalibrationDate);
    if (!Number.isNaN(last.getTime())) {
      const next = new Date(last);
      next.setDate(next.getDate() + clean.calibrationIntervalDays);
      clean.nextCalibrationDue = next.toISOString().slice(0, 10);
    }
  }

  return clean;
};

function normalizeManagedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapToolStatusToAssetStatus(status) {
  return String(status || '').trim().toLowerCase() === 'being used' ? 'Checked Out' : 'Available';
}

function mapAssetStatusToToolStatus(status) {
  return String(status || '').trim().toLowerCase() === 'checked out' ? 'being used' : 'in inventory';
}

function extractSlotFromLocation(location) {
  const raw = String(location || '').trim();
  if (!raw) return '';
  const match = raw.match(/^slot\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function toolToManagedAsset(tool = {}) {
  const serialNumber = String(tool.serialNumber || tool.serial || tool.SerialNumber || '').trim();
  const toolType = String(tool.toolType || '').trim();
  const model = String(tool.model || '').trim();
  const classification = String(tool.classification || '').trim();
  const torque = String(tool.torque || '').trim();
  const slot = String(tool.slot || '').trim();
  const notes = String(tool.description || '').trim();
  const descriptionBits = [
    toolType ? `Type: ${toolType}` : '',
    notes,
  ].filter(Boolean);

  return sanitizeAssetData({
    tagNumber: serialNumber,
    name: model || toolType || `Tool ${serialNumber}`,
    category: 'Floor Tool',
    location: slot ? `Slot ${slot}` : '',
    building: normalizeBuilding(tool.building, { allowBlank: false, fallback: DEFAULT_BUILDING }),
    status: mapToolStatusToAssetStatus(tool.status),
    description: descriptionBits.join(' | '),
    itemType: 'equipment',
    equipmentClass: toolType || 'Tool',
    managedSource: 'tools',
    serialNumber,
    torque,
    toolClassification: classification,
    lastCalibrationDate: normalizeManagedDate(tool.calibrationDate),
    nextCalibrationDue: normalizeManagedDate(tool.nextCalibrationDue),
    calibrationIntervalDays: null,
    checkedOutBy: String(tool.operatorId || '').trim() || null,
    checkedOutAt: String(tool.timestamp || '').trim() || null,
  });
}

function cartToManagedAsset(cart = {}) {
  const cartId = String(cart.id || cart.cartId || '').trim();
  const holder = String(cart.holder || '').trim();
  const checkedOut = String(cart.status || '').trim().toLowerCase() === 'checked_out';

  return sanitizeAssetData({
    tagNumber: cartId,
    name: `ESD Cart ${cartId}`,
    category: 'ESD Cart',
    location: '',
    building: normalizeBuilding(cart.building, { allowBlank: false, fallback: DEFAULT_BUILDING }),
    status: checkedOut ? 'Checked Out' : 'Available',
    description: 'Managed from ESD cart roster',
    itemType: 'equipment',
    equipmentClass: 'ESD Cart',
    managedSource: 'esd-carts',
    serialNumber: '',
    lastCalibrationDate: null,
    nextCalibrationDue: null,
    calibrationIntervalDays: null,
    checkedOutBy: holder || null,
    checkedOutAt: checkedOut ? String(cart.updatedAt || '').trim() || null : null,
  });
}

async function syncAssetToManagedToolSource(nextAsset, previousAsset = null) {
  if (String(nextAsset?.managedSource || '').trim() !== 'tools') return;

  const nextSerial = String(nextAsset.serialNumber || nextAsset.tagNumber || '').trim();
  const previousSerial = String(previousAsset?.serialNumber || previousAsset?.tagNumber || '').trim();
  if (!nextSerial && !previousSerial) return;

  const lower = (value) => String(value || '').trim().toLowerCase();
  const tools = (await loadJSON(PATHS.TOOL_PATH, [])).map((tool) => ({ ...tool }));
  const idx = tools.findIndex((tool) =>
    lower(tool.serialNumber || tool.serial || tool.SerialNumber) === lower(previousSerial || nextSerial)
  );

  const current = idx >= 0 ? { ...tools[idx] } : {};
  const merged = {
    ...current,
    serialNumber: nextSerial || previousSerial,
    model: String(nextAsset.name || '').trim(),
    toolType: String(nextAsset.equipmentClass || '').trim(),
    classification: String(nextAsset.toolClassification || '').trim(),
    torque: String(nextAsset.torque || '').trim(),
    description: String(nextAsset.description || '').trim(),
    slot: extractSlotFromLocation(nextAsset.location) || String(current.slot || '').trim(),
    calibrationDate: String(nextAsset.lastCalibrationDate || '').trim(),
    nextCalibrationDue: String(nextAsset.nextCalibrationDue || '').trim(),
    status: mapAssetStatusToToolStatus(nextAsset.status),
    building: normalizeBuilding(nextAsset.building, { allowBlank: false, fallback: DEFAULT_BUILDING }),
  };

  if (idx >= 0) tools[idx] = merged;
  else tools.push(merged);

  await fsp.writeFile(PATHS.TOOL_PATH, JSON.stringify(tools, null, 2));
}

// ── Page renderer ─────────────────────────────────────────────────────────────
const renderCatalog = async (req, res, next) => {
  try {
    await loadAuditRules();

    const q           = (req.query.q || '').trim();
    const category    = (req.query.category || '').trim();
    const auditStatus = (req.query.auditStatus || '').trim();
    const status      = (req.query.status || '').trim();
    const attention   = (req.query.attention || '').trim();
    const building    = (req.query.building || '').trim();
    const itemType    = (req.query.itemType || '').trim();   // NEW: 'fleet' | 'equipment' | ''
    const equipmentClass = (req.query.equipmentClass || '').trim();
    const managedSource = (req.query.managedSource || '').trim();
    const page        = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit       = req.query.limit === 'all' ? 10000 : (parseInt(req.query.limit, 10) || 25);

    const where = {};
    if (q) {
      const terms = q.split(/,|\n/).map(s => s.trim()).filter(Boolean);
      if (terms.length) {
        where[Op.or] = terms.flatMap(term =>
          ['name', 'tagNumber', 'location', 'serialNumber'].map(field => ({
            [field]: { [Op.like]: `%${term}%` },
          }))
        );
      }
    }
    if (category) where.category = category;
    if (status === 'in-use-group') {
      where.status = { [Op.in]: ['In Use', 'Checked Out'] };
    } else if (status) {
      where.status = status;
    }
    if (building && building !== 'all') where.building = building;
    if (itemType && ['fleet', 'equipment'].includes(itemType)) {
      where.itemType = itemType;
    }
    if (equipmentClass) where.equipmentClass = equipmentClass;
    if (managedSource) where.managedSource = managedSource;

    const optionWhere = {};
    if (building && building !== 'all') optionWhere.building = building;
    if (itemType && ['fleet', 'equipment'].includes(itemType)) optionWhere.itemType = itemType;
    if (managedSource) optionWhere.managedSource = managedSource;

    const allCategoriesRaw = await Asset.findAll({
      attributes: ['category'],
      where: optionWhere,
      group: ['category'],
      raw: true,
    });
    const allCategories = allCategoriesRaw.map(r => r.category).filter(Boolean).sort();

    const allEquipmentClassesRaw = await Asset.findAll({
      attributes: ['equipmentClass'],
      where: optionWhere,
      group: ['equipmentClass'],
      raw: true,
    });
    const allEquipmentClasses = allEquipmentClassesRaw
      .map((r) => r.equipmentClass)
      .filter(Boolean)
      .sort();

    const assets = await Asset.findAll({
      where,
      order: [['id', 'ASC']],
      include: [{ model: AuditLog, as: 'auditLogs' }],
    });

    // Pre-compute audit/calibration status for every asset so EJS never
    // receives a function reference (function source containing backticks
    // breaks EJS's template compiler).
    const assetsWithStatus = assets.map(asset => {
      const a = asset.toJSON ? asset.toJSON() : { ...asset };
      const rule = auditRules && auditRules[a.category];
      const freqDays = Number(rule && rule.frequencyDays || 0);

      // Fleet PM status
      let pmDue = false, pmOverdue = false, pmNextDue = null;
      if (freqDays > 0) {
        const logs = (a.auditLogs || []).slice().sort(
          (x, y) => new Date(y.auditDate) - new Date(x.auditDate)
        );
        const lastLog = logs.find(l => l && l.auditDate);
        if (!lastLog) {
          pmDue = true; pmOverdue = true;
        } else {
          const last    = new Date(lastLog.auditDate);
          const nextDue = new Date(last.getTime() + freqDays * 86400000);
          const dueSoon = new Date(nextDue.getTime() - 7 * 86400000);
          const now     = new Date();
          pmDue     = now >= dueSoon;
          pmOverdue = now >= nextDue;
          const y = nextDue.getFullYear();
          const m = String(nextDue.getMonth() + 1).padStart(2, '0');
          const d = String(nextDue.getDate()).padStart(2, '0');
          pmNextDue = y + '-' + m + '-' + d;
        }
      }

      // Equipment calibration status
      let calCls = 'cal-none', calLabel = 'Not set';
      if (a.itemType === 'equipment' && a.nextCalibrationDue) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due   = new Date(a.nextCalibrationDue);
        const days  = Math.ceil((due - today) / 86400000);
        if (days < 0) {
          calCls = 'cal-overdue';
          calLabel = 'Overdue ' + Math.abs(days) + 'd';
        } else if (days <= 14) {
          calCls = 'cal-due-soon';
          calLabel = 'Due in ' + days + 'd';
        } else {
          const mo = due.toLocaleString('default', { month: 'short' });
          calLabel = mo + ' ' + due.getDate() + ', ' + due.getFullYear();
          calCls = 'cal-ok';
        }
      }

      a._pmStatus = { due: pmDue, overdue: pmOverdue, nextDue: pmNextDue };
      a._calCls   = calCls;
      a._calLabel = calLabel;
      return a;
    });

    let filteredAssets = assetsWithStatus;
    if (auditStatus) {
      filteredAssets = filteredAssets.filter((asset) => {
        if (asset.itemType === 'equipment') return true;
        if (auditStatus === 'overdue') return !!asset._pmStatus?.overdue;
        if (auditStatus === 'due') return !!asset._pmStatus?.due;
        if (auditStatus === 'ok') return !asset._pmStatus?.due && !asset._pmStatus?.overdue;
        return true;
      });
    }
    if (attention === 'calibration') {
      filteredAssets = filteredAssets.filter((asset) => {
        if (!asset.nextCalibrationDue) return false;
        const due = new Date(asset.nextCalibrationDue);
        if (Number.isNaN(due.getTime())) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.ceil((due - today) / 86400000);
        return days <= 14;
      });
    }

    const total = filteredAssets.length;
    const offset = (page - 1) * limit;
    const pagedAssets = filteredAssets.slice(offset, offset + limit);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const summary = {
      available: filteredAssets.filter((asset) => asset.status === 'Available').length,
      inUse: filteredAssets.filter((asset) => asset.status === 'In Use' || asset.status === 'Checked Out').length,
      maintenance: filteredAssets.filter((asset) => asset.status === 'Maintenance').length,
      calibrationAttention: filteredAssets.filter((asset) => {
        if (!asset.nextCalibrationDue) return false;
        const due = new Date(asset.nextCalibrationDue);
        if (Number.isNaN(due.getTime())) return false;
        const days = Math.ceil((due - today) / 86400000);
        return days <= 14;
      }).length,
    };

    res.render('index', {
      assets: pagedAssets,
      auditRules,
      themeClass: 'theme-light',
      summary,
      q, category, auditStatus, status, attention, building, itemType, equipmentClass, managedSource, page, limit, total, allCategories, allEquipmentClasses,
    });
  } catch (err) { next(err); }
};

// ── JSON APIs ─────────────────────────────────────────────────────────────────
const getAllAssets = async (req, res) => {
  try {
    const building = String(req.query?.building || '').trim();
    const where = building && building !== 'all' ? { building } : undefined;
    const assets = await Asset.findAll({
      where,
      include: [{ model: AuditLog, as: 'auditLogs' }],
    });
    res.json(assets);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
};

const getAssetData = async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id, {
      include: [{ model: AuditLog, as: 'auditLogs' }],
    });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    res.json(asset);
  } catch (err) { next(err); }
};

const getAudits = async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id, {
      include: [{ model: AuditLog, as: 'auditLogs' }],
    });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    res.json(asset.auditLogs || []);
  } catch (err) { next(err); }
};

const viewAsset = async (req, res, next) => {
  try {
    await loadAuditRules();
    const asset = await Asset.findByPk(req.params.id, {
      include: [{ model: AuditLog, as: 'auditLogs' }],
    });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    const status = getAuditStatus(asset.toJSON(), auditRules, asset.auditLogs || []);
    res.json({ ...asset.toJSON(), auditStatus: status });
  } catch (err) { next(err); }
};

// ── CRUD ──────────────────────────────────────────────────────────────────────
const createAsset = (io) => async (req, res, next) => {
  try {
    const payload = sanitizeAssetData(req.validatedBody || req.body);
    const existing = await Asset.findOne({ where: { tagNumber: payload.tagNumber } });
    if (existing) {
      return res.status(409).json({
        message: `Tag Number ${payload.tagNumber} already exists.`,
        details: [{ path: 'tagNumber', message: 'Tag Number already exists.' }],
      });
    }
    const asset = await Asset.create(payload);
    await syncAssetToManagedToolSource(asset.toJSON());
    // Log the creation with actor
    await AuditLog.create({
      assetId:     asset.id,
      auditorName: sessionActor(req),
      comments:    `Asset created: ${asset.name} (${asset.tagNumber})`,
      passed:      true,
      auditDate:   new Date(),
    });
    io?.publish?.assetsUpdated?.({ id: asset.id, action: 'create' });
    res.status(201).json(asset);
  } catch (err) { next(err); }
};

const updateAsset = (io) => async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    const previous = asset.toJSON();

    const incoming = sanitizeAssetData(req.validatedBody || req.body);

    // Strip empty strings from optional equipment fields to avoid overwriting
    // with blanks when a fleet asset is edited (form sends empty strings)
    for (const f of EQUIPMENT_FIELDS) {
      if (incoming[f] === '') incoming[f] = null;
    }

    await asset.update(incoming);
    await syncAssetToManagedToolSource(asset.toJSON(), previous);
    // Log the update with actor
    await AuditLog.create({
      assetId:     asset.id,
      auditorName: sessionActor(req),
      comments:    `Asset updated: ${asset.name} (${asset.tagNumber})`,
      passed:      true,
      auditDate:   new Date(),
    });
    io?.publish?.assetsUpdated?.({ id: asset.id, action: 'update' });
    res.json(asset);
  } catch (err) { next(err); }
};

const deleteAsset = (io) => async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    const id = asset.id;
    await asset.destroy();
    io?.publish?.assetsUpdated?.({ id, action: 'delete' });
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
};

// ── NEW: Calibration update ───────────────────────────────────────────────────
// PATCH /asset-catalog/:id/calibration
// Body: { lastCalibrationDate, calibrationIntervalDays?, nextCalibrationDue? }
//
// Records a calibration event and advances nextCalibrationDue.
// If calibrationIntervalDays is provided (or already set on the asset) the
// next due date is computed automatically; otherwise nextCalibrationDue is
// taken from the request body directly.
const updateCalibration = (io) => async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.itemType !== 'equipment') {
      return res.status(400).json({
        message: 'Calibration tracking is only available for equipment items.',
      });
    }

    const body = req.body || {};
    const lastDate  = String(body.lastCalibrationDate  || '').trim();
    const intervalDays =
      parseInt(body.calibrationIntervalDays, 10) ||
      asset.calibrationIntervalDays ||
      null;

    if (!lastDate) {
      return res.status(400).json({ message: 'lastCalibrationDate is required.' });
    }

    const last = new Date(lastDate);
    if (Number.isNaN(last.getTime())) {
      return res.status(400).json({ message: 'Invalid lastCalibrationDate format. Use YYYY-MM-DD.' });
    }

    let nextDue = null;
    if (intervalDays && intervalDays > 0) {
      const nd = new Date(last);
      nd.setDate(nd.getDate() + intervalDays);
      nextDue = nd.toISOString().slice(0, 10);
    } else if (body.nextCalibrationDue) {
      nextDue = String(body.nextCalibrationDue).trim();
    }

    const updates = {
      lastCalibrationDate: lastDate,
      nextCalibrationDue:  nextDue,
      calibrationIntervalDays: intervalDays,
      // If the asset was 'Expired' due to calibration, restore it
      ...(asset.status === 'Expired' && nextDue ? { status: 'Available' } : {}),
    };

    await asset.update(updates);

    // Emit so Expiration Dashboard refreshes
    io?.publish?.assetsUpdated?.({ id: asset.id, action: 'calibration' });
    io?.emit?.('toolsUpdated', { reason: 'asset_calibration', assetId: asset.id });

    res.json({
      ok: true,
      assetId: asset.id,
      lastCalibrationDate: asset.lastCalibrationDate,
      nextCalibrationDue:  asset.nextCalibrationDue,
    });
  } catch (err) { next(err); }
};

// ── NEW: Equipment checkout ───────────────────────────────────────────────────
// POST /asset-catalog/:id/checkout
// Body: { operatorId }
//
// Sets status → 'Checked Out' and records who took it and when.
// Emits socket events so the kiosk's live view refreshes.
const checkoutEquipment = (io) => async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.itemType !== 'equipment') {
      return res.status(400).json({
        message: 'Checkout is only available for equipment items.',
      });
    }
    if (asset.status === 'Checked Out') {
      return res.status(409).json({
        message: `${asset.tagNumber} is already checked out by ${asset.checkedOutBy || 'unknown'}.`,
        checkedOutBy: asset.checkedOutBy,
        checkedOutAt: asset.checkedOutAt,
      });
    }
    if (['Defective', 'Maintenance'].includes(asset.status)) {
      return res.status(409).json({
        message: `${asset.tagNumber} cannot be checked out — status is ${asset.status}.`,
      });
    }

    const operatorId = String(
      req.body?.operatorId ||
      req.session?.user?.techId ||
      req.session?.user?.id ||
      ''
    ).trim() || sessionActor(req);

    const now = new Date().toISOString();
    await asset.update({
      status:       'Checked Out',
      checkedOutBy: operatorId,
      checkedOutAt: now,
    });

    const payload = {
      assetId:    asset.id,
      tagNumber:  asset.tagNumber,
      name:       asset.name,
      operatorId,
      at:         now,
    };
    io?.emit?.('asset:checkout', payload);
    io?.publish?.assetsUpdated?.({ ...payload, action: 'checkout' });

    res.json({ ok: true, asset: asset.toJSON() });
  } catch (err) { next(err); }
};

// ── NEW: Equipment checkin (return) ──────────────────────────────────────────
// POST /asset-catalog/:id/checkin
// Body: { operatorId?, condition? }   (condition: 'Good' | 'Needs Inspection' | 'Damaged')
//
// Clears checkout fields, sets status back to 'Available'.
// If condition is 'Damaged' or 'Needs Inspection', sets status to 'Maintenance'
// and creates a project task (same pattern as screwdriver tool returns).
const checkinEquipment = (io) => async (req, res, next) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.itemType !== 'equipment') {
      return res.status(400).json({
        message: 'Checkin is only available for equipment items.',
      });
    }
    if (asset.status !== 'Checked Out') {
      return res.status(409).json({
        message: `${asset.tagNumber} is not currently checked out.`,
      });
    }

    const condition  = String(req.body?.condition || 'Good').trim();
    const operatorId = String(
      req.body?.operatorId ||
      req.session?.user?.techId ||
      req.session?.user?.id ||
      asset.checkedOutBy ||
      ''
    ).trim() || sessionActor(req);

    const needsMaintenance = ['Damaged', 'Needs Inspection'].includes(condition);
    const newStatus = needsMaintenance ? 'Maintenance' : 'Available';

    await asset.update({
      status:       newStatus,
      checkedOutBy: null,
      checkedOutAt: null,
    });

    const now = new Date().toISOString();
    const payload = {
      assetId:    asset.id,
      tagNumber:  asset.tagNumber,
      name:       asset.name,
      operatorId,
      condition,
      at:         now,
    };
    io?.emit?.('asset:checkin', payload);
    io?.publish?.assetsUpdated?.({ ...payload, action: 'checkin' });

    // Auto-create a maintenance task if condition is not Good
    if (needsMaintenance) {
      try {
        await taskService.createTask(null, {
          title: `${condition}: ${asset.tagNumber} — ${asset.name}`,
          description: `Equipment returned in condition: ${condition}. Returned by ${operatorId || 'unknown'} at ${now}.`,
          bucket: 'todo',
          domain: 'project',
          category: 'Equipment',
          meta: {
            source:    'equipment_return',
            assetId:   asset.id,
            tagNumber: asset.tagNumber,
            condition,
            operatorId,
          },
        });
        io?.publish?.projectsUpdated?.({ reason: 'equipment_return_issue' });
      } catch (e) {
        // Non-fatal — checkin still succeeds even if task creation fails
        console.warn('[assetsService] Failed to create maintenance task:', e?.message);
      }
    }

    res.json({ ok: true, asset: asset.toJSON(), condition });
  } catch (err) { next(err); }
};

// ── CSV export / import (unchanged) ──────────────────────────────────────────
const exportCSV = async (req, res, next) => {
  try {
    const building = String(req.query?.building || '').trim();
    const where = building && building !== 'all' ? { building } : undefined;
    const assets = await Asset.findAll({ where, raw: true });
    const safe   = assets.map(a => csvSafeObject(a));
    const parser = new Parser();
    const csv    = parser.parse(safe);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
    res.send(csv);
  } catch (err) { next(err); }
};

const importCSV = (io) => [
  upload.single('file'),
  async (req, res, next) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const importBuilding = normalizeBuilding(
      String(req.body?.building || req.query?.building || '').trim(),
      { allowBlank: true, fallback: '' }
    );
    const results = [];
    try {
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csvParser())
          .on('data', row => results.push(row))
          .on('end', resolve)
          .on('error', reject);
      });
      let created = 0; let updated = 0;
      for (const raw of results) {
        const data = sanitizeAssetData(raw);
        if (!data.building) data.building = importBuilding || 'Bldg-350';
        if (!data.tagNumber) continue;
        const existing = await Asset.findOne({ where: { tagNumber: data.tagNumber } });
        if (existing) { await existing.update(data); updated++; }
        else           { await Asset.create(data);    created++; }
      }
      fs.unlink(req.file.path, () => {});
      io?.publish?.assetsUpdated?.({ action: 'import', created, updated });
      res.json({ message: `Import complete: ${created} created, ${updated} updated.` });
    } catch (err) {
      fs.unlink(req.file?.path, () => {});
      next(err);
    }
  },
];

// ── Bulk audit (unchanged) ────────────────────────────────────────────────────
const bulkAudit = (io) => async (req, res, next) => {
  try {
    const ids = (req.body.assetIds || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ message: 'No assets selected.' });
    const auditorName = sessionActor(req);
    const criteria    = req.body.criteria || {};
    const passed      = req.body.passed !== false;
    const comments    = req.body.comments || '';

    const logs = await AuditLog.bulkCreate(
      ids.map(assetId => ({
        assetId,
        auditorName,
        criteria,
        passed,
        comments,
        auditDate: new Date(),
      }))
    );
    io?.publish?.assetsUpdated?.({ action: 'bulk_audit', count: logs.length });
    res.json({ message: `Audited ${logs.length} assets.`, logs });
  } catch (err) { next(err); }
};

const syncManagedAssets = (io) => async (_req, res, next) => {
  try {
    const rawTools = await loadJSON(PATHS.TOOL_PATH, []);
    const carts = await esdCartsService.getAll();

    const toolAssets = (Array.isArray(rawTools) ? rawTools : [])
      .map(toolToManagedAsset)
      .filter((asset) => asset.tagNumber);
    const cartAssets = (Array.isArray(carts) ? carts : [])
      .map(cartToManagedAsset)
      .filter((asset) => asset.tagNumber);

    const managedAssets = [...toolAssets, ...cartAssets];
    if (!managedAssets.length) {
      return res.json({
        message: 'No managed tools or carts were available to sync.',
        created: 0,
        updated: 0,
        total: 0,
      });
    }

    const existing = await Asset.findAll({
      where: { tagNumber: { [Op.in]: managedAssets.map((asset) => asset.tagNumber) } },
    });
    const existingByTag = new Map(existing.map((asset) => [asset.tagNumber, asset]));

    let created = 0;
    let updated = 0;

    for (const payload of managedAssets) {
      const current = existingByTag.get(payload.tagNumber);
      if (current) {
        await current.update(payload);
        updated += 1;
      } else {
        await Asset.create(payload);
        created += 1;
      }
    }

    io?.publish?.assetsUpdated?.({ action: 'managed_sync', created, updated, total: managedAssets.length });
    res.json({
      message: `Managed assets sync complete: ${created} created, ${updated} updated.`,
      created,
      updated,
      total: managedAssets.length,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  renderCatalog,
  getAllAssets,
  getAssetData,
  getAudits,
  viewAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  updateCalibration,
  checkoutEquipment,
  checkinEquipment,
  exportCSV,
  importCSV,
  bulkAudit,
  syncManagedAssets,
};
