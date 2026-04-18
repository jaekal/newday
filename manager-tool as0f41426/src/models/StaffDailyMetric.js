// src/models/StaffDailyMetric.js
export default (sequelize, DataTypes) => {
  const StaffDailyMetric = sequelize.define(
    'StaffDailyMetric',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      metricDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      shift: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      area: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // A. Throughput / Execution
      serversCompleted: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      racksCompleted: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      assignmentsClosed: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      checkInsCompleted: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      checkOutsCompleted: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      productionContributionScore: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },

      // B. Troubleshooting Effectiveness
      repairAttempts: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      recoveredUnits: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      firstTimeFixCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      rerunSuccessCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      rerunFailureCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      misdiagnosisCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      escalationCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      touchCountTotal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      touchCountUnits: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      mttrMinutesTotal: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      mttrEvents: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },

      // C. Quality Protection
      qualityEscapes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      repeatFailures: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      postRepairRetestSuccessCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      postRepairRetestTotal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      inspectionFinds: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      defectAttributionCorrectCount: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      defectAttributionTotal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },

      // D. Time Ownership / Downtime Management
      timeToAttentionMinutesTotal: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      timeToAttentionEvents: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },
      technicianAddedDowntimeMinutes: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      netDowntimeContributionMinutes: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      utilizationPct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      idleGapMinutesTotal: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      idleGapEvents: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
      },

      // E. Reliability / Readiness
      attendanceReliabilityPct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      esdCompliancePct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      certificationHealthPct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      crossTrainingReadinessPct: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },

      source: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: 'staff_daily_metrics',
      indexes: [
        { fields: ['staffId'] },
        { fields: ['metricDate'] },
        { unique: true, fields: ['staffId', 'metricDate', 'shift'] },
      ],
    }
  );

  StaffDailyMetric.associate = (models) => {
    const target = models?.StaffProfile;

    if (!target || typeof target !== 'function' || typeof target.hasMany !== 'function') {
      return;
    }

    StaffDailyMetric.belongsTo(target, {
      foreignKey: 'staffId',
      as: 'staff',
    });
  };

  return StaffDailyMetric;
};