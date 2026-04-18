// src/models/ReviewChange.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import MonthlyReview from './MonthlyReview.js';
import User from './User.js';

const ReviewChange = sequelize.define('ReviewChange', {
  changeType: {
    type: DataTypes.ENUM('CREATE', 'UPDATE'),
    allowNull: false,
  },
  // Short description, e.g. "Updated comment + bucket scores"
  description: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  // JSON string of field-level diffs: [{ field, old, new }, ...]
  diffJson: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

// Associations
MonthlyReview.hasMany(ReviewChange, { foreignKey: 'reviewId' });
ReviewChange.belongsTo(MonthlyReview, { as: 'Review', foreignKey: 'reviewId' });

User.hasMany(ReviewChange, { foreignKey: 'changedById' });
ReviewChange.belongsTo(User, { as: 'ChangedBy', foreignKey: 'changedById' });

export default ReviewChange;
