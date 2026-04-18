// src/models/training.js
import { DataTypes, Model } from 'sequelize';

export default function TrainingFactory(sequelize) {
  class Training extends Model {}

  Training.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      // Optional FK to User (staff)
      staffId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      // Required columns for upload
      employeeId: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      employeeName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      courseName: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      // Additional training metadata
      courseType: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      overallProgress: {
        // e.g. 0–100
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Stored as strings for flexibility (e.g. 11/28/2025 or 2025-11-28)
      startDate: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      endDate: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      certificationFrequency: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Training',
      tableName: 'Trainings',
      indexes: [
        { fields: ['employeeId'] },
        { fields: ['staffId'] },
        { fields: ['courseName'] },
      ],
    }
  );

  return Training;
}
