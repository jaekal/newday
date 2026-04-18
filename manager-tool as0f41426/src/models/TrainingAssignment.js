// src/models/TrainingAssignment.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const TrainingAssignment = sequelize.define('TrainingAssignment', {
  courseName: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  courseType: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  dueDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },

  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'NOT_STARTED',
    validate: { isIn: [['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']] },
  },

  completedDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },

  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'TrainingAssignments',
  indexes: [
    { fields: ['staffId'] },
    { fields: ['assignedById'] },
    { fields: ['status'] },
    { fields: ['dueDate'] },
  ],
});

// staffId — who is assigned the training
User.hasMany(TrainingAssignment, { foreignKey: 'staffId', as: 'TrainingAssignments' });
TrainingAssignment.belongsTo(User, { foreignKey: 'staffId', as: 'Staff' });

// assignedById — who created the assignment
User.hasMany(TrainingAssignment, { foreignKey: 'assignedById', as: 'AssignedTrainings' });
TrainingAssignment.belongsTo(User, { foreignKey: 'assignedById', as: 'AssignedBy' });

export default TrainingAssignment;
