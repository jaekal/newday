// src/models/Goal.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const Goal = sequelize.define('Goal', {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  category: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  priority: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: { isIn: [['LOW', 'MEDIUM', 'HIGH']] },
  },

  type: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'DEVELOPMENT',
    validate: { isIn: [['PERFORMANCE', 'DEVELOPMENT', 'PROJECT']] },
  },

  successCriteria: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  measure: {
    type: DataTypes.STRING,
    allowNull: true,
  },

  status: {
    type: DataTypes.STRING,
    defaultValue: 'OPEN',
    validate: { isIn: [['OPEN', 'IN_PROGRESS', 'DONE', 'ON_HOLD']] },
  },

  dueDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },

  progress: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
});

User.hasMany(Goal, { foreignKey: 'ownerId' });
Goal.belongsTo(User, { as: 'Owner', foreignKey: 'ownerId' });

export default Goal;