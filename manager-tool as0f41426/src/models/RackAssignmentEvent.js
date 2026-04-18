// src/models/RackAssignmentEvent.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const RackAssignmentEvent = sequelize.define(
  'RackAssignmentEvent',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    staffId: { type: DataTypes.INTEGER, allowNull: false },

    building: { type: DataTypes.STRING, allowNull: true },
    customer: { type: DataTypes.STRING, allowNull: true },

    assignmentTime: { type: DataTypes.DATE, allowNull: false },
    assignmentDate: { type: DataTypes.DATEONLY, allowNull: false },

    // "assigneeAtTime" from file (employee id or name string)
    assigneeAtTime: { type: DataTypes.STRING, allowNull: true },

    model: { type: DataTypes.STRING, allowNull: true },

    serialNumber: { type: DataTypes.STRING, allowNull: false },

    // "RACK" or "SERVER"
    type: { type: DataTypes.ENUM('RACK', 'SERVER'), allowNull: false },

    sourceFile: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: 'RackAssignmentEvents',

    // ✅ Improvements:
    // 1) Explicitly name indexes (prevents Sequelize auto-generated index names like
    //    rack_assignment_events_staff_id_assignment_date, which caused "already exists" collisions).
    // 2) Keep your dedupe rule unique index as-is.
    indexes: [
      { fields: ['staffId', 'assignmentDate'], name: 'idx_rae_staff_day' },
      { fields: ['customer', 'model'], name: 'idx_rae_customer_model' },
      { fields: ['serialNumber'], name: 'idx_rae_serial' },

      // Key dedupe rule: no double count per staff per day per unit
      {
        unique: true,
        fields: ['staffId', 'assignmentDate', 'serialNumber', 'type'],
        name: 'uniq_staff_day_serial_type',
      },
    ],
  }
);

// ✅ Keep associations here (simple + consistent)
User.hasMany(RackAssignmentEvent, { foreignKey: 'staffId' });
RackAssignmentEvent.belongsTo(User, { as: 'Staff', foreignKey: 'staffId' });

export default RackAssignmentEvent;
