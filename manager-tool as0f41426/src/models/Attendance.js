// src/models/Attendance.js
import { DataTypes, Model } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

class Attendance extends Model {}

Attendance.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    staffId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    employeeId: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },

    // PRESENT / LATE / ABSENT
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    minutesLate: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    rawStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    // NEW: ON_TIME / UNPUNCTUAL / LATE
    punctualityBucket: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Attendance',
    tableName: 'Attendance',
  }
);

// Associations
User.hasMany(Attendance, {
  foreignKey: 'staffId',
  as: 'Attendance',
});

Attendance.belongsTo(User, {
  foreignKey: 'staffId',
  as: 'Staff',
});

export default Attendance;
