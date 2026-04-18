// models/auditResponse.js
export default (sequelize, DataTypes) => {
  const AuditResponse = sequelize.define('AuditResponse', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    runId: { type: DataTypes.UUID, allowNull: false },
    questionId: { type: DataTypes.STRING(64), allowNull: false },
    value: { type: DataTypes.JSON, allowNull: true }, // bool|number|string plus evidence list
    evidence: { type: DataTypes.JSON, allowNull: false, defaultValue: [] } // [{name, path, ts}]
  }, { tableName: 'audit_responses', underscored: true });

  AuditResponse.associate = ({ AuditRun }) => {
    AuditResponse.belongsTo(AuditRun, { foreignKey: 'runId', as: 'run' });
  };
  return AuditResponse;
};
