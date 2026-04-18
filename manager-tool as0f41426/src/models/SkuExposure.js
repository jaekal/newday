// src/models/SkuExposure.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const SkuExposure = sequelize.define(
  'SkuExposure',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    staffId: { type: DataTypes.INTEGER, allowNull: false },

    sku: { type: DataTypes.STRING, allowNull: false },

    timesWorked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    lastWorkedAt: { type: DataTypes.DATEONLY, allowNull: true },
  },
  {
    tableName: 'SkuExposures',
    indexes: [
      // One row per staff per sku
      { unique: true, fields: ['staffId', 'sku'], name: 'uniq_staff_sku' },
      { fields: ['staffId'], name: 'idx_sku_exposure_staff' },
      { fields: ['sku'], name: 'idx_sku_exposure_sku' },
    ],
  }
);

User.hasMany(SkuExposure, { foreignKey: 'staffId' });
SkuExposure.belongsTo(User, { as: 'Staff', foreignKey: 'staffId' });

export default SkuExposure;
