// models/InventoryAuditLog.js
export default (sequelize, DataTypes) => {
  // Try to grab Op robustly (varies by integration)
  const Op =
    sequelize?.Sequelize?.Op ||
    // fallback if someone passes Sequelize instance on the model factory (rare)
    sequelize?.Op ||
    undefined;

  // Prefer JSONB on Postgres for better indexing/perf
  const isPg =
    typeof sequelize.getDialect === 'function' &&
    sequelize.getDialect() === 'postgres';

  const ChangesType = isPg ? DataTypes.JSONB : DataTypes.JSON;

  const InventoryAuditLog = sequelize.define(
    'InventoryAuditLog',
    {
      id:           { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },

      ItemCode:     { type: DataTypes.STRING(128), allowNull: false },

      qty:          { type: DataTypes.INTEGER, allowNull: true },
      startingQty:  { type: DataTypes.INTEGER, allowNull: true },

      operatorId:   { type: DataTypes.STRING(128), allowNull: true },
      sixSOperator: { type: DataTypes.STRING(128), allowNull: true },

      // e.g. create/update/delete/bulk_delete/restore/checkout/import_create/import_update/image_upload/...
      action: {
        type: DataTypes.STRING(48),
        allowNull: false,
        validate: {
          len: [2, 48],
          // keep it loose so custom actions work; forbid spaces to keep queries cleaner
          noSpaces(value) {
            if (/\s/.test(value)) throw new Error('action must not contain spaces');
          }
        }
      },

      actor:        { type: DataTypes.STRING(128), allowNull: true }, // session user or IP

      // Either an array of { field, from, to } or an object you store;
      // we accept either; writer code should prefer the array-of-objects form.
      changes:      { type: ChangesType, allowNull: true },

      imageType:    { type: DataTypes.STRING(16), allowNull: true },

      building:     { type: DataTypes.STRING(64), allowNull: true },  // Bldg-350 | Bldg-4050

      // ISO string mirror so file-mode and DB-mode logs look the same in the UI
      time:         { type: DataTypes.STRING(32), allowNull: true },
    },
    {
      tableName: 'inventory_audit_logs',
      timestamps: true, // createdAt, updatedAt
      indexes: [
        { fields: ['ItemCode'] },
        { fields: ['action'] },
        { fields: ['operatorId'] },
        { fields: ['sixSOperator'] },
        { fields: ['time'] },
        { fields: ['createdAt'] },
        { fields: ['ItemCode', 'time'] }, // frequent filter combo
      ],
      defaultScope: {
        // ISO strings sort correctly; fall back to id desc as secondary
        order: [['time', 'DESC'], ['id', 'DESC']],
      },
    }
  );

  /* ───────────────────────────── Hooks ───────────────────────────── */
  InventoryAuditLog.addHook('beforeCreate', (entry) => {
    // Default ISO timestamp
    if (!entry.time) entry.time = new Date().toISOString();

    // Coerce integers if provided
    const toInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    };
    if (entry.qty != null) entry.qty = toInt(entry.qty);
    if (entry.startingQty != null) entry.startingQty = toInt(entry.startingQty);

    // Sanitize short strings
    const s = (v) => (v == null ? null : String(v).trim());
    entry.ItemCode     = s(entry.ItemCode);
    entry.operatorId   = s(entry.operatorId);
    entry.sixSOperator = s(entry.sixSOperator);
    entry.actor        = s(entry.actor);
    entry.action       = s(entry.action);
    entry.imageType    = s(entry.imageType);

    // Normalize "changes":
    // - If string, try JSON.parse
    // - If object-map {field: {from,to}}, convert to array-of-objects
    // - If already an array, keep it
    if (typeof entry.changes === 'string') {
      try { entry.changes = JSON.parse(entry.changes); } catch { entry.changes = null; }
    }
    if (entry.changes && !Array.isArray(entry.changes) && typeof entry.changes === 'object') {
      entry.changes = Object.keys(entry.changes).map((key) => {
        const v = entry.changes[key];
        return (v && typeof v === 'object' && 'from' in v && 'to' in v)
          ? { field: key, from: v.from, to: v.to }
          : { field: key, from: undefined, to: v };
      });
    }
  });

  /* ───────────────────────────── Scopes ──────────────────────────── */
  InventoryAuditLog.addScope('forItem', (code) => ({
    where: { ItemCode: code },
    order: [['time', 'DESC'], ['id', 'DESC']],
  }));

  if (Op) {
    InventoryAuditLog.addScope('between', (start, end) => {
      const where = {};
      if (start && end) {
        where.time = { [Op.between]: [start, end] };
      } else if (start) {
        where.time = { [Op.gte]: start };
      } else if (end) {
        where.time = { [Op.lte]: end };
      }
      return { where, order: [['time', 'DESC'], ['id', 'DESC']] };
    });

    // Lightweight full-text-ish search on a few columns
    InventoryAuditLog.addScope('search', (term) => {
      if (!term) return {};
      const like = `%${String(term).trim()}%`;
      return {
        where: {
          [Op.or]: [
            { ItemCode: { [Op.like]: like } },
            { action:   { [Op.like]: like } },
            { actor:    { [Op.like]: like } },
            { operatorId: { [Op.like]: like } },
            { sixSOperator: { [Op.like]: like } },
          ]
        }
      };
    });
  }

  /* ───────────────────────── Convenience API ─────────────────────── */
  /**
   * Build an array of {field, from, to} diffs.
   * @param {object} before
   * @param {object} after
   * @param {string[]} [fields] optional allow-list
   */
  InventoryAuditLog.buildChanges = function (before = {}, after = {}, fields) {
    const keys = Array.isArray(fields) && fields.length ? fields : Object.keys(after || {});
    const out = [];
    for (const k of keys) {
      if ((before?.[k]) !== (after?.[k])) {
        out.push({ field: k, from: before?.[k], to: after?.[k] });
      }
    }
    return out;
  };

  /**
   * Shorthand to write a log entry.
   * InventoryAuditLog.log({ ItemCode, action, actor, qty, startingQty, operatorId, sixSOperator, changes, imageType, time? }, options?)
   */
  InventoryAuditLog.log = async function (payload, options) {
    const entry = {
      ...payload,
      time: payload?.time || new Date().toISOString(),
    };
    return InventoryAuditLog.create(entry, options);
  };

  // Optional FK (left off to avoid coupling ItemCode renames)
  // InventoryAuditLog.associate = (models) => {
  //   InventoryAuditLog.belongsTo(models.Inventory, { foreignKey: 'ItemCode', targetKey: 'ItemCode', onDelete: 'SET NULL' });
  // };

  return InventoryAuditLog;
};
