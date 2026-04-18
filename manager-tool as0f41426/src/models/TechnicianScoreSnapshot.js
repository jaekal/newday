// src/models/TechnicianScoreSnapshot.js
export default (sequelize, DataTypes) => {
  const TechnicianScoreSnapshot = sequelize.define(
    'TechnicianScoreSnapshot',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      userId: { type: DataTypes.INTEGER, allowNull: false },
      employeeId: { type: DataTypes.STRING, allowNull: true },

      snapshotDate: { type: DataTypes.DATEONLY, allowNull: false },

      windowType: {
        type: DataTypes.ENUM('DAILY', 'WEEKLY', 'TRAILING_30', 'MONTHLY', 'QUARTERLY'),
        allowNull: false,
        defaultValue: 'DAILY',
      },

      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },
      productFamily: { type: DataTypes.STRING, allowNull: true },
      testStage: { type: DataTypes.STRING, allowNull: true },

      productivityScore: { type: DataTypes.FLOAT, allowNull: true },
      troubleshootingScore: { type: DataTypes.FLOAT, allowNull: true },
      qualityScore: { type: DataTypes.FLOAT, allowNull: true },
      complianceScore: { type: DataTypes.FLOAT, allowNull: true },
      developmentScore: { type: DataTypes.FLOAT, allowNull: true },

      overallScore: { type: DataTypes.FLOAT, allowNull: true },
      scoreBand: { type: DataTypes.STRING, allowNull: true },

      rawMetricsJson: { type: DataTypes.JSON, allowNull: true },
      scoreBreakdownJson: { type: DataTypes.JSON, allowNull: true },

      minimumSampleMet: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      calculationVersion: { type: DataTypes.STRING, allowNull: false, defaultValue: 'v1' },
    },
    {
      tableName: 'technician_score_snapshots',
      indexes: [
        {
          unique: true,
          fields: ['userId', 'snapshotDate', 'windowType', 'shift', 'area', 'productFamily', 'testStage'],
          name: 'uniq_tech_score_snapshot_scope',
        },
        { fields: ['snapshotDate'], name: 'idx_tss_snapshotDate' },
        { fields: ['userId'], name: 'idx_tss_userId' },
        { fields: ['overallScore'], name: 'idx_tss_overallScore' },
        { fields: ['building', 'shift'], name: 'idx_tss_building_shift' },
      ],
    }
  );

  TechnicianScoreSnapshot.associate = (models) => {
    TechnicianScoreSnapshot.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  };

  return TechnicianScoreSnapshot;
};