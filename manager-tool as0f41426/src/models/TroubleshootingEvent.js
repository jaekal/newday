// src/models/TroubleshootingEvent.js
export default (sequelize, DataTypes) => {
  const TroubleshootingEvent = sequelize.define(
    'TroubleshootingEvent',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      userId: { type: DataTypes.INTEGER, allowNull: false },
      employeeId: { type: DataTypes.STRING, allowNull: true },

      unitSerialNumber: { type: DataTypes.STRING, allowNull: false },
      rackSerialNumber: { type: DataTypes.STRING, allowNull: true },

      eventDate: { type: DataTypes.DATEONLY, allowNull: false },
      failureDetectedAt: { type: DataTypes.DATE, allowNull: true },
      attentionStartedAt: { type: DataTypes.DATE, allowNull: true },
      restartAt: { type: DataTypes.DATE, allowNull: true },
      passAt: { type: DataTypes.DATE, allowNull: true },

      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },
      productFamily: { type: DataTypes.STRING, allowNull: true },
      testStage: { type: DataTypes.STRING, allowNull: true },

      failureCategory: { type: DataTypes.STRING, allowNull: true },
      failureSymptom: { type: DataTypes.STRING, allowNull: true },
      suspectedPart: { type: DataTypes.STRING, allowNull: true },
      actualResolution: { type: DataTypes.STRING, allowNull: true },

      attemptsToPass: { type: DataTypes.FLOAT, allowNull: true },
      wasFirstTimeFix: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasEventuallyPassed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasEscalated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasManualResetUsed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      manualResetType: { type: DataTypes.STRING, allowNull: true },

      mttrMinutes: { type: DataTypes.FLOAT, allowNull: true },
      timeToAttentionMinutes: { type: DataTypes.FLOAT, allowNull: true },
      restartToPassMinutes: { type: DataTypes.FLOAT, allowNull: true },

      isSystemCausedDelay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      systemDelayReason: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'troubleshooting_events',
      indexes: [
        { fields: ['eventDate'], name: 'idx_te_eventDate' },
        { fields: ['userId'], name: 'idx_te_userId' },
        { fields: ['unitSerialNumber'], name: 'idx_te_unitSerialNumber' },
        { fields: ['building', 'shift'], name: 'idx_te_building_shift' },
        { fields: ['failureCategory'], name: 'idx_te_failureCategory' },
        { fields: ['failureSymptom'], name: 'idx_te_failureSymptom' },
      ],
    }
  );

  TroubleshootingEvent.associate = (models) => {
    TroubleshootingEvent.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  };

  return TroubleshootingEvent;
};