/**
 * routes/transfers.js
 * Building-to-building stock transfer for Inventory, Tools, and Assets.
 *
 * POST /transfers          — execute a transfer (updates source record + logs)
 * GET  /transfers          — list transfer history (optional ?type=&from=&to=&limit=)
 * GET  /transfers/search   — search items available for transfer within a building
 */

import express      from 'express';
import { randomUUID } from 'crypto';
import Joi          from 'joi';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { loadJSON, saveJSON, readModifyWriteJSON } from '../utils/fileUtils.js';
import { PATHS }    from '../config/path.js';
import { Inventory, Asset, Op } from '../models/index.js';
import inventoryRepo from '../services/inventoryRepo.js';
import { InventoryAuditLog } from '../models/index.js';
import path         from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TRANSFERS_PATH = PATHS.TRANSFERS_PATH
  || path.join(__dirname, '../data/transfers.json');

const TOOL_PATH = PATHS.TOOL_PATH
  || path.join(__dirname, '../data/tools.json');

const BUILDINGS = ['Bldg-350', 'Bldg-4050'];

const s   = v => (v == null ? '' : String(v)).trim();
const lc  = v => s(v).toLowerCase();
const now = () => new Date().toISOString();

// Build rich actor string from session user
function sessionActor(req) {
  const u = req.session?.user;
  if (!u) return req.ip || 'system';
  const name = (u.name || u.username || u.id || '').trim();
  const id   = (u.id   || u.username || '').trim();
  return name && name !== id ? `${name} (${id})` : (id || req.ip || 'system');
}

/* ── Persistence ──────────────────────────────────────────────────────── */
async function loadTransfers() {
  const raw = await loadJSON(TRANSFERS_PATH, []);
  return Array.isArray(raw) ? raw : [];
}
async function appendTransfer(entry) {
  await readModifyWriteJSON(
    TRANSFERS_PATH,
    (current) => {
      const list = Array.isArray(current) ? current.slice() : [];
      list.push(entry);
      return list;
    },
    null,
    []
  );
}

/* ── Validation ───────────────────────────────────────────────────────── */
const transferSchema = Joi.object({
  type:         Joi.string().valid('inventory', 'tool', 'asset').required(),
  itemId:       Joi.string().trim().required(),          // ItemCode / serialNumber / asset id
  fromBuilding: Joi.string().valid(...BUILDINGS).required(),
  toBuilding:   Joi.string().valid(...BUILDINGS).required(),
  qty:          Joi.number().integer().min(1).when('type', {
                  is: 'inventory', then: Joi.required(), otherwise: Joi.optional() }),
  notes:        Joi.string().allow('').optional(),
});

/* ── Apply transfer to the underlying record ──────────────────────────── */
async function applyTransfer({ type, itemId, fromBuilding, toBuilding, qty }) {
  if (type === 'inventory') {
    // Sequelize inventory — update Building field, deduct qty if transferring subset
    const item = await Inventory.findByPk(itemId);
    if (!item) throw Object.assign(new Error(`Inventory item "${itemId}" not found`), { status: 404 });
    if ((item.Building || 'Bldg-350') !== fromBuilding) {
      throw Object.assign(new Error(`Item is in ${item.Building || 'Bldg-350'}, not ${fromBuilding}`), { status: 409 });
    }

    const onHand = Number(item.OnHandQty) || 0;
    if (qty > onHand) {
      throw Object.assign(new Error(`Only ${onHand} units on hand; cannot transfer ${qty}`), { status: 400 });
    }

    if (qty === onHand) {
      // Move entire stock to new building
      await item.update({ Building: toBuilding });
      return { snapshot: { ItemCode: itemId, qty: onHand, Building: toBuilding } };
    } else {
      // Partial transfer: check destination record exists BEFORE modifying source
      const dest = await Inventory.findOne({ where: { ItemCode: itemId, Building: toBuilding } });

      if (!dest) {
        throw Object.assign(
          new Error(`No inventory record for "${itemId}" exists in ${toBuilding}. Transfer the full quantity (${onHand}) to move all stock, or create a destination record first.`),
          { status: 409 }
        );
      }

      // Both records confirmed — now safely move qty
      await item.update({ OnHandQty: onHand - qty });
      await dest.update({ OnHandQty: (Number(dest.OnHandQty) || 0) + qty });
      return { snapshot: { ItemCode: itemId, qtyMoved: qty, fromOnHand: onHand, Building: toBuilding } };
    }
  }

  if (type === 'tool') {
    let snapshot = null;
    await readModifyWriteJSON(
      TOOL_PATH,
      (current) => {
        const tools = Array.isArray(current) ? current.slice() : [];
        const idx = tools.findIndex(t =>
          lc(t.serialNumber || t.serial || '') === lc(itemId)
        );
        if (idx === -1) throw Object.assign(new Error(`Tool "${itemId}" not found`), { status: 404 });
        if ((tools[idx].building || 'Bldg-350') !== fromBuilding) {
          throw Object.assign(new Error(`Tool is in ${tools[idx].building || 'Bldg-350'}, not ${fromBuilding}`), { status: 409 });
        }
        if (lc(tools[idx].status) === 'being used') {
          throw Object.assign(new Error('Cannot transfer a checked-out tool'), { status: 409 });
        }
        const before = { ...tools[idx] };
        tools[idx] = { ...tools[idx], building: toBuilding, updatedAt: now() };
        snapshot = { serialNumber: itemId, building: toBuilding, model: before.model };
        return tools;
      },
      null,
      []
    );
    return { snapshot };
  }

  if (type === 'asset') {
    const id  = Number(itemId);
    const asset = await Asset.findByPk(id);
    if (!asset) throw Object.assign(new Error(`Asset #${itemId} not found`), { status: 404 });
    if ((asset.building || 'Bldg-350') !== fromBuilding) {
      throw Object.assign(new Error(`Asset is in ${asset.building || 'Bldg-350'}, not ${fromBuilding}`), { status: 409 });
    }
    await asset.update({ building: toBuilding });
    return { snapshot: { id, tagNumber: asset.tagNumber, name: asset.name, building: toBuilding } };
  }

  throw Object.assign(new Error('Unknown transfer type'), { status: 400 });
}

/* ── Router ───────────────────────────────────────────────────────────── */
export default function transfersRouter(io) {
  const router = express.Router();
  router.use(express.json());

  /* GET /transfers — serve the transfer UI page */
  router.get('/', requireAuth, (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../public/transfers/transfers.html'));
  });

  /* GET /transfers/history — JSON history list */
  router.get('/history', requireAuth, async (req, res, next) => {
    try {
      const list  = await loadTransfers();
      const type  = s(req.query.type);
      const from  = s(req.query.from);
      const to    = s(req.query.to);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

      let result = list;
      if (type) result = result.filter(t => t.type === type);
      if (from) result = result.filter(t => t.fromBuilding === from || t.toBuilding === from);
      if (to)   result = result.filter(t => t.toBuilding === to || t.fromBuilding === to);

      // Most recent first
      result = result.slice().reverse().slice(0, limit);
      res.json({ transfers: result, total: result.length });
    } catch (e) { next(e); }
  });

  /* GET /transfers/search — find transferable items in a building */
  router.get('/search', requireAuth, async (req, res, next) => {
    try {
      const type     = s(req.query.type);
      const building = s(req.query.building) || 'Bldg-350';
      const q        = lc(req.query.q || '');

      if (type === 'inventory') {
        const all = await inventoryRepo.getInventory({ building });
        const filtered = q
          ? all.filter(i => [i.ItemCode, i.Description, i.PartNumber, i.Category]
              .filter(Boolean).some(v => lc(v).includes(q)))
          : all;
        return res.json(filtered.slice(0, 100).map(i => ({
          id:    i.ItemCode,
          label: i.ItemCode,
          desc:  i.Description || '',
          qty:   i.OnHandQty,
          meta:  `${i.OnHandQty} on hand · ${i.Category || 'No category'}`,
        })));
      }

      if (type === 'tool') {
        const tools = (await loadJSON(TOOL_PATH, []))
          .filter(t => (t.building || 'Bldg-350') === building);
        const tokens = q
          ? [...new Set(q.split(/[\s,]+/).map(v => lc(v)).filter(Boolean))]
          : [];
        const filtered = tokens.length
          ? tools.filter(t => {
              const serial = lc(t.serialNumber || t.serial || '');
              return tokens.some(token => serial.includes(token));
            })
          : tools;
        return res.json(filtered.slice(0, 100).map(t => ({
          id:    t.serialNumber,
          label: t.serialNumber,
          desc:  t.model || '',
          status: t.status,
          meta:  `${t.model || '—'} · ${t.classification || '—'} · ${t.status === 'being used' ? '⚠ Checked Out' : 'Available'}`,
        })));
      }

      if (type === 'asset') {
        const where = { building };
        if (q) {
          where[Op.or] = [
            { tagNumber: { [Op.like]: `%${q}%` } },
            { name:      { [Op.like]: `%${q}%` } },
            { category:  { [Op.like]: `%${q}%` } },
          ];
        }
        const assets = await Asset.findAll({ where, limit: 100 });
        return res.json(assets.map(a => ({
          id:    String(a.id),
          label: a.tagNumber,
          desc:  a.name || '',
          meta:  `${a.name || '—'} · ${a.category || '—'} · ${a.status || '—'}`,
        })));
      }

      return res.status(400).json({ message: 'type must be inventory, tool, or asset' });
    } catch (e) { next(e); }
  });

  /* POST /transfers — execute a transfer */
  router.post('/', requireAuth, requireRole('admin', 'lead', 'management'), async (req, res, next) => {
    try {
      const { error, value } = transferSchema.validate(req.body || {}, { abortEarly: false });
      if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });

      const { type, itemId, fromBuilding, toBuilding, qty, notes } = value;

      if (fromBuilding === toBuilding) {
        return res.status(400).json({ message: 'Source and destination buildings must differ' });
      }

      // Apply the change to the underlying record
      const result = await applyTransfer({ type, itemId, fromBuilding, toBuilding, qty: qty || 1 });

      // Log the transfer
      const entry = {
        id:           randomUUID(),
        type,
        itemId,
        fromBuilding,
        toBuilding,
        qty:          type === 'inventory' ? (qty || 1) : null,
        notes:        s(notes),
        actor:        sessionActor(req),
        actorId:      s(req.session?.user?.id || ''),
        actorName:    s(req.session?.user?.name || req.session?.user?.username || ''),
        transferredAt: now(),
        snapshot:     result.snapshot,
      };

      await appendTransfer(entry);

      // Write audit trail entries per type
      const actor = sessionActor(req);
      if (type === 'inventory') {
        await inventoryRepo.addAuditLog({
          ItemCode:    itemId,
          action:      'transfer',
          actor,
          qty:         qty || null,
          building:    toBuilding,
          time:        entry.transferredAt,
          changes:     [{ field: 'Building', from: fromBuilding, to: toBuilding }],
        }).catch(() => {}); // non-fatal
      }
      if (type === 'asset') {
        // Asset AuditLog entry
        const { AuditLog, Asset } = await import('../models/index.js');
        const asset = await Asset.findByPk(Number(itemId)).catch(() => null);
        if (asset) {
          await AuditLog.create({
            assetId:     asset.id,
            auditorName: actor,
            comments:    `Transferred from ${fromBuilding} to ${toBuilding}${notes ? ': ' + notes : ''}`,
            passed:      true,
            auditDate:   new Date(),
          }).catch(() => {});
        }
      }

      // Broadcast so dashboards update
      const reason = `transfer_${type}`;
      if (type === 'inventory') io?.publish?.inventoryUpdated?.({ reason, itemId });
      if (type === 'tool')      io?.emit?.('toolsUpdated', { reason, serialNumber: itemId });
      if (type === 'asset')     io?.publish?.assetsUpdated?.({ reason, id: itemId });

      res.status(201).json({ message: 'Transfer complete', transfer: entry });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ message: e.message });
      next(e);
    }
  });

  return router;
}
