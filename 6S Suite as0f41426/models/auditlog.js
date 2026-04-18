// models/AuditLog.js
export default (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    auditDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    auditorName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    comments: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    passed: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    criteria: {
      type: DataTypes.JSON,
      allowNull: true
    },
    assetId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'assets', // Sequelize uses plural lowercase by default for table names
        key: 'id'
      },
      onDelete: 'CASCADE'
    }
  }, {
    tableName: 'audit_logs',
    timestamps: true
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.Asset, {
      foreignKey: 'assetId',
      as: 'asset',
      onDelete: 'CASCADE'
    });
  };

  return AuditLog;
};
