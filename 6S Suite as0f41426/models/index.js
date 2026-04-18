// models/index.js
import { Sequelize, DataTypes, Op } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

// Asset domain
import AssetDef from './asset.js';
import AuditLogDef from './auditlog.js';

// Inventory domain
import InventoryDef from './inventory.js';
import InventoryAuditLogDef from './inventoryAuditLog.js';

// Tool audit log
import ToolAuditLogDef from './toolAuditLog.js';

// Calibration
import CalibrationDef from './calibration.js';

// Expiration / calibration history
import ExpirationHistoryModel from './ExpirationHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || path.resolve('./db.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH,
  logging: process.env.SQL_LOG === '1' ? console.log : false,
});

// Define models
const Asset             = AssetDef(sequelize, DataTypes);
const AuditLog          = AuditLogDef(sequelize, DataTypes);
const Inventory         = InventoryDef(sequelize, DataTypes);
const InventoryAuditLog = InventoryAuditLogDef(sequelize, DataTypes);
const ToolAuditLog      = ToolAuditLogDef(sequelize, DataTypes);
const Calibration       = CalibrationDef(sequelize, DataTypes);
const ExpirationHistory = ExpirationHistoryModel(sequelize, DataTypes);

// Associations
Asset.associate?.({ AuditLog });
AuditLog.associate?.({ Asset });
Inventory.associate?.({ InventoryAuditLog });
InventoryAuditLog.associate?.({ Inventory });
ToolAuditLog.associate?.({});
Calibration.associate?.({});
ExpirationHistory.associate?.({});

// ToolAuditLog, Calibration, and ExpirationHistory intentionally avoid FK links.
// Reason:
// - serial number renames should not break historical records
// - tool or asset deletion should not cascade-destroy history
// - ExpirationHistory.itemId may point to either:
//   - tool serial number
//   - equipment asset id
//   - fleet asset id

// ---------------------------------------------------------------------------
// Safe schema migration helper.
// Additive only — never drops or alters existing columns, so there is no
// risk of the FK-constraint crash that Sequelize { alter: true } triggers.
// ---------------------------------------------------------------------------
async function safeMigrate() {
  const qi = sequelize.getQueryInterface();

  const describeTable = async (table) => {
    try {
      return await qi.describeTable(table);
    } catch {
      return null;
    }
  };

  const addIfMissing = async (table, column, spec) => {
    const info = await describeTable(table);
    if (info && !(column in info)) {
      await qi.addColumn(table, column, spec);
      console.log(`[models] Added column ${table}.${column}`);
    }
  };

  const ensureIndex = async (table, fields, opts = {}) => {
    try {
      const indexes = await qi.showIndex(table);
      const name = opts.name || `${table}_${fields.join('_')}`;
      if (!indexes.some(i => i.name === name)) {
        await qi.addIndex(table, fields, opts);
        console.log(`[models] Added index ${name} on ${table}`);
      }
    } catch (e) {
      if (!String(e?.message).includes('already exists')) {
        console.warn(`[models] ensureIndex ${table}(${fields}):`, e?.message || e);
      }
    }
  };

  // ── inventory columns (original) ──────────────────────────────────────────
  await addIfMissing('inventory', 'Category', {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
  await addIfMissing('inventory', 'PurchaseOrderNumber', {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
  await addIfMissing('inventory', 'updatedAtIso', {
    type: DataTypes.STRING(32),
    allowNull: true,
  });
  // ── building support ─────────────────────────────────────────────────────
  // Inventory: tag which building this stock belongs to (e.g. 'Bldg-350', 'Bldg-4050')
  await addIfMissing('inventory', 'Building', {
    type: DataTypes.STRING(64),
    allowNull: true,
    defaultValue: 'Bldg-350',
  });
  await ensureIndex('inventory', ['Building'], { name: 'inventory__building' });

  // InventoryAuditLog: track which building the action occurred in
  await addIfMissing('inventory_audit_logs', 'building', {
    type: DataTypes.STRING(64),
    allowNull: true,
  });

  // Assets: which building the asset lives in
  await addIfMissing('assets', 'building', {
    type: DataTypes.STRING(64),
    allowNull: true,
    defaultValue: 'Bldg-350',
  });

  // ── assets indexes (original) ─────────────────────────────────────────────
  await ensureIndex('assets', ['category'], { name: 'assets_category' });
  await ensureIndex('assets', ['location'], { name: 'assets_location' });
  await ensureIndex('assets', ['status'], { name: 'assets_status' });

  // ── assets: equipment / calibration support ───────────────────────────────
  await addIfMissing('assets', 'itemType', {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'fleet',
  });
  await addIfMissing('assets', 'equipmentClass', {
    type: DataTypes.STRING(64),
    allowNull: true,
    defaultValue: '',
  });
  await addIfMissing('assets', 'managedSource', {
    type: DataTypes.STRING(32),
    allowNull: false,
    defaultValue: 'asset-catalog',
  });
  await addIfMissing('assets', 'serialNumber', {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
  await addIfMissing('assets', 'torque', {
    type: DataTypes.STRING(64),
    allowNull: true,
    defaultValue: '',
  });
  await addIfMissing('assets', 'toolClassification', {
    type: DataTypes.STRING(32),
    allowNull: true,
    defaultValue: '',
  });
  await addIfMissing('assets', 'lastCalibrationDate', {
    type: DataTypes.STRING(32),
    allowNull: true,
  });
  await addIfMissing('assets', 'nextCalibrationDue', {
    type: DataTypes.STRING(32),
    allowNull: true,
  });
  await addIfMissing('assets', 'calibrationIntervalDays', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  await addIfMissing('assets', 'checkedOutBy', {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
  await addIfMissing('assets', 'checkedOutAt', {
    type: DataTypes.STRING(32),
    allowNull: true,
  });

  // Indexes for new asset columns
  await ensureIndex('assets', ['itemType'], { name: 'assets_item_type' });
  await ensureIndex('assets', ['equipmentClass'], { name: 'assets_equipment_class' });
  await ensureIndex('assets', ['managedSource'], { name: 'assets_managed_source' });
  await ensureIndex('assets', ['toolClassification'], { name: 'assets_tool_classification' });
  await ensureIndex('assets', ['nextCalibrationDue'], { name: 'assets_cal_due' });

  // ── tool_audit_logs ───────────────────────────────────────────────────────
  await ensureIndex('tool_audit_logs', ['serialNumber', 'time'], {
    name: 'tool_audit_logs_serial_time',
  });

  // ── calibration ───────────────────────────────────────────────────────────
  await ensureIndex('calibration', ['serialNumber', 'nextCalibrationDue'], {
    name: 'calibration_serial_due',
  });

  // ── expiration history ────────────────────────────────────────────────────
  // The model should create the table via sync(), but we still ensure indexes
  // here so existing databases are upgraded safely.
  await ensureIndex('expiration_histories', ['itemType'], {
    name: 'expiration_histories_item_type',
  });
  await ensureIndex('expiration_histories', ['itemId'], {
    name: 'expiration_histories_item_id',
  });
  await ensureIndex('expiration_histories', ['itemType', 'itemId'], {
    name: 'expiration_histories_item_type_item_id',
  });
  await ensureIndex('expiration_histories', ['action'], {
    name: 'expiration_histories_action',
  });
  await ensureIndex('expiration_histories', ['createdAt'], {
    name: 'expiration_histories_created_at',
  });
}

try {
  await sequelize.authenticate();

  // CREATE TABLE IF NOT EXISTS only — never drops or modifies existing tables.
  await sequelize.sync({ force: false, alter: false });

  await safeMigrate().catch((e) =>
    console.warn('[models] safeMigrate had a non-fatal warning:', e?.message || e)
  );

  console.log('[models] Database ready ✅');
} catch (err) {
  console.error('❌ Sequelize init failed:', err);
  throw err;
}

export {
  sequelize,
  Sequelize,
  DataTypes,
  Op,
  Asset,
  AuditLog,
  Inventory,
  InventoryAuditLog,
  ToolAuditLog,
  Calibration,
  ExpirationHistory,
};
