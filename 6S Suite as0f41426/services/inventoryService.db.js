// services/inventoryService.db.js
import { Op } from 'sequelize';
import { Inventory, InventoryAuditLog as AuditLog } from '../models/index.js';
import { s } from '../utils/text.js';

/* ───────── helpers ───────── */
const toNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function computeOrderStatus(item) {
  const onHand = toNum(item.OnHandQty, 0);
  const safety = toNum(item.SafetyLevelQty, 0);

  if (onHand === 0) return 'Out of Stock';
  if (onHand > 0 && onHand <= safety) return 'Low Stock';
  return 'In Stock';
}

/**
 * Honor an explicit "Ordered" unless qty goes to 0 (then Out of Stock),
 * or the caller explicitly sets some other status.
 */
function resolveOrderStatus(item, explicitUpdate) {
  if (explicitUpdate === 'Ordered') return 'Ordered';

  const derived = computeOrderStatus(item);
  if (item.OrderStatus === 'Ordered' && explicitUpdate == null && derived !== 'Out of Stock') {
    return 'Ordered';
  }
  return derived;
}

function computeFieldChanges(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const delta = {};

  for (const k of keys) {
    if (prev[k] !== next[k]) {
      delta[k] = { from: prev[k], to: next[k] };
    }
  }
  return delta;
}

/* ───────── service ───────── */
export default {
  async getInventory() {
    const rows = await Inventory.findAll({ order: [['ItemCode', 'ASC']] });
    return rows.map((r) => r.toJSON());
  },

  async getItemByCode(code) {
    const row = await Inventory.findByPk(code);
    return row ? row.toJSON() : undefined;
  },

  async addItem(item) {
    const nowIso = new Date().toISOString();

    const newItem = {
      ItemCode: s(item.ItemCode),
      Category: s(item.Category),
      Location: s(item.Location),
      Description: s(item.Description),
      OnHandQty: toNum(item.OnHandQty, 0),
      UnitPrice: toNum(item.UnitPrice, 0),
      SafetyLevelQty: toNum(item.SafetyLevelQty, 0),
      SafetyWarningOn: !!item.SafetyWarningOn,
      Vendor: s(item.Vendor),
      PurchaseLink: s(item.PurchaseLink),
      OrderDate: s(item.OrderDate),
      ExpectedArrival: s(item.ExpectedArrival),
      TrackingNumber: s(item.TrackingNumber),
      PurchaseOrderNumber: s(item.PurchaseOrderNumber),
      PartNumber: s(item.PartNumber),
      BelowSafetyLine: toNum(item.OnHandQty, 0) <= toNum(item.SafetyLevelQty, 0),
      EmailNoticeSent: false,
      updatedAtIso: nowIso,
    };

    newItem.OrderStatus = resolveOrderStatus(newItem, item?.OrderStatus);

    const row = await Inventory.create(newItem);
    return row.toJSON();
  },

  /**
   * Update (+optional rename).
   * Returns: { item, fieldChanges }
   */
  async updateItem(code, updates) {
    return await Inventory.sequelize.transaction(async (t) => {
      const row = await Inventory.findByPk(code, { transaction: t, lock: t.LOCK.UPDATE });
      if (!row) throw new Error('Item not found');

      const before = row.toJSON();

      // Optional rename
      const newCode = s(updates.ItemCode || '');
      if (newCode && newCode !== code) {
        const exists = await Inventory.findByPk(newCode, { transaction: t });
        if (exists) throw new Error('Duplicate new ItemCode');

        const data = row.toJSON();
        delete data.createdAt;
        delete data.updatedAt;

        await Inventory.create({ ...data, ItemCode: newCode }, { transaction: t });
        await row.destroy({ transaction: t });

        // Cascade rename to audit logs
        await AuditLog.update(
          { ItemCode: newCode },
          { where: { ItemCode: code }, transaction: t }
        );

        const target = await Inventory.findByPk(newCode, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!target) throw new Error('Item not found after rename');

        target.ItemCode = newCode;
        target.Category = s(updates.Category ?? target.Category);
        target.Location = s(updates.Location ?? target.Location);
        target.Description = s(updates.Description ?? target.Description);
        target.Vendor = s(updates.Vendor ?? target.Vendor);
        target.PurchaseLink = s(updates.PurchaseLink ?? target.PurchaseLink);
        target.OrderDate = s(updates.OrderDate ?? target.OrderDate);
        target.ExpectedArrival = s(updates.ExpectedArrival ?? target.ExpectedArrival);
        target.TrackingNumber = s(updates.TrackingNumber ?? target.TrackingNumber);
        target.PurchaseOrderNumber = s(updates.PurchaseOrderNumber ?? target.PurchaseOrderNumber);
        target.PartNumber = s(updates.PartNumber ?? target.PartNumber);

        if (updates.OnHandQty != null) target.OnHandQty = toNum(updates.OnHandQty, target.OnHandQty);
        if (updates.UnitPrice != null) target.UnitPrice = toNum(updates.UnitPrice, target.UnitPrice);
        if (updates.SafetyLevelQty != null) target.SafetyLevelQty = toNum(updates.SafetyLevelQty, target.SafetyLevelQty);
        if (updates.SafetyWarningOn != null) target.SafetyWarningOn = !!updates.SafetyWarningOn;

        target.BelowSafetyLine = toNum(target.OnHandQty, 0) <= toNum(target.SafetyLevelQty, 0);
        target.EmailNoticeSent = false;
        target.updatedAtIso = new Date().toISOString();
        target.OrderStatus = resolveOrderStatus(target, updates?.OrderStatus);

        await target.save({ transaction: t });

        const after = target.toJSON();
        const fieldChanges = computeFieldChanges(before, after);
        return { item: after, fieldChanges };
      }

      // No rename: update in-place
      row.Category = s(updates.Category ?? row.Category);
      row.Location = s(updates.Location ?? row.Location);
      row.Description = s(updates.Description ?? row.Description);
      row.Vendor = s(updates.Vendor ?? row.Vendor);
      row.PurchaseLink = s(updates.PurchaseLink ?? row.PurchaseLink);
      row.OrderDate = s(updates.OrderDate ?? row.OrderDate);
      row.ExpectedArrival = s(updates.ExpectedArrival ?? row.ExpectedArrival);
      row.TrackingNumber = s(updates.TrackingNumber ?? row.TrackingNumber);
      row.PurchaseOrderNumber = s(updates.PurchaseOrderNumber ?? row.PurchaseOrderNumber);
      row.PartNumber = s(updates.PartNumber ?? row.PartNumber);

      if (updates.OnHandQty != null) row.OnHandQty = toNum(updates.OnHandQty, row.OnHandQty);
      if (updates.UnitPrice != null) row.UnitPrice = toNum(updates.UnitPrice, row.UnitPrice);
      if (updates.SafetyLevelQty != null) row.SafetyLevelQty = toNum(updates.SafetyLevelQty, row.SafetyLevelQty);
      if (updates.SafetyWarningOn != null) row.SafetyWarningOn = !!updates.SafetyWarningOn;

      row.BelowSafetyLine = toNum(row.OnHandQty, 0) <= toNum(row.SafetyLevelQty, 0);
      row.EmailNoticeSent = false;
      row.updatedAtIso = new Date().toISOString();
      row.OrderStatus = resolveOrderStatus(row, updates?.OrderStatus);

      await row.save({ transaction: t });

      const after = row.toJSON();
      const fieldChanges = computeFieldChanges(before, after);
      return { item: after, fieldChanges };
    });
  },

  async renameItemCode(oldCode, newCode) {
    return await Inventory.sequelize.transaction(async (t) => {
      const exists = await Inventory.findByPk(newCode, { transaction: t });
      if (exists) throw new Error('Duplicate new ItemCode');

      const row = await Inventory.findByPk(oldCode, { transaction: t, lock: t.LOCK.UPDATE });
      if (!row) throw new Error('Item not found');

      const data = row.toJSON();
      delete data.createdAt;
      delete data.updatedAt;

      await Inventory.create({ ...data, ItemCode: newCode }, { transaction: t });
      await row.destroy({ transaction: t });
      await AuditLog.update(
        { ItemCode: newCode },
        { where: { ItemCode: oldCode }, transaction: t }
      );

      const final = await Inventory.findByPk(newCode, { transaction: t });
      return final.toJSON();
    });
  },

  async deleteItem(code) {
    await Inventory.destroy({ where: { ItemCode: code } });
    return true;
  },

  async bulkDelete(codes) {
    await Inventory.destroy({ where: { ItemCode: { [Op.in]: codes } } });
    return true;
  },

  // No-op in DB mode
  async moveToTrash() { /* noop */ },
  async restoreFromTrash() { return []; },

  async getAuditLogs(itemCode) {
    const rows = await AuditLog.findAll({
      where: { ItemCode: itemCode },
      order: [['id', 'ASC']],
    });
    return rows.map((r) => r.toJSON());
  },

  async addAuditLog(log) {
    const row = await AuditLog.create({
      ...log,
      ItemCode: s(log.ItemCode),
      time: log.time || new Date().toISOString(),
    });
    return row.toJSON();
  },

  async getAllAuditLogs({ start, end } = {}) {
    const where = {};
    if (start) where.time = { ...(where.time || {}), [Op.gte]: start };
    if (end) where.time = { ...(where.time || {}), [Op.lte]: end };

    const rows = await AuditLog.findAll({
      where,
      order: [['id', 'ASC']],
    });
    return rows.map((r) => r.toJSON());
  },

  async checkout({ code, qty, operatorId, sixSOperator, actor }) {
    return await Inventory.sequelize.transaction(async (t) => {
      const row = await Inventory.findOne({
        where: { ItemCode: code, OnHandQty: { [Op.gte]: qty } },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!row) {
        const exists = await Inventory.findByPk(code, { transaction: t });
        if (!exists) throw new Error('Item not found');
        throw new Error('Insufficient stock');
      }

      const startingQty = toNum(row.OnHandQty, 0);

      row.OnHandQty = startingQty - qty;
      row.BelowSafetyLine = toNum(row.OnHandQty, 0) <= toNum(row.SafetyLevelQty, 0);
      row.EmailNoticeSent = false;
      row.updatedAtIso = new Date().toISOString();
      row.OrderStatus = resolveOrderStatus(row, null);

      await row.save({ transaction: t });

      await AuditLog.create({
        ItemCode: code,
        qty,
        startingQty,
        operatorId,
        sixSOperator,
        action: 'checkout',
        actor: actor || 'system',
        time: new Date().toISOString(),
      }, { transaction: t });

      return row.toJSON();
    });
  },

  async checkin({ code, qty, operatorId, actor }) {
    return await Inventory.sequelize.transaction(async (t) => {
      const row = await Inventory.findByPk(code, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!row) throw new Error('Item not found');

      const startingQty = toNum(row.OnHandQty, 0);

      row.OnHandQty = startingQty + qty;
      row.BelowSafetyLine = toNum(row.OnHandQty, 0) <= toNum(row.SafetyLevelQty, 0);
      row.EmailNoticeSent = false;
      row.updatedAtIso = new Date().toISOString();
      row.OrderStatus = resolveOrderStatus(row, null);

      await row.save({ transaction: t });

      await AuditLog.create({
        ItemCode: code,
        qty,
        startingQty,
        operatorId,
        action: 'checkin',
        actor: actor || 'system',
        time: new Date().toISOString(),
      }, { transaction: t });

      return row.toJSON();
    });
  },
};