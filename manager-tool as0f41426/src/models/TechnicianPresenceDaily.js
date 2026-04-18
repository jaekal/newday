// src/models/TechnicianPresenceDaily.js
export default (sequelize, DataTypes) => {
  const TechnicianPresenceDaily = sequelize.define(
    'TechnicianPresenceDaily',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

      userId: { type: DataTypes.INTEGER, allowNull: false },
      employeeId: { type: DataTypes.STRING, allowNull: true },

      presenceDate: { type: DataTypes.DATEONLY, allowNull: false },

      building: { type: DataTypes.STRING, allowNull: true },
      shift: { type: DataTypes.STRING, allowNull: true },
      area: { type: DataTypes.STRING, allowNull: true },

      wasScheduled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasPresent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasActiveTechnician: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      wasLate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      minutesLate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      esdPassed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      certificationsReady: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

      assignmentStatus: { type: DataTypes.STRING, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'technician_presence_daily',
      indexes: [
        {
          unique: true,
          fields: ['userId', 'presenceDate'],
          name: 'uniq_technician_presence_daily',
        },
        { fields: ['presenceDate'], name: 'idx_tpd_presenceDate' },
        { fields: ['building', 'shift'], name: 'idx_tpd_building_shift' },
        { fields: ['wasActiveTechnician'], name: 'idx_tpd_wasActiveTechnician' },
      ],
    }
  );

  TechnicianPresenceDaily.associate = (models) => {
    TechnicianPresenceDaily.belongsTo(models.User, { foreignKey: 'userId', as: 'User' });
  };

  return TechnicianPresenceDaily;
};