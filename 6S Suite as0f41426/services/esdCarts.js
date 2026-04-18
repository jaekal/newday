// services/esdCarts.js
//
// Canonical ESD cart state service.
// Data files (under data/kiosk/):
//   esd-carts.json        -- cart state  { carts: [ { id, status, holder, updatedAt }, ... ] }
//   esd-carts-audit.jsonl -- append-only audit log, one JSON object per line
//
// Schema note: cart objects use { id, status, holder, updatedAt }
// status values: 'available' | 'checked_out'

import fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_BUILDING, normalizeBuilding } from '../utils/buildings.js';
import { Asset } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KIOSK_DIR = path.join(__dirname, '../data/kiosk');
const CARTS_PATH = path.join(KIOSK_DIR, 'esd-carts.json');
const AUDIT_PATH = path.join(KIOSK_DIR, 'esd-carts-audit.jsonl');

// ── Internal helpers ────────────────────────────────────────────────────────

async function ensureFiles() {
  await fsp.mkdir(KIOSK_DIR, { recursive: true });

  if (!fs.existsSync(CARTS_PATH)) {
    await fsp.writeFile(CARTS_PATH, JSON.stringify({ carts: [] }, null, 2), 'utf8');
  }

  if (!fs.existsSync(AUDIT_PATH)) {
    await fsp.writeFile(AUDIT_PATH, '', 'utf8');
  }
}

async function readData() {
  await ensureFiles();
  const raw = await fsp.readFile(CARTS_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');
  return {
    carts: Array.isArray(parsed.carts) ? parsed.carts : []
  };
}

async function writeData(data) {
  await fsp.writeFile(CARTS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function appendAudit(rec) {
  const line = JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n';
  await fsp.appendFile(AUDIT_PATH, line, 'utf8');
}

function normalize(cart) {
  const id = String(cart?.id || cart?.cartId || '').trim();
  const rawStatus = String(cart?.status || 'available').trim().toLowerCase();
  const status = rawStatus === 'checked_out' ? 'checked_out' : 'available';

  return {
    id,
    status,
    holder: status === 'checked_out' ? (cart?.holder || null) : null,
    building: normalizeBuilding(cart?.building, { allowBlank: false, fallback: DEFAULT_BUILDING }),
    updatedAt: cart?.updatedAt || new Date().toISOString()
  };
}

function mapCartToAsset(cart = {}) {
  const id = String(cart.id || cart.cartId || '').trim();
  const checkedOut = String(cart.status || '').trim().toLowerCase() === 'checked_out';
  return {
    tagNumber: id,
    name: `ESD Cart ${id}`,
    description: 'Managed from ESD cart roster',
    category: 'ESD Cart',
    location: '',
    building: normalizeBuilding(cart.building, { allowBlank: false, fallback: DEFAULT_BUILDING }),
    status: checkedOut ? 'Checked Out' : 'Available',
    itemType: 'equipment',
    equipmentClass: 'ESD Cart',
    managedSource: 'esd-carts',
    serialNumber: '',
    torque: '',
    toolClassification: '',
    lastCalibrationDate: null,
    nextCalibrationDue: null,
    calibrationIntervalDays: null,
    checkedOutBy: checkedOut ? (String(cart.holder || '').trim() || null) : null,
    checkedOutAt: checkedOut ? (String(cart.updatedAt || '').trim() || null) : null,
  };
}

async function syncManagedAssetFromCart(cart) {
  const payload = mapCartToAsset(cart);
  if (!payload.tagNumber) return;
  const current = await Asset.findOne({ where: { tagNumber: payload.tagNumber } });
  if (current) await current.update(payload);
  else await Asset.create(payload);
}

async function removeManagedAssetForCart(cartId) {
  const id = String(cartId || '').trim();
  if (!id) return;
  await Asset.destroy({ where: { tagNumber: id, managedSource: 'esd-carts' } });
}

function findCartIndex(carts, cartId) {
  const id = String(cartId || '').trim();
  return carts.findIndex(c => String(c?.id || c?.cartId || '').trim() === id);
}

async function getOrCreate(cartId) {
  const data = await readData();
  const idx = findCartIndex(data.carts, cartId);

  if (idx >= 0) {
    return { data, cart: normalize(data.carts[idx]) };
  }

  const created = normalize({
    id: String(cartId || '').trim(),
    status: 'available',
    holder: null,
    building: DEFAULT_BUILDING,
    updatedAt: new Date().toISOString()
  });

  data.carts.push(created);
  await writeData(data);

  return { data, cart: normalize(created) };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getAll({ building = '' } = {}) {
  const data = await readData();
  const target = normalizeBuilding(building, { allowBlank: true });
  return data.carts
    .map(normalize)
    .filter((cart) => !target || cart.building === target);
}

export async function get(cartId, { building = '' } = {}) {
  const id = String(cartId || '').trim();
  const all = await getAll({ building });
  return all.find(c => c.id === id) || null;
}

export async function upsert(cart) {
  const id = String(cart?.id || cart?.cartId || '').trim();
  if (!id) throw new Error('cartId is required');

  const data = await readData();
  const idx = findCartIndex(data.carts, id);
  const next = normalize({ ...cart, id, updatedAt: new Date().toISOString() });

  if (idx >= 0) {
    data.carts[idx] = next;
  } else {
    data.carts.push(next);
  }

  await writeData(data);
  return next;
}

/**
 * @param {string} cartId
 * @param {string} operatorId  Effective holder / operator for the cart row
 * @param {object} [auditMeta]
 * @param {string} [auditMeta.comment]
 * @param {boolean} [auditMeta.operatorOverride] True if operatorId was explicitly different from profile
 * @param {string} [auditMeta.profileOperatorId] Session profile operator id (techId / user id) when override was used
 */
export async function checkout(cartId, operatorId, auditMeta = {}) {
  const id = String(cartId || '').trim();
  const { data, cart } = await getOrCreate(id);

  if (cart.status === 'checked_out') {
    throw new Error(`Cart ${id} is already checked out by ${cart.holder || 'unknown'}`);
  }

  cart.status = 'checked_out';
  cart.holder = operatorId || 'unknown';
  cart.updatedAt = new Date().toISOString();

  const idx = findCartIndex(data.carts, id);
  if (idx >= 0) data.carts[idx] = cart;
  else data.carts.push(cart);

  await writeData(data);
  const comment = String(auditMeta.comment || '').trim();
  const profileOperatorId = String(auditMeta.profileOperatorId || '').trim();
  const operatorOverride = !!auditMeta.operatorOverride;
  const audit = {
    action: 'checkout',
    cartId: id,
    operatorId,
    building: cart.building,
  };
  if (comment) audit.comment = comment;
  if (operatorOverride && profileOperatorId) {
    audit.operatorOverride = true;
    audit.profileOperatorId = profileOperatorId;
  }
  await appendAudit(audit);
  if (operatorOverride && profileOperatorId) {
    await appendAudit({
      action: 'operator_override',
      cartId: id,
      operatorId,
      profileOperatorId,
      context: 'checkout',
    });
  }
  await syncManagedAssetFromCart(cart);
  return cart;
}

export async function checkin(cartId, operatorId, auditMeta = {}) {
  const id = String(cartId || '').trim();
  const { data, cart } = await getOrCreate(id);

  cart.status = 'available';
  cart.holder = null;
  cart.updatedAt = new Date().toISOString();

  const idx = findCartIndex(data.carts, id);
  if (idx >= 0) data.carts[idx] = cart;
  else data.carts.push(cart);

  await writeData(data);
  const comment = String(auditMeta.comment || '').trim();
  const profileOperatorId = String(auditMeta.profileOperatorId || '').trim();
  const operatorOverride = !!auditMeta.operatorOverride;
  const audit = {
    action: 'checkin',
    cartId: id,
    operatorId,
    building: cart.building,
  };
  if (comment) audit.comment = comment;
  if (operatorOverride && profileOperatorId) {
    audit.operatorOverride = true;
    audit.profileOperatorId = profileOperatorId;
  }
  await appendAudit(audit);
  if (operatorOverride && profileOperatorId) {
    await appendAudit({
      action: 'operator_override',
      cartId: id,
      operatorId,
      profileOperatorId,
      context: 'checkin',
    });
  }
  await syncManagedAssetFromCart(cart);
  return cart;
}

export async function updateCart(originalId, updates) {
  const fromId = String(originalId || '').trim();
  const toId = String(updates?.id || '').trim();

  if (!fromId) throw new Error('Cart not found');
  if (!toId) throw new Error('cartId is required');

  const data = await readData();
  const currentIdx = findCartIndex(data.carts, fromId);
  if (currentIdx < 0) throw new Error('Cart not found');

  const existing = normalize(data.carts[currentIdx]);

  if (fromId !== toId) {
    const duplicateIdx = findCartIndex(data.carts, toId);
    if (duplicateIdx >= 0) {
      throw new Error('Target cart id already exists');
    }
  }

  const nextStatus = String(updates?.status || existing.status).trim().toLowerCase() === 'checked_out'
    ? 'checked_out'
    : 'available';

  let nextHolder = updates?.holder ?? existing.holder ?? null;
  nextHolder = String(nextHolder || '').trim() || null;

  if (nextStatus === 'available') {
    nextHolder = null;
  }

  const next = normalize({
    id: toId,
    status: nextStatus,
    holder: nextHolder,
    building: updates?.building ?? existing.building,
    updatedAt: new Date().toISOString()
  });

  data.carts[currentIdx] = next;
  await writeData(data);

  await appendAudit({
    action: 'edit',
    cartId: fromId,
    nextCartId: next.id,
    before: existing,
    after: next
  });

  await syncManagedAssetFromCart(next);
  return next;
}

export async function remove(cartId) {
  const id = String(cartId || '').trim();
  const data = await readData();
  const idx = findCartIndex(data.carts, id);

  if (idx < 0) throw new Error('Cart not found');

  const existing = normalize(data.carts[idx]);
  if (existing.status === 'checked_out') {
    throw new Error('Cannot remove a checked-out cart');
  }

  data.carts.splice(idx, 1);
  await writeData(data);

  await appendAudit({
    action: 'remove',
    cartId: id,
    building: existing.building,
    before: existing
  });

  await removeManagedAssetForCart(id);
  return existing;
}

export async function getAuditLog(limit = 500) {
  await ensureFiles();

  const raw = await fsp.readFile(AUDIT_PATH, 'utf8');
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit);
}
