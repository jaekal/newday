// models/asset.js  (updated)
// ─────────────────────────────────────────────────────────────────────────────
// Changes from original:
//   • itemType field: 'fleet' (default, original behaviour) | 'equipment'
//   • Equipment-only fields: serialNumber, lastCalibrationDate,
//     nextCalibrationDue, calibrationIntervalDays
//   • Checkout tracking fields: checkedOutBy, checkedOutAt
//     (used by both itemTypes but primarily by equipment)
//
// All new fields are nullable with safe defaults so existing fleet assets
// are completely unaffected — their itemType defaults to 'fleet' and all
// new fields come back null.
//
// safeMigrate() in models/index.js handles the addColumn calls for existing
// databases (see the additions there).
// ─────────────────────────────────────────────────────────────────────────────

export default (sequelize, DataTypes) => {
  const ALLOWED_STATUSES = [
    'Available',
    'Expired',
    'Defective',
    'Maintenance',
    'In Use',
    'Checked Out',   // new — equipment checked out to a tech
  ];

  const ALLOWED_ITEM_TYPES = ['fleet', 'equipment'];
  const ALLOWED_MANAGED_SOURCES = ['asset-catalog', 'tools', 'esd-carts', 'manual'];

  const Asset = sequelize.define('Asset', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    // ── Shared fields (original) ────────────────────────────────────────────
    tagNumber: {
      type: DataTypes.STRING(64),
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Tag number is required.' },
        len: { args: [1, 64], msg: 'Tag number must be 1–64 characters.' },
      },
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: { notEmpty: { msg: 'Name is required.' } },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: '',
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: '',
    },
    location: {
      type: DataTypes.STRING(100),
      allowNull: true,
      defaultValue: '',
    },
    // Which physical building this asset resides in (e.g. 'Bldg-350', 'Bldg-4050')
    building: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: 'Bldg-350',
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'Available',
      validate: {
        isIn: {
          args: [ALLOWED_STATUSES],
          msg: `Status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
        },
      },
    },

    // ── NEW: item type discriminator ─────────────────────────────────────────
    // 'fleet'     — original behaviour: PM schedule via auditRules.json,
    //               bulk inspection audits, no calibration, no checkout.
    // 'equipment' — test equipment: calibration tracking, checkout/return
    //               via kiosk, appears on Expiration Dashboard.
    itemType: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'fleet',
      validate: {
        isIn: {
          args: [ALLOWED_ITEM_TYPES],
          msg: `itemType must be one of: ${ALLOWED_ITEM_TYPES.join(', ')}`,
        },
      },
    },

    // ── NEW: equipment-only calibration fields ───────────────────────────────
    // All nullable — fleet assets leave these null.
    // Stored as VARCHAR(32) date strings (YYYY-MM-DD) — same pattern as
    // Calibration model to avoid SQLite timezone-shift bugs.
    equipmentClass: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: '',
    },
    managedSource: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'asset-catalog',
      validate: {
        isIn: {
          args: [ALLOWED_MANAGED_SOURCES],
          msg: `managedSource must be one of: ${ALLOWED_MANAGED_SOURCES.join(', ')}`,
        },
      },
    },
    serialNumber: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    torque: {
      type: DataTypes.STRING(64),
      allowNull: true,
      defaultValue: '',
    },
    toolClassification: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: '',
    },
    lastCalibrationDate: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: null,
    },
    nextCalibrationDue: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: null,
    },
    // How many days between calibrations (used to auto-compute nextCalibrationDue
    // when lastCalibrationDate is updated).
    calibrationIntervalDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      validate: { min: 1 },
    },

    // ── NEW: checkout tracking (equipment primarily, but works for both) ─────
    checkedOutBy: {
      type: DataTypes.STRING(128),
      allowNull: true,
      defaultValue: null,
    },
    checkedOutAt: {
      type: DataTypes.STRING(32),   // ISO timestamp string
      allowNull: true,
      defaultValue: null,
    },

  }, {
    tableName: 'assets',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['tagNumber'] },
      { fields: ['category'] },
      { fields: ['location'] },
      { fields: ['status'] },
      // itemType and nextCalibrationDue indexes are added by safeMigrate()
      // AFTER addIfMissing() creates the columns — do NOT declare them here
      // or sequelize.sync() will try to create them before the columns exist.
    ],
  });

  Asset.associate = (models) => {
    Asset.hasMany(models.AuditLog, {
      foreignKey: 'assetId',
      as: 'auditLogs',
      onDelete: 'CASCADE',
      hooks: true,
    });
  };

  return Asset;
};
