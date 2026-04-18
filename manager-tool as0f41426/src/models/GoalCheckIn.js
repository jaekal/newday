// src/models/GoalCheckIn.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import Goal from './Goal.js';
import User from './User.js';

const GoalCheckIn = sequelize.define('GoalCheckIn', {
  note: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  progressSnapshot: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },

  statusSnapshot: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'OPEN',
    validate: { isIn: [['OPEN', 'IN_PROGRESS', 'DONE', 'ON_HOLD']] },
  },

  entryType: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'MANUAL',
    validate: { isIn: [['MANUAL', 'QUICK_UPDATE', 'SYSTEM']] },
  },
});

Goal.hasMany(GoalCheckIn, {
  as: 'CheckIns',
  foreignKey: 'goalId',
  onDelete: 'CASCADE',
});

GoalCheckIn.belongsTo(Goal, {
  as: 'Goal',
  foreignKey: 'goalId',
});

User.hasMany(GoalCheckIn, {
  foreignKey: 'userId',
});

GoalCheckIn.belongsTo(User, {
  as: 'Author',
  foreignKey: 'userId',
});

export default GoalCheckIn;