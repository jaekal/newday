// src/models/EsdCheck.js
import { DataTypes, Model } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

class EsdCheck extends Model {}

EsdCheck.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    // FK → Users.id
    staffId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    // Copy of employee id from StaffProfile (for easier imports/debug)
    employeeId: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // Copy of name from import (optional)
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // Original log timestamp from the ESD system
    logDateTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    // E.g. "PASS", "FAIL", "FAILURE", etc.
    result: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'EsdCheck',
    tableName: 'EsdChecks',
  }
);

// Associations
User.hasMany(EsdCheck, {
  foreignKey: 'staffId',
  as: 'EsdChecks',
});

EsdCheck.belongsTo(User, {
  foreignKey: 'staffId',
  as: 'Staff',
});

export default EsdCheck;
