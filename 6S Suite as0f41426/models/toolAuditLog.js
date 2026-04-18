// models/toolAuditLog.js
export default (sequelize, DataTypes) => {
  const isPg =
    typeof sequelize.getDialect === 'function' &&
    sequelize.getDialect() === 'postgres';

  const ChangesType = isPg ? DataTypes.JSONB : DataTypes.JSON;

  const ToolAuditLog = sequelize.define(
    'ToolAuditLog',
    {
      id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },

      // The tool's serial number — intentionally no FK so serial renames
      // and deletes don't cascade-destroy history.
      serialNumber: { type: DataTypes.STRING(128), allowNull: false },

      // 'checkout' | 'return' | 'add' | 'edit' | 'delete'
      action: {
        type: DataTypes.STRING(48),
        allowNull: false,
        validate: {
          len: [2, 48],
          noSpaces(v) {
            if (/\s/.test(v)) throw new Error('action must not contain spaces');
          }
        }
      },

      // Session username or 'system' / IP
      actor: { type: DataTypes.STRING(128), allowNull: true },

      // For checkout/return: the operator who took/returned the tool
      operatorId: { type: DataTypes.STRING(128), allowNull: true },

      // Array of { field, from, to } diffs
      changes: { type: ChangesType, allowNull: true },

      // ISO timestamp — mirrors the field name used in the old JSON file
      // so existing log readers don't need changes
      time: { type: DataTypes.STRING(32), allowNull: true },
    },
    {
      tableName: 'tool_audit_logs',
      timestamps: true,
      indexes: [
        { fields: ['serialNumber'] },
        { fields: ['action'] },
        { fields: ['actor'] },
        { fields: ['operatorId'] },
        { fields: ['time'] },
        { fields: ['createdAt'] },
        { fields: ['serialNumber', 'time'] },
      ],
      defaultScope: {
        order: [['time', 'DESC'], ['id', 'DESC']],
      },
    }
  );

  // Normalize on create
  ToolAuditLog.addHook('beforeCreate', (entry) => {
    if (!entry.time) entry.time = new Date().toISOString();

    const s = (v) => (v == null ? null : String(v).trim());
    entry.serialNumber = s(entry.serialNumber);
    entry.action       = s(entry.action);
    entry.actor        = s(entry.actor);
    entry.operatorId   = s(entry.operatorId);

    // Accept changes as JSON string, object map, or array — normalize to array
    if (typeof entry.changes === 'string') {
      try { entry.changes = JSON.parse(entry.changes); } catch { entry.changes = null; }
    }
    if (entry.changes && !Array.isArray(entry.changes) && typeof entry.changes === 'object') {
      entry.changes = Object.entries(entry.changes).map(([field, v]) =>
        (v && typeof v === 'object' && 'from' in v && 'to' in v)
          ? { field, from: v.from, to: v.to }
          : { field, from: undefined, to: v }
      );
    }
  });

  // Convenience write shorthand: ToolAuditLog.log({ serialNumber, action, actor, ... })
  ToolAuditLog.log = async function (payload, options) {
    return ToolAuditLog.create(
      { ...payload, time: payload?.time || new Date().toISOString() },
      options
    );
  };

  return ToolAuditLog;
};
