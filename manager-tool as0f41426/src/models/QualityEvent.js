// src/models/QualityEvent.js
export default (sequelize, DataTypes) => {
  const QualityEvent = sequelize.define(
    'QualityEvent',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      userId: { type: DataTypes.INTEGER, allowNull: false },
      employeeId: { type: DataTypes.STRING, allowNull: true },

      eventDate: { type: DataTypes.DATEONLY, allowNull: false },

      unitSerialNumber: { type: DataTypes.STRING, allowNull: true },
      rackSerialNumber: { type: DataTypes.STRING, allowNull: true },

      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },
      productFamily: { type: DataTypes.STRING, allowNull: true },
      testStage: { type: DataTypes.STRING, allowNull: true },

      eventType: {
        type: DataTypes.ENUM(
          'ESCAPE',
          'REPEAT_FAILURE',
          'MISDIAGNOSIS',
          'INSPECTION_CATCH',
          'DEFECT_ATTRIBUTION',
          'REOPEN'
        ),
        allowNull: false,
      },

      severity: { type: DataTypes.STRING, allowNull: true },
      category: { type: DataTypes.STRING, allowNull: true },
      partNumber: { type: DataTypes.STRING, allowNull: true },

      attributedToTechnician: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      resolved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'quality_events',
      indexes: [
        { fields: ['eventDate'], name: 'idx_qe_eventDate' },
        { fields: ['userId'], name: 'idx_qe_userId' },
        { fields: ['eventType'], name: 'idx_qe_eventType' },
        { fields: ['building', 'shift'], name: 'idx_qe_building_shift' },
      ],
    }
  );

  QualityEvent.associate = (models) => {
    QualityEvent.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  };

  return QualityEvent;
};