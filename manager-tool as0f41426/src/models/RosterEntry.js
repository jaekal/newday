// src/models/RosterEntry.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';

const RosterEntry = sequelize.define(
  'RosterEntry',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    // example.example
    domainUsername: { type: DataTypes.STRING, allowNull: false, unique: true },

    // make employeeId the dedupe anchor
    employeeId: { type: DataTypes.STRING, allowNull: true },

    fullName: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },

    building: { type: DataTypes.STRING, allowNull: true },
    shift: { type: DataTypes.STRING, allowNull: true },

    notes: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: 'RosterEntries',
    indexes: [
      { fields: ['domainUsername'], unique: true },
      { fields: ['employeeId'], unique: true },
      { fields: ['email'] },
      { fields: ['building'] },
      { fields: ['shift'] },
    ],
  }
);

export default RosterEntry;
