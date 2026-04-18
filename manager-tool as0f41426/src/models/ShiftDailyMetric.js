// src/models/ShiftDailyMetric.js
export default (sequelize, DataTypes) => {
  const ShiftDailyMetric = sequelize.define(
    'ShiftDailyMetric',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      metricDate: { type: DataTypes.DATEONLY, allowNull: false },
      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },
      productFamily: { type: DataTypes.STRING, allowNull: true },
      testStage: { type: DataTypes.STRING, allowNull: true },

      activeTechnicians: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      serversCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      racksCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      firstTimeFixRate: { type: DataTypes.FLOAT, allowNull: true },
      repairSuccessRate: { type: DataTypes.FLOAT, allowNull: true },
      averageMttrMinutes: { type: DataTypes.FLOAT, allowNull: true },
      qualityEscapeRate: { type: DataTypes.FLOAT, allowNull: true },

      totalEscapes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalRepairs: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalReruns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      topFailureSymptomsJson: { type: DataTypes.JSON, allowNull: true },
      manualResetSummaryJson: { type: DataTypes.JSON, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'shift_daily_metrics',
      indexes: [
        {
          unique: true,
          fields: ['metricDate', 'building', 'shift', 'area', 'productFamily', 'testStage'],
          name: 'uniq_shift_daily_metric_scope',
        },
        { fields: ['metricDate'], name: 'idx_sdm_metricDate' },
        { fields: ['building', 'shift'], name: 'idx_sdm_building_shift' },
        { fields: ['area'], name: 'idx_sdm_area' },
      ],
    }
  );

  return ShiftDailyMetric;
};