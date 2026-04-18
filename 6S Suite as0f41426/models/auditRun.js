// models/auditRun.js
export default (sequelize, DataTypes) => {
  const AuditRun = sequelize.define('AuditRun', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    shift: { type: DataTypes.ENUM('A','B','C'), allowNull: false },
    status: { type: DataTypes.ENUM('open','submitted','approved','rejected'), allowNull: false, defaultValue: 'open' },
    score: { type: DataTypes.FLOAT, allowNull: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    approvedBy: { type: DataTypes.STRING(64), allowNull: true }
  }, { tableName: 'audit_runs', underscored: true });

  AuditRun.associate = ({ AuditTemplate }) => {
    AuditRun.belongsTo(AuditTemplate, { foreignKey: 'templateId', as: 'template' });
  };
  return AuditRun;
};
