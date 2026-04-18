// models/calibration.js
//
// Stores tool calibration records, one row per serial number.
// Replaces data/calibration.json.
//
// Field notes:
//   serialNumber     — natural key; no FK to tools so renames/deletes
//                      don't cascade-destroy calibration history.
//   slot             — physical slot label (e.g. "#1", "7")
//   torque           — human-readable torque spec (e.g. "0.6 Nm")
//   category         — "Manual" | "Wireless" (or any future value)
//   description      — free text
//   model            — manufacturer model string
//   lastCalibrationDate — stored as a DATE string (YYYY-MM-DD) so it
//                      survives Excel serial date import without
//                      requiring epoch-ms conversion on every read.
//   nextCalibrationDue  — same format; used by expirationService
//   calibrationStatus   — "Valid", "Expired", "Due Soon", etc.

export default (sequelize, DataTypes) => {
  const Calibration = sequelize.define(
    'Calibration',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // Natural key — no UNIQUE constraint at DB level because the legacy
      // JSON file has one duplicate (MFG000842). The migration script
      // handles it by keeping the most-recent row. A unique index is added
      // after data load in safeMigrate().
      serialNumber: {
        type: DataTypes.STRING(128),
        allowNull: false,
        validate: {
          notEmpty: { msg: 'serialNumber is required' },
        },
      },

      slot:        { type: DataTypes.STRING(32),  allowNull: true, defaultValue: '' },
      torque:      { type: DataTypes.STRING(32),  allowNull: true, defaultValue: '' },
      category:    { type: DataTypes.STRING(64),  allowNull: true, defaultValue: '' },
      description: { type: DataTypes.STRING(256), allowNull: true, defaultValue: '' },
      model:       { type: DataTypes.STRING(128), allowNull: true, defaultValue: '' },

      // Date strings kept as VARCHAR(32) — same pattern as inventory.updatedAtIso.
      // Avoids timezone-shift bugs when SQLite coerces DATE columns.
      lastCalibrationDate: { type: DataTypes.STRING(32), allowNull: true, defaultValue: '' },
      nextCalibrationDue:  { type: DataTypes.STRING(32), allowNull: true, defaultValue: '' },

      calibrationStatus: {
        type: DataTypes.STRING(32),
        allowNull: true,
        defaultValue: '',
      },
    },
    {
      tableName: 'calibration',
      timestamps: true,
      indexes: [
        // serialNumber is the primary lookup key in every consumer.
        // Added as a regular (non-unique) index here; safeMigrate() promotes
        // it to unique after the migration script resolves all duplicates.
        { name: 'calibration_serial', fields: ['serialNumber'] },
        { name: 'calibration_due',    fields: ['nextCalibrationDue'] },
        { name: 'calibration_status', fields: ['calibrationStatus'] },
      ],
      defaultScope: {
        order: [['serialNumber', 'ASC']],
      },
    }
  );

  // Convenience: find by serial (first match, case-insensitive)
  Calibration.findBySerial = async function (serial) {
    const { Op } = sequelize.Sequelize ?? require('sequelize');
    return Calibration.findOne({
      where: { serialNumber: { [Op.like]: String(serial || '').trim() } },
    });
  };

  // Convenience: upsert by serialNumber (update if exists, create if not)
  Calibration.upsertBySerial = async function (data) {
    const sn = String(data.serialNumber || '').trim();
    if (!sn) throw new Error('serialNumber is required');

    const existing = await Calibration.findOne({ where: { serialNumber: sn } });
    if (existing) {
      await existing.update({ ...data, serialNumber: sn });
      return { record: existing, created: false };
    }
    const record = await Calibration.create({ ...data, serialNumber: sn });
    return { record, created: true };
  };

  return Calibration;
};
