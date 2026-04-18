// services/inventoryRepo.js
import {
  Inventory,
  InventoryAuditLog,
  sequelize,
  Sequelize,
} from '../models/index.js';

const PICK_FIELDS = [
  'ItemCode', 'Category', 'Location', 'Description',
  'OnHandQty', 'UnitPrice',
  'SafetyWarningOn', 'SafetyLevelQty',
  'BelowSafetyLine', 'OrderStatus',
  'Vendor', 'PurchaseLink',
  'TrackingNumber', 'OrderDate', 'ExpectedArrival',
  'PartNumber', 'PurchaseOrderNumber',
  'EmailNoticeSent', 'updatedAt', 'updatedAtIso', 'createdAt',
  'Building',
];

const toNumber = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const cleanStr = (v) => (v == null ? '' : String(v)).trim();

const stripUndefined = (obj = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
};

function normalizeIn(raw = {}) {
  return {
    ItemCode: cleanStr(raw.ItemCode),
    Category: cleanStr(raw.Category),
    Location: cleanStr(raw.Location),
    Description: cleanStr(raw.Description),
    OnHandQty: Math.max(0, toNumber(raw.OnHandQty, 0)),
    UnitPrice: Math.max(0, toNumber(raw.UnitPrice, 0)),
    SafetyWarningOn: !!raw.SafetyWarningOn,
    SafetyLevelQty: Math.max(0, toNumber(raw.SafetyLevelQty, 0)),
    Vendor: cleanStr(raw.Vendor),
    PurchaseLink: cleanStr(raw.PurchaseLink),
    TrackingNumber: cleanStr(raw.TrackingNumber),
    OrderDate: cleanStr(raw.OrderDate),
    ExpectedArrival: cleanStr(raw.ExpectedArrival),
    OrderStatus: cleanStr(raw.OrderStatus) || undefined, // model may recompute if absent
    PartNumber: cleanStr(raw.PartNumber),
    PurchaseOrderNumber: cleanStr(raw.PurchaseOrderNumber),
    Building: cleanStr(raw.Building) || 'Bldg-350',
  };
}

function computeDerivedPlain(item) {
  const qty = Number(item.OnHandQty) || 0;
  const safety = Number(item.SafetyLevelQty) || 0;
  const below = qty <= safety;

  // precedence: 0 -> Out of Stock, then Low Stock, else keep Ordered if set, else In Stock
  let status = item.OrderStatus || 'In Stock';
  if (qty === 0) status = 'Out of Stock';
  else if (below) status = 'Low Stock';
  else if (status === 'Ordered') status = 'Ordered';
  else status = 'In Stock';

  return { ...item, BelowSafetyLine: below, OrderStatus: status };
}

function pickPlain(instance) {
  const v = instance?.get ? instance.get({ plain: true }) : instance || {};
  const out = {};
  for (const k of PICK_FIELDS) {
    if (k in v) out[k] = v[k];
  }
  return computeDerivedPlain(out);
}

function diffFields(before = {}, after = {}) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const changes = {};
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (b !== a) changes[k] = [b, a];
  }
  return changes;
}

async function addAuditLog(payload) {
  // Accept changes either as array or as {field:[from,to]} → convert to array
  let changes = payload.changes;
  if (changes && !Array.isArray(changes)) {
    changes = Object.entries(changes).map(([field, [from, to]]) => ({
      field, from, to,
    }));
  }

  // Auto-populate building from the inventory item if not supplied
  let building = payload.building || null;
  if (!building && payload.ItemCode) {
    try {
      const item = await Inventory.findByPk(payload.ItemCode, { attributes: ['Building'] });
      building = item?.Building || 'Bldg-350';
    } catch { building = 'Bldg-350'; }
  }

  return InventoryAuditLog.log({
    ...payload,
    building,
    changes,
    time: payload.time || new Date().toISOString(),
  });
}

/* =========================
   Public API
========================= */

async function getInventory({ building } = {}) {
  const where = {};
  if (building && building !== 'all') where.Building = building;
  const rows = await Inventory.findAll({ where });
  return rows.map(pickPlain);
}

async function getItemByCode(code) {
  if (!code) return null;
  const row = await Inventory.findByPk(code);
  return row ? pickPlain(row) : null;
}

async function addItem(data) {
  const input = normalizeIn(data);
  if (!input.ItemCode) throw new Error('ItemCode required');

  const created = await Inventory.create({
    ...input,
    EmailNoticeSent: false,
  });
  const item = pickPlain(created);

  await addAuditLog({
    ItemCode: item.ItemCode,
    action: 'create',
    actor: 'system',
    changes: diffFields({}, item),
  });

  return item;
}

async function updateItem(code, data = {}) {
  if (!code) throw new Error('Missing code');

  const next = normalizeIn(data);
  const rename = cleanStr(next.ItemCode) && next.ItemCode !== code;

  // Load "before" snapshot under the current (old) code
  const before = await getItemByCode(code);
  if (!before) throw new Error('Item not found');

  // Rename primary key first (atomic)
  if (rename) {
    await renameItemCode(code, next.ItemCode);
  }

  const pk = rename ? next.ItemCode : code;

  // Ensure we don't try to re-write PK in the regular update
  const updatePayload = stripUndefined({ ...next, ItemCode: undefined });

  await Inventory.update(
    updatePayload,
    { where: { ItemCode: pk } },
  );

  const afterInst = await Inventory.findByPk(pk);
  const after = pickPlain(afterInst);
  const fieldChanges = diffFields(before, after);

  if (Object.keys(fieldChanges).length) {
    await addAuditLog({
      ItemCode: pk,
      action: 'update',
      actor: 'system',
      changes: fieldChanges,
    });
  }

  return { item: after, fieldChanges };
}

async function deleteItem(code) {
  if (!code) return 0;

  const before = await getItemByCode(code);
  const n = await Inventory.destroy({ where: { ItemCode: code } });

  if (n > 0 && before) {
    await addAuditLog({
      ItemCode: before.ItemCode,
      action: 'delete',
      actor: 'system',
      changes: diffFields(before, {}),
    });
  }

  return n;
}

async function bulkDelete(codes = []) {
  if (!Array.isArray(codes) || !codes.length) return 0;

  // capture before snapshots for audit logs
  const beforeMap = {};
  for (const c of codes) {
    const snap = await getItemByCode(c);
    if (snap) beforeMap[c] = snap;
  }

  const n = await Inventory.destroy({ where: { ItemCode: { [Sequelize.Op.in]: codes } } });

  // write per-item logs best effort
  for (const c of codes) {
    if (beforeMap[c]) {
      await addAuditLog({
        ItemCode: c,
        action: 'delete',
        actor: 'system',
        changes: diffFields(beforeMap[c], {}),
      }).catch(() => {});
    }
  }

  return n;
}

// JSON-mode had a trash can; DB mode: no-op, return []
async function restoreFromTrash(_codes = []) { return []; }

// Atomic rename of primary key
async function renameItemCode(oldCode, newCode) {
  if (!oldCode || !newCode) throw new Error('Both old and new codes are required');
  if (oldCode === newCode) return;

  await sequelize.transaction(async (t) => {
    const exists = await Inventory.findByPk(newCode, { transaction: t });
    if (exists) throw new Error('Target code already exists');

    const row = await Inventory.findByPk(oldCode, { transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw new Error('Source code not found');

    // Primary-key renames are unreliable through instance.save() on SQLite.
    await Inventory.update(
      { ItemCode: newCode },
      {
        where: { ItemCode: oldCode },
        transaction: t,
        hooks: false,
        validate: false,
      }
    );
  });
}

async function checkout({ code, qty, operatorId, sixSOperator, actor }) {
  const before = await Inventory.findByPk(code);
  if (!before) throw new Error('Item not found');

  const startingQty = Number(before.OnHandQty) || 0;

  const updated = await Inventory.checkoutAtomic({
    code,
    qty,
  });

  const item = pickPlain(updated);

  await addAuditLog({
    ItemCode: code,
    action: 'checkout',
    actor: actor || operatorId || sixSOperator || 'system',
    operatorId,
    sixSOperator,
    qty,
    startingQty,
    changes: diffFields(pickPlain(before), item),
  });

  return item;
}

async function checkin({ code, qty, operatorId, actor }) {
  const before = await Inventory.findByPk(code);
  if (!before) throw new Error('Item not found');

  const startingQty = Number(before.OnHandQty) || 0;
  const nextQty = startingQty + Number(qty || 0);

  const [, [updated]] = await Inventory.update(
    { OnHandQty: nextQty, EmailNoticeSent: false },
    { where: { ItemCode: code }, returning: true }
  );

  const item = updated ? pickPlain(updated) : { ...pickPlain(before), OnHandQty: nextQty };

  await addAuditLog({
    ItemCode: code,
    action: 'checkin',
    actor: actor || operatorId || 'system',
    operatorId,
    qty,
    startingQty,
    changes: diffFields(pickPlain(before), item),
  });

  return item;
}

/** Get all audit logs, optionally bounded by date range (ISO yyyy-mm-dd). */
async function getAllAuditLogs({ start, end } = {}) {
  // If you used the scope('between') in the model:
  if (start || end) {
    const scoped = InventoryAuditLog.scope({ method: ['between', start, end] });
    const rows = await scoped.findAll();
    return rows.map((r) => r.get({ plain: true }));
  }
  const rows = await InventoryAuditLog.findAll({ order: [['time', 'DESC'], ['id', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

export default {
  // data
  getInventory,
  getItemByCode,
  addItem,
  updateItem,
  deleteItem,
  bulkDelete,
  restoreFromTrash,
  renameItemCode,

  // audit + ops
  checkout,
  checkin,
  addAuditLog,
  getAllAuditLogs,

  // utilities (exposed so routes don't need to re-implement diff logic)
  diffFields,
};
