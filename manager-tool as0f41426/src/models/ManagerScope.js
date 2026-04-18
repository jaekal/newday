// src/models/ManagerScope.js
export default (sequelize, DataTypes) => {
  const ManagerScope = sequelize.define(
    'ManagerScope',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      building: { type: DataTypes.STRING, allowNull: false },
      shift: { type: DataTypes.STRING, allowNull: false },
    },
    {
      tableName: 'manager_scopes',
      indexes: [
        {
          unique: true,
          fields: ['userId', 'building', 'shift'],
          name: 'uniq_manager_scope_user_building_shift',
        },
        { fields: ['userId'], name: 'idx_manager_scope_userId' },
        { fields: ['building'], name: 'idx_manager_scope_building' },
        { fields: ['shift'], name: 'idx_manager_scope_shift' },
      ],
    }
  );

  ManagerScope.associate = (models) => {
    ManagerScope.belongsTo(models.User, { foreignKey: 'userId', as: 'Manager' });
  };

  return ManagerScope;
};