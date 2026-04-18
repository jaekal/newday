// routes/inventory.js
// Backend-agnostic (JSON/Sequelize) inventory routes using services/inventoryRepo.js.

import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import csvParser from 'csv-parser';
import Joi from 'joi';
import { Parser as CsvParser } from 'json2csv';
import { csvSafeRow, csvSafeObject, csvSafeCell } from '../utils/csv.js';
import inventoryRepo from '../services/inventoryRepo.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import idempotency from '../middleware/idempotency.js';

// Build a rich actor string: "Name (username)" or just "username" or req.ip
function sessionActor(req) {
  const u = req.session?.user;
  if (!u) return req.ip || 'system';
  const name = (u.name || u.username || u.id || '').trim();
  const id   = (u.id   || u.username || '').trim();
  return name && name !== id ? `${name} (${id})` : (id || req.ip || 'system');
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const AUDIT_LOG_PATH = path.join(DATA_DIR, 'inventory_audit.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/;
const DEFAULT_IMAGE = path.join(IMAGES_DIR, 'default.png');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* -------------------------------- Uploads -------------------------------- */
const imageUpload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.test(file.mimetype)) return cb(new Error('Invalid file type'));
    cb(null, true);
  },
});

const csvUpload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/octet-stream',
      'text/plain',
    ].includes(file.mimetype);
    if (!ok) return cb(new Error('Invalid CSV file type'));
    cb(null, true);
  },
});

/* ------------------------------ Validation ------------------------------ */
const baseItem = {
  ItemCode: Joi.string().trim(),
  Category: Joi.string().allow(''),
  Location: Joi.string().allow(''),
  Description: Joi.string().allow(''),
  OnHandQty: Joi.number().integer().min(0),
  UnitPrice: Joi.number().min(0),
  SafetyWarningOn: Joi.boolean(),
  SafetyLevelQty: Joi.number().integer().min(0),
  BelowSafetyLine: Joi.boolean(),
  Vendor: Joi.string().allow(''),
  PurchaseLink: Joi.string().allow(''),
  TrackingNumber: Joi.string().allow(''),
  OrderDate: Joi.string().allow(''),
  ExpectedArrival: Joi.string().allow(''),
  OrderStatus: Joi.string().valid('In Stock', 'Low Stock', 'Out of Stock', 'Ordered'),
  PartNumber: Joi.string().allow(''),
  PurchaseOrderNumber: Joi.string().allow(''),
  Building: Joi.string().allow('').optional(),
};

const createSchema = Joi.object({
  body: Joi.object({ ...baseItem, ItemCode: baseItem.ItemCode.required() }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const updateSchema = Joi.object({
  body: Joi.object(baseItem),
  params: Joi.object({ code: Joi.string().trim().required() }),
  query: Joi.object({}),
});

const listSchema = Joi.object({
  query: Joi.object({
    q: Joi.string().allow(''),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
    building: Joi.string().allow('').optional(),
  }),
  body: Joi.object({}),
  params: Joi.object({}),
});

const checkoutSchema = Joi.object({
  body: Joi.object({
    qty: Joi.number().integer().min(1).required(),
    operatorId: Joi.string().required(),
    sixSOperator: Joi.string().allow('').optional(),
  }),
  params: Joi.object({ code: Joi.string().required() }),
  query: Joi.object({}),
});

const checkinSchema = Joi.object({
  body: Joi.object({
    qty: Joi.number().integer().min(1).required(),
    operatorId: Joi.string().required(),
  }),
  params: Joi.object({ code: Joi.string().required() }),
  query: Joi.object({}),
});

const auditExportSchema = Joi.object({
  query: Joi.object({ start: Joi.string().allow(''), end: Joi.string().allow('') }),
  body: Joi.object({}),
  params: Joi.object({}),
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

function imageFileStem(code = '') {
  return encodeURIComponent(String(code || '').trim());
}

function imageFileCandidates(code = '', suffix = '.webp') {
  const raw = String(code || '').trim();
  const safe = imageFileStem(raw);
  const ordered = [];
  if (safe) ordered.push(path.join(IMAGES_DIR, `${safe}${suffix}`));
  if (raw && raw !== safe) ordered.push(path.join(IMAGES_DIR, `${raw}${suffix}`));
  return ordered;
}

function firstExistingImagePath(code = '', suffix = '.webp') {
  for (const file of imageFileCandidates(code, suffix)) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/* -------------------------------- Router -------------------------------- */
export default (io) => {
  const router = express.Router();

  // EXPORT
  router.get(
    '/export',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    ah(async (req, res) => {
      const building = String(req.query.building || '').trim();
      const all = await inventoryRepo.getInventory({ building });
      const enriched = all.map((item) => {
        const qty = +item.OnHandQty || 0;
        const safety = +item.SafetyLevelQty || 0;
        const below = qty <= safety;
        const derived = qty === 0 ? 'Out of Stock' : below ? 'Low Stock' : (item.OrderStatus || 'In Stock');
        return { ...item, BelowSafetyLine: below, OrderStatus: derived };
      });

      const fields = [
        'ItemCode',
        'Category',
        'Location',
        'Building',
        'Description',
        'OnHandQty',
        'UnitPrice',
        'SafetyLevelQty',
        'TrackingNumber',
        'OrderDate',
        'ExpectedArrival',
        'Vendor',
        'PurchaseLink',
        'PartNumber',
        'PurchaseOrderNumber',
      ];

      const rows = enriched.map((it) => {
        const row = {};
        for (const f of fields) row[f] = it[f] ?? '';
        return csvSafeObject(row);
      });

      const parser = new CsvParser({ fields });
      const csv = parser.parse(rows);
      res.header('Content-Type', 'text/csv');
      res.attachment('inventory_export.csv').send(csv);
    })
  );

  // IMPORT — FULL SYNC
  router.post(
    '/import',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    idempotency(),
    csvUpload.single('file'),
    ah(async (req, res) => {
      if (!req.file) return res.status(400).send('No file uploaded');
      const importBuilding = String(req.body?.building || req.query?.building || '').trim();

      const importedRows = [];
      try {
        await new Promise((resolve, reject) => {
          fs.createReadStream(req.file.path)
            .pipe(csvParser())
            .on('data', (row) => importedRows.push(row))
            .on('end', resolve)
            .on('error', reject);
        });
      } finally {
        try {
          await fsp.unlink(req.file.path);
        } catch {}
      }

      const normalizeHeaderKey = (value) =>
        String(value == null ? '' : value)
          .replace(/^\uFEFF/, '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');

      const readCell = (raw, ...aliases) => {
        for (const alias of aliases) {
          if (Object.prototype.hasOwnProperty.call(raw || {}, alias) && raw[alias] != null) {
            return raw[alias];
          }
        }
        const normalized = new Map(
          Object.entries(raw || {}).map(([key, value]) => [normalizeHeaderKey(key), value])
        );
        for (const alias of aliases) {
          const hit = normalized.get(normalizeHeaderKey(alias));
          if (hit != null) return hit;
        }
        return '';
      };

      const norm = (raw) => {
        const t = (v) => (v == null ? '' : String(v)).replace(/^\uFEFF/, '').trim();
        return {
          ItemCode: t(readCell(raw, 'ItemCode', 'Item Code', 'Code', 'SKU')),
          Category: t(readCell(raw, 'Category')),
          Location: t(readCell(raw, 'Location')),
          Description: t(readCell(raw, 'Description', 'Item Description')),
          OnHandQty: Number(readCell(raw, 'OnHandQty', 'On Hand Qty', 'OnHand', 'Qty')) || 0,
          UnitPrice: Number(readCell(raw, 'UnitPrice', 'Unit Price', 'Price')) || 0,
          SafetyWarningOn: false,
          SafetyLevelQty: Number(readCell(raw, 'SafetyLevelQty', 'Safety Level Qty', 'SafetyQty')) || 0,
          Vendor: t(readCell(raw, 'Vendor')),
          PurchaseLink: t(readCell(raw, 'PurchaseLink', 'Purchase Link')),
          TrackingNumber: t(readCell(raw, 'TrackingNumber', 'Tracking Number')),
          OrderDate: t(readCell(raw, 'OrderDate', 'Order Date')),
          ExpectedArrival: t(readCell(raw, 'ExpectedArrival', 'Expected Arrival')),
          PartNumber: t(readCell(raw, 'PartNumber', 'Part Number')),
          PurchaseOrderNumber: t(readCell(raw, 'PurchaseOrderNumber', 'Purchase Order Number', 'PONumber')),
          Building: t(readCell(raw, 'Building')) || importBuilding || 'Bldg-350',
        };
      };

      const normalizedRows = importedRows.map(norm).filter((row) => row.ItemCode);
      if (importedRows.length && !normalizedRows.length) {
        return res.status(400).json({
          message: 'CSV imported 0 usable rows. Check that the file includes an ItemCode column and comma-separated headers.',
        });
      }

      const existing = await inventoryRepo.getInventory({ building: importBuilding });
      const existingAll = await inventoryRepo.getInventory({ building: 'all' });
      const byCode = new Map(existingAll.map((i) => [i.ItemCode, { ...i }]));
      const byDescCat = new Map(
        existing.map((i) => [`${(i.Description || '').trim()}::${(i.Category || '').trim()}`, { ...i }])
      );

      const newCodes = new Set();
      const renamedFrom = new Set();
      let created = 0;
      let updated = 0;

      for (const row of normalizedRows) {
        newCodes.add(row.ItemCode);

        const old = byCode.get(row.ItemCode);
        if (old) {
          const { fieldChanges } = await inventoryRepo.updateItem(row.ItemCode, row);
          if (Object.keys(fieldChanges || {}).length) {
            updated++;
            await inventoryRepo.addAuditLog({
              ItemCode: row.ItemCode,
              action: 'import_update',
              actor: sessionActor(req),
              time: new Date().toISOString(),
              changes: fieldChanges,
            });
          }
          byCode.set(row.ItemCode, { ...old, ...row });
          continue;
        }

        const key = `${row.Description}::${row.Category}`;
        const maybeOld = byDescCat.get(key);
        if (maybeOld && maybeOld.ItemCode !== row.ItemCode) {
          await inventoryRepo.renameItemCode(maybeOld.ItemCode, row.ItemCode);
          renamedFrom.add(maybeOld.ItemCode);
          const { fieldChanges } = await inventoryRepo.updateItem(row.ItemCode, row);
          updated++;
          await inventoryRepo.addAuditLog({
            ItemCode: row.ItemCode,
            action: 'import_update_rename',
            actor: sessionActor(req),
            time: new Date().toISOString(),
            changes: fieldChanges,
          });
          byCode.delete(maybeOld.ItemCode);
          byCode.set(row.ItemCode, { ...maybeOld, ...row });
        } else {
          const createdItem = await inventoryRepo.addItem(row);
          created++;
          await inventoryRepo.addAuditLog({
            ItemCode: row.ItemCode,
            action: 'import_create',
            actor: sessionActor(req),
            time: new Date().toISOString(),
            changes: inventoryRepo.diffFields({}, createdItem),
          });
          byCode.set(row.ItemCode, { ...createdItem });
        }
      }

      const removed = [];
      for (const oldItem of existing) {
        if (!newCodes.has(oldItem.ItemCode) && !renamedFrom.has(oldItem.ItemCode)) {
          removed.push(oldItem.ItemCode);
        }
      }

      for (const code of removed) {
        try {
          const before = await inventoryRepo.getItemByCode(code);
          await inventoryRepo.deleteItem(code);
          await inventoryRepo.addAuditLog({
            ItemCode: code,
            action: 'import_remove',
            actor: sessionActor(req),
            time: new Date().toISOString(),
            changes: inventoryRepo.diffFields(before || {}, {}),
          });
        } catch (e) {
          console.warn('[inventory/import] remove/audit failed for', code, ':', e?.message || e);
        }
      }

      io.publish?.inventoryUpdated?.({ reason: 'import' });
      res.json({ created, updated, removed: removed.length, total: newCodes.size });
    })
  );

  // AUDIT LOGS
  router.get(
    '/audit-log',
    requireAuth,
    ah(async (_req, res) => {
      const logs = await inventoryRepo.getAllAuditLogs();
      res.status(200).json(logs);
    })
  );

  // AUDIT LOG EXPORT
  router.get(
    '/audit-log/export',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    validate(auditExportSchema),
    ah(async (req, res) => {
      const { start, end } = req.validatedQuery;
      const logs = await inventoryRepo.getAllAuditLogs({ start, end });
      const fields = ['ItemCode', 'qty', 'startingQty', 'operatorId', 'sixSOperator', 'action', 'actor', 'time'];

      const rows = logs.map((e) => ({
        ItemCode: csvSafeCell(e.ItemCode ?? ''),
        qty: e.qty ?? '',
        startingQty: e.startingQty ?? '',
        operatorId: csvSafeCell(e.operatorId ?? ''),
        sixSOperator: csvSafeCell(e.sixSOperator ?? ''),
        action: csvSafeCell(e.action ?? ''),
        actor: csvSafeCell(e.actor ?? ''),
        time: e.time ?? '',
      }));

      const parser = new CsvParser({ fields });
      res.header('Content-Type', 'text/csv');
      res.attachment('audit_log_export.csv').send(parser.parse(rows));
    })
  );

  // LIST
  router.get(
    '/',
    validate(listSchema),
    ah(async (req, res) => {
      const q = (req.validatedQuery.q || '').toLowerCase();
      const page = parseInt(req.validatedQuery.page || '', 10);
      const limit = Math.min(500, parseInt(req.validatedQuery.limit || '', 10) || 100);
      const building = req.validatedQuery.building || '';

      const all = await inventoryRepo.getInventory({ building });
      const filtered = q
        ? all.filter((i) =>
            [i.ItemCode, i.Description, i.Location, i.Vendor, i.PartNumber, i.Category]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          )
        : all;

      if (!Number.isFinite(page)) return res.json(filtered);

      const total = filtered.length;
      const start = (Math.max(1, page) - 1) * limit;
      const items = filtered.slice(start, start + limit);
      res.json({ items, total, page: Math.max(1, page), limit });
    })
  );

  // CREATE
  router.post(
    '/',
    requireAuth,
    requireRole('admin'),
    apiLimiter,
    idempotency(),
    validate(createSchema),
    ah(async (req, res) => {
      const actor = sessionActor(req);
      const created = await inventoryRepo.addItem(req.validatedBody);
      await inventoryRepo.addAuditLog({
        ItemCode: created.ItemCode,
        action: 'create',
        actor,
        time: new Date().toISOString(),
        changes: inventoryRepo.diffFields({}, created),
      });
      io.publish?.inventoryUpdated?.({ reason: 'create', code: created.ItemCode });
      res.status(201).json(created);
    })
  );

  // GET ONE
  router.get(
    '/:code',
    ah(async (req, res) => {
      const item = await inventoryRepo.getItemByCode(req.params.code);
      if (!item) return res.status(404).json({ message: 'Not found' });
      res.json(item);
    })
  );

  // UPDATE
  router.put(
    '/:code',
    requireAuth,
    requireRole('admin', 'lead', 'coordinator', 'management'),
    apiLimiter,
    validate(updateSchema),
    ah(async (req, res) => {
      const actor = sessionActor(req);
      const code = req.validatedParams.code;
      const { item, fieldChanges } = await inventoryRepo.updateItem(code, req.validatedBody);

      await inventoryRepo.addAuditLog({
        ItemCode: item.ItemCode,
        action: 'update',
        actor,
        time: new Date().toISOString(),
        changes: fieldChanges,
      });

      io.publish?.inventoryUpdated?.({ reason: 'update', code });
      res.json(item);
    })
  );

  // DELETE
  router.delete(
    '/:code',
    requireAuth,
    requireRole('admin', 'lead', 'management', 'coordinator'),
    apiLimiter,
    idempotency(),
    ah(async (req, res) => {
      const actor = sessionActor(req);
      const code = req.params.code;
      const before = await inventoryRepo.getItemByCode(code);
      if (!before) return res.status(404).json({ message: 'Not found' });

      await inventoryRepo.deleteItem(code);
      await inventoryRepo.addAuditLog({
        ItemCode: code,
        action: 'delete',
        actor,
        time: new Date().toISOString(),
        changes: inventoryRepo.diffFields(before, {}),
      });

      io.publish?.inventoryUpdated?.({ reason: 'delete', code });
      res.json({ message: 'Deleted' });
    })
  );

  // BULK DELETE
  router.post(
    '/bulk-delete',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    apiLimiter,
    idempotency(),
    ah(async (req, res) => {
      const actor = sessionActor(req);
      const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
      if (!codes.length) return res.status(400).json({ message: 'No items selected' });

      const all = await inventoryRepo.getInventory();
      const beforeByCode = new Map(all.map((i) => [i.ItemCode, i]));

      await inventoryRepo.bulkDelete(codes);

      for (const code of codes) {
        const before = beforeByCode.get(code);
        if (before) {
          await inventoryRepo.addAuditLog({
            ItemCode: code,
            action: 'bulk_delete',
            actor,
            time: new Date().toISOString(),
            changes: inventoryRepo.diffFields(before, {}),
          });
        }
      }

      io.publish?.inventoryUpdated?.({ reason: 'bulk_delete', codes });
      res.json({ message: 'Bulk deleted', codes });
    })
  );

  // UNDO DELETE
  router.post(
    '/undo-delete',
    requireAuth,
    requireRole('admin', 'lead', 'management'),
    apiLimiter,
    idempotency(),
    ah(async (req, res) => {
      const actor = sessionActor(req);
      const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
      if (!codes.length) return res.status(400).json({ message: 'No items selected' });

      const restored = await inventoryRepo.restoreFromTrash(codes);

      for (const item of restored) {
        await inventoryRepo.addAuditLog({
          ItemCode: item.ItemCode,
          action: 'restore',
          actor,
          time: new Date().toISOString(),
          changes: inventoryRepo.diffFields({}, item),
        });
      }

      if (restored.length) {
        io.publish?.inventoryUpdated?.({ reason: 'restore', codes: restored.map((i) => i.ItemCode) });
      }

      res.json({ restored });
    })
  );

  // CHECKOUT (decrement)
  router.post(
    '/:code/checkout',
    requireAuth,
    requireRole('admin', 'lead', 'coordinator', 'management'),
    apiLimiter,
    idempotency(),
    validate(checkoutSchema),
    ah(async (req, res) => {
      const { qty, operatorId, sixSOperator } = req.validatedBody;
      const code = req.validatedParams.code;
      const actor = sessionActor(req);

      if (typeof inventoryRepo.checkout === 'function') {
        try {
          const item = await inventoryRepo.checkout({ code, qty, operatorId, sixSOperator, actor });
          io.publish?.inventoryUpdated?.({ reason: 'checkout', code });
          return res.json({ message: 'Checked out', item });
        } catch (err) {
          const msg = err?.message || 'Checkout failed';
          if (/not found/i.test(msg)) return res.status(404).json({ message: msg });
          if (/insufficient stock/i.test(msg)) return res.status(400).json({ message: msg });
          throw err;
        }
      }

      const before = await inventoryRepo.getItemByCode(code);
      if (!before) return res.status(404).json({ message: 'Not found' });

      const startingQty = Number(before.OnHandQty) || 0;
      if (startingQty < Number(qty || 0)) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }

      const nextQty = Math.max(0, startingQty - Number(qty || 0));
      const { item, fieldChanges } = await inventoryRepo.updateItem(code, { OnHandQty: nextQty });

      await inventoryRepo.addAuditLog({
        ItemCode: code,
        action: 'checkout',
        actor,
        operatorId,
        sixSOperator,
        qty,
        startingQty,
        time: new Date().toISOString(),
        changes: fieldChanges,
      });

      io.publish?.inventoryUpdated?.({ reason: 'checkout', code });
      res.json({ message: 'Checked out', item });
    })
  );

  // CHECKIN (increment)
  router.post(
    '/:code/checkin',
    requireAuth,
    requireRole('admin', 'lead', 'coordinator', 'management'),
    apiLimiter,
    idempotency(),
    validate(checkinSchema),
    ah(async (req, res) => {
      const { qty, operatorId } = req.validatedBody;
      const code = req.validatedParams.code;
      const actor = sessionActor(req);

      if (typeof inventoryRepo.checkin === 'function') {
        try {
          const item = await inventoryRepo.checkin({ code, qty, operatorId, actor });
          io.publish?.inventoryUpdated?.({ reason: 'checkin', code });
          return res.json({ message: 'Checked in', item });
        } catch (err) {
          const msg = err?.message || 'Checkin failed';
          if (/not found/i.test(msg)) return res.status(404).json({ message: msg });
          throw err;
        }
      }

      const before = await inventoryRepo.getItemByCode(code);
      if (!before) return res.status(404).json({ message: 'Not found' });

      const startingQty = Number(before.OnHandQty) || 0;
      const nextQty = startingQty + Number(qty || 0);
      const { item, fieldChanges } = await inventoryRepo.updateItem(code, { OnHandQty: nextQty });

      await inventoryRepo.addAuditLog({
        ItemCode: code,
        action: 'checkin',
        actor,
        operatorId,
        qty,
        startingQty,
        time: new Date().toISOString(),
        changes: fieldChanges,
      });

      io.publish?.inventoryUpdated?.({ reason: 'checkin', code });
      res.json({ message: 'Checked in', item });
    })
  );

  // BULK REORDER EXPORT + mark Ordered
  router.post(
    '/bulk-reorder-export',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    idempotency(),
    ah(async (req, res) => {
      const { codes, requester, justification } = req.body || {};
      if (!Array.isArray(codes) || !codes.length) {
        return res.status(400).json({ message: 'No items selected' });
      }

      const all = await inventoryRepo.getInventory();
      const byCode = new Map(all.map((i) => [i.ItemCode, i]));

      const now = new Date();
      const requestDate = now.toISOString().slice(0, 10);
      const department = '';

      const headers = [
        'Request Date',
        'Department',
        'Description',
        'Part Number',
        'CODE',
        'QTY',
        'Price',
        'Cost',
        'Justification',
        'Storage Location',
        'Controlled Product/Equipment',
        'Requester',
        'Comment',
      ];
      const rows = [headers];

      const updatedCodes = [];
      for (const code of codes) {
        const item = byCode.get(code) || {};
        const raw = [
          requestDate,
          department,
          item.Description || '',
          item.PartNumber || '',
          item.ItemCode || '',
          item.OnHandQty || '',
          item.UnitPrice || '',
          item.UnitPrice && item.OnHandQty ? (Number(item.UnitPrice) * Number(item.OnHandQty)).toFixed(2) : '',
          justification || '',
          item.Location || '',
          '',
          requester || '',
          '',
        ];
        rows.push(csvSafeRow(raw));

        try {
          const { fieldChanges } = await inventoryRepo.updateItem(code, { OrderStatus: 'Ordered' });
          updatedCodes.push(code);
          await inventoryRepo.addAuditLog({
            ItemCode: code,
            action: 'bulk_reorder',
            actor: sessionActor(req),
            time: new Date().toISOString(),
            changes: Object.keys(fieldChanges || {}).length
              ? fieldChanges
              : inventoryRepo.diffFields({ OrderStatus: item?.OrderStatus }, { OrderStatus: 'Ordered' }),
          });
        } catch (e) {
          console.warn('[inventory/bulk-reorder] update/audit failed for', code, ':', e?.message || e);
        }
      }

      if (updatedCodes.length) {
        io.publish?.inventoryUpdated?.({ reason: 'bulk_reorder', codes: updatedCodes });
      }

      const csv = rows
        .map((r) => r.map((v) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

      res.header('Content-Type', 'text/csv');
      res.attachment(`PO_bulk_reorder_${requestDate.replace(/-/g, '')}.csv`).send(csv);
    })
  );

  /* ------------------------------- IMAGES ------------------------------- */

  router.get(
    '/:code/image',
    requireAuth,
    ah(async (req, res) => {
      const code = req.params.code;
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      const file = firstExistingImagePath(code, '.webp');
      if (file) return res.sendFile(file);
      if (fs.existsSync(DEFAULT_IMAGE)) return res.sendFile(DEFAULT_IMAGE);
      res.status(404).end();
    })
  );

  router.post(
    '/:code/image',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    imageUpload.single('image'),
    ah(async (req, res) => {
      const code = req.params.code;
      if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

      const base = path.join(IMAGES_DIR, imageFileStem(code));
      try {
        await sharp(req.file.path)
          .rotate()
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(`${base}.webp`);

        await sharp(req.file.path)
          .rotate()
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(`${base}.thumb.webp`);
      } finally {
        try {
          await fsp.unlink(req.file.path);
        } catch {}
      }

      await inventoryRepo.addAuditLog({
        ItemCode: code,
        action: 'image_upload',
        imageType: '.webp',
        actor: sessionActor(req),
        time: new Date().toISOString(),
      });

      res.json({ message: 'Image uploaded' });
    })
  );

  router.delete(
    '/:code/image',
    requireAuth,
    requireRole('admin', 'lead'),
    apiLimiter,
    ah(async (req, res) => {
      const code = req.params.code;
      const variants = ['.webp', '.thumb.webp'];
      let removed = false;

      for (const suffix of variants) {
        for (const file of imageFileCandidates(code, suffix)) {
          if (fs.existsSync(file)) {
            await fsp.unlink(file);
            removed = true;
            await inventoryRepo.addAuditLog({
              ItemCode: code,
              action: 'image_remove',
              imageType: suffix,
              actor: sessionActor(req),
              time: new Date().toISOString(),
            });
          }
        }
      }

      if (removed) return res.json({ message: 'Image(s) deleted' });
      res.status(404).json({ message: 'No image(s) found' });
    })
  );

  return router;
};
