// src/models/User.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';

const EMPLOYMENT_STATUSES = ['ACTIVE', 'RESIGNED', 'TERMINATED'];

const User = sequelize.define(
  'User',
  {
    name: { type: DataTypes.STRING, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },

    role: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD', 'STAFF']] },
    },

    phone: { type: DataTypes.STRING },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    avatarPath: { type: DataTypes.STRING, allowNull: true },

    // Blocks login / hides usage where applicable
    isEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // Employment lifecycle
    employmentStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'ACTIVE',
      validate: {
        isIn: [EMPLOYMENT_STATUSES],
      },
    },

    offboardedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    offboardReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    hooks: {
      beforeValidate(user) {
        const normalized = String(user.employmentStatus || 'ACTIVE')
          .trim()
          .toUpperCase();

        user.employmentStatus = EMPLOYMENT_STATUSES.includes(normalized)
          ? normalized
          : 'ACTIVE';

        if (user.employmentStatus === 'ACTIVE') {
          user.offboardedAt = null;
          user.offboardReason = null;
          user.isEnabled = true;
        }
      },
    },
  }
);

export default User;