// src/models/TechnicianDailyMetric.js
export default (sequelize, DataTypes) => {
  const TechnicianDailyMetric = sequelize.define(
    'TechnicianDailyMetric',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      userId: { type: DataTypes.INTEGER, allowNull: false },
      employeeId: { type: DataTypes.STRING, allowNull: true },

      metricDate: { type: DataTypes.DATEONLY, allowNull: false },

      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },
      productFamily: { type: DataTypes.STRING, allowNull: true },
      testStage: { type: DataTypes.STRING, allowNull: true },

      // Productivity
      serversAssigned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      serversCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      racksAssigned: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      racksCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      expectedCheckActions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      validCheckActions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      inspectionsExpected: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      inspectionsCompleted: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Troubleshooting
      unitsRepaired: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unitsPassedFirstRerun: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unitsEventuallyPassed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      successfulReruns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalReruns: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      escalatedUnits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalFailedUnitsWorked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      totalAttemptsToPass: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      passedRepairUnitCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      mttrMinutesTotal: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      mttrSampleCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Quality
      postTestEscapes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unitsPassed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      repeatFailures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      repairedUnitsForRepeatCheck: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      inspectionIssuesCaught: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalIssuesFound: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      incorrectRepairActions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalRepairActions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      technicianAttributedDefects: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      unitsHandled: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Compliance / reliability
      scheduledShifts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      shiftsAttendedOnTime: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      daysWorked: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      daysWithSuccessfulEsd: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      esdFirstPassDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      totalEsdDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      infractionPoints: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

      // Development
      plannedCrossTrainingModules: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completedCrossTrainingModules: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      knowledgeSharingEvents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      ciParticipationEvents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      leadershipSupportEvents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

      // Flags / exclusions
      excludedSystemDelayMinutes: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      excludedPartWaitMinutes: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      excludedInfraMinutes: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      complexityMultiplier: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1.0 },

      sourceBatchId: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'technician_daily_metrics',
      indexes: [
        {
          unique: true,
          fields: ['userId', 'metricDate', 'shift', 'area', 'productFamily', 'testStage'],
          name: 'uniq_tech_daily_metric_scope',
        },
        { fields: ['metricDate'], name: 'idx_tdm_metricDate' },
        { fields: ['userId'], name: 'idx_tdm_userId' },
        { fields: ['building', 'shift'], name: 'idx_tdm_building_shift' },
        { fields: ['area'], name: 'idx_tdm_area' },
        { fields: ['productFamily'], name: 'idx_tdm_productFamily' },
        { fields: ['testStage'], name: 'idx_tdm_testStage' },
      ],
    }
  );

  TechnicianDailyMetric.associate = (models) => {
    TechnicianDailyMetric.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  };

  return TechnicianDailyMetric;
};