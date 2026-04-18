// services/inventoryService.js
// Back-compat convenience layer over services/inventoryRepo.js

import inventoryRepo from './inventoryRepo.js';
import { Inventory, Sequelize } from '../models/index.js';

/* ---------------------------- helpers ---------------------------- */

function toNumber(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : v;
}

function codeOf(item = {}) {
  const c = item.ItemCode ?? item.itemCode ?? item.code ?? item.Code ?? item['Item Code'] ?? '';
  return trimStr(String(c ?? ''));
}

function normalize(item = {}) {
  const qty    = toNumber(item.OnHandQty, 0);
  const safety = toNumber(item.SafetyLevelQty, 0);

  const below  = qty <= safety;
  let status   = item.OrderStatus || 'In Stock';
  if (qty === 0) status = 'Out of Stock';
  else if (below && status !== 'Ordered') status = 'Low Stock';

  return {
    ...item,
    ItemCode: codeOf(item),
    Description: trimStr(item.Description),
    Vendor: trimStr(item.Vendor),
    Category: trimStr(item.Category),
    BelowSafetyLine: below,
    OrderStatus: status,
  };
}

/* ---------------------------- queries ---------------------------- */

export async function getInventory() {
  const all = await inventoryRepo.getInventory();
  return (all || [])
    .map(normalize)
    .filter(i => i.ItemCode && i.ItemCode.length > 0);
}

export async function getLowStockItems() {
  const all = await inventoryRepo.getInventory();
  return all
    .map(normalize)
    .filter(i =>
      i.OrderStatus === 'Out of Stock' ||
      i.OrderStatus === 'Low Stock' ||
      i.BelowSafetyLine === true
    )
    .filter(i => !i.EmailNoticeSent);
}

export async function getOutOfStockItems() {
  const data = await getInventory();
  return data.filter((i) => toNumber(i.OnHandQty, 0) === 0);
}

export async function getPendingOrders() {
  const data = await getInventory();
  return data.filter((i) => (i.OrderStatus || '') === 'Ordered');
}

export async function getDashboardStats() {
  const data = await getInventory();
  const totalSkus      = data.length;
  const belowSafety    = data.filter((i) => i.BelowSafetyLine).length;
  const pendingOrders  = data.filter((i) => (i.OrderStatus || '') === 'Ordered').length;
  const inventoryValue = data.reduce(
    (sum, i) => sum + toNumber(i.OnHandQty, 0) * toNumber(i.UnitPrice, 0),
    0
  );
  return { totalSkus, belowSafety, pendingOrders, inventoryValue };
}

/* ---------------------------- mutations ---------------------------- */

export async function markEmailNoticeSent(codes = []) {
  if (!Array.isArray(codes) || !codes.length) return 0;
  await Inventory.update(
    { EmailNoticeSent: true },
    { where: { ItemCode: { [Sequelize.Op.in]: codes } } }
  );
  return codes.length;
}

export default {
  getInventory,
  getLowStockItems,
  getOutOfStockItems,
  getPendingOrders,
  getDashboardStats,
  markEmailNoticeSent,
};
