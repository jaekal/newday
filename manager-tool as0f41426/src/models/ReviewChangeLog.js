// src/models/ReviewChangeLog.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';
import MonthlyReview from './MonthlyReview.js';

const ReviewChangeLog = sequelize.define('ReviewChangeLog', {
  field: { type: DataTypes.STRING, allowNull: false },
  oldValue: { type: DataTypes.TEXT, allowNull: true },
  newValue: { type: DataTypes.TEXT, allowNull: true },
  changedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
});

// Associations (match what audit.ejs expects)
MonthlyReview.hasMany(ReviewChangeLog, { foreignKey: 'reviewId' });
ReviewChangeLog.belongsTo(MonthlyReview, { foreignKey: 'reviewId' }); // => log.MonthlyReview

User.hasMany(ReviewChangeLog, { foreignKey: 'changedById' });
ReviewChangeLog.belongsTo(User, { as: 'ChangedBy', foreignKey: 'changedById' }); // => log.ChangedBy

export default ReviewChangeLog;
