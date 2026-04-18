// src/models/StaffProfile.js
import { DataTypes, Model } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

class StaffProfile extends Model {}

StaffProfile.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

    // ───────── HR / Org Info ─────────
    employeeId: { type: DataTypes.STRING, allowNull: true },

    positionType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'TECHNICIAN',
    },

    startDate: { type: DataTypes.DATEONLY, allowNull: true },
    dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },

    // building + shift used for scoping dashboards & reviews
    building: { type: DataTypes.STRING, allowNull: true },
    shift: { type: DataTypes.STRING, allowNull: true },

    // ───────── Domain / Identity Mapping ─────────
    domainName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'AD / corporate domain (ex: ZTSYSTEMS)',
    },

    domainUsername: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Domain username used for roster & rack assignment mapping',
    },

    // ───────── Vehicle / Parking ─────────
    carMake: { type: DataTypes.STRING, allowNull: true },
    carModel: { type: DataTypes.STRING, allowNull: true },
    licensePlate: { type: DataTypes.STRING, allowNull: true },

    // ───────── Education & Credentials ─────────
    highestEducationLevel: { type: DataTypes.STRING, allowNull: true },
    schoolName: { type: DataTypes.STRING, allowNull: true },
    degreeName: { type: DataTypes.STRING, allowNull: true },
    fieldOfStudy: { type: DataTypes.STRING, allowNull: true },
    graduationYear: { type: DataTypes.STRING, allowNull: true },
    certificationsText: { type: DataTypes.TEXT, allowNull: true },

    // Path to main resume/CV file
    resumePath: { type: DataTypes.STRING, allowNull: true },
    resumeOriginalName: { type: DataTypes.STRING, allowNull: true },

    // ───────── Profile / Strengths / Skills ─────────
    aboutMe: { type: DataTypes.TEXT, allowNull: true },
    keyStrengths: { type: DataTypes.TEXT, allowNull: true },
    developmentFocus: { type: DataTypes.TEXT, allowNull: true },
    technicalSkills: { type: DataTypes.TEXT, allowNull: true },
    softSkills: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    modelName: 'StaffProfile',
    tableName: 'StaffProfiles',
    indexes: [
      {
        fields: ['domainUsername'],
        name: 'idx_staffprofile_domain_username',
      },
      {
        fields: ['employeeId'],
        name: 'idx_staffprofile_employee_id',
      },
    ],
  }
);

// Associations
User.hasOne(StaffProfile, { foreignKey: 'userId', as: 'StaffProfile' });
StaffProfile.belongsTo(User, { foreignKey: 'userId', as: 'User' });

export default StaffProfile;
