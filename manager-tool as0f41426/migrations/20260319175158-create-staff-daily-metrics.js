export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('staff_daily_metrics', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      staffId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'staff_profiles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      metricDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },

      shift: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      area: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      serversCompleted: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      racksCompleted: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      assignmentsClosed: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      checkInsCompleted: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      checkOutsCompleted: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      productionContributionScore: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      repairAttempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      recoveredUnits: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      firstTimeFixCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      rerunSuccessCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      rerunFailureCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      misdiagnosisCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      escalationCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      touchCountTotal: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      touchCountUnits: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      mttrMinutesTotal: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      mttrEvents: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      qualityEscapes: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      repeatFailures: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      postRepairRetestSuccessCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      postRepairRetestTotal: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      inspectionFinds: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      defectAttributionCorrectCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      defectAttributionTotal: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      timeToAttentionMinutesTotal: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      timeToAttentionEvents: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      technicianAddedDowntimeMinutes: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      netDowntimeContributionMinutes: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      utilizationPct: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      idleGapMinutesTotal: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      idleGapEvents: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },

      attendanceReliabilityPct: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      esdCompliancePct: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      certificationHealthPct: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      crossTrainingReadinessPct: {
        type: Sequelize.FLOAT,
        defaultValue: 0,
      },

      source: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('staff_daily_metrics', ['staffId']);
    await queryInterface.addIndex('staff_daily_metrics', ['metricDate']);
    await queryInterface.addIndex('staff_daily_metrics', ['staffId', 'metricDate']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('staff_daily_metrics');
  },
};