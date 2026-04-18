// models/auditTemplate.js
export default (sequelize, DataTypes) => {
  const AuditTemplate = sequelize.define('AuditTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    frequency: { type: DataTypes.ENUM('daily','weekly','biweekly','monthly'), allowNull: false },
    shift: { type: DataTypes.ENUM('A','B','C','ALL'), allowNull: false, defaultValue: 'ALL' },
    questions: { type: DataTypes.JSON, allowNull: false }, // [{id,label,weight,required,type:'bool|scale|text'}]
    weightTotal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, { tableName: 'audit_templates', underscored: true });
  return AuditTemplate;
};
