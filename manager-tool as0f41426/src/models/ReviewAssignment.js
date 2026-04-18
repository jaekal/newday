// src/models/ReviewAssignment.js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const ReviewAssignment = sequelize.define(
    'ReviewAssignment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      reviewerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        // ❌ NO unique: true HERE
      },
      staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        // ❌ NO unique: true HERE
      },
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'ReviewAssignments',
      indexes: [
        // ✅ composite unique (reviewer + staff)
        {
          name: 'reviewer_staff_unique',
          unique: true,
          fields: ['reviewerId', 'staffId'],
        },
        // non-unique helpers
        {
          fields: ['reviewerId'],
        },
        {
          fields: ['staffId'],
        },
      ],
    }
  );

  ReviewAssignment.associate = (models) => {
    ReviewAssignment.belongsTo(models.User, {
      as: 'Reviewer',
      foreignKey: 'reviewerId',
    });
    ReviewAssignment.belongsTo(models.User, {
      as: 'Staff',
      foreignKey: 'staffId',
    });
  };

  return ReviewAssignment;
};
