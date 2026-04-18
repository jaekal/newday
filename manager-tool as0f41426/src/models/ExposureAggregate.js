// src/models/ExposureAggregate.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const ExposureAggregate = sequelize.define(
  'ExposureAggregate',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    staffId: { type: DataTypes.INTEGER, allowNull: false },

    building: { type: DataTypes.STRING, allowNull: true }, // optional: last known
    customer: { type: DataTypes.STRING, allowNull: false },
    model: { type: DataTypes.STRING, allowNull: false },

    rackDistinctCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    serverDistinctCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalDistinctCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    firstWorkedAt: { type: DataTypes.DATEONLY, allowNull: true },
    lastWorkedAt: { type: DataTypes.DATEONLY, allowNull: true },
  },
  {
    tableName: 'ExposureAggregates',
    indexes: [
      {
        unique: true,
        fields: ['staffId', 'customer', 'model'],
        name: 'uniq_staff_customer_model',
      },
      { fields: ['staffId'] },
      { fields: ['customer'] },
      { fields: ['model'] },
    ],
  }
);

User.hasMany(ExposureAggregate, { foreignKey: 'staffId' });
ExposureAggregate.belongsTo(User, { as: 'Staff', foreignKey: 'staffId' });

export default ExposureAggregate;
