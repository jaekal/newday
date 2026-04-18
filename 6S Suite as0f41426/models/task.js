// models/task.js
export default (sequelize, DataTypes) => {
  const Task = sequelize.define('Task', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { // backlog | todo | doing | review | done
      type: DataTypes.ENUM('backlog','todo','doing','review','done'),
      allowNull: false,
      defaultValue: 'backlog'
    },
    priority: { // low | normal | high | urgent
      type: DataTypes.ENUM('low','normal','high','urgent'),
      allowNull: false,
      defaultValue: 'normal'
    },
    domain: {
      type: DataTypes.ENUM('project','audit'),
      allowNull: false,
      defaultValue: 'project'
    },
    kind: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    assigneeId: { type: DataTypes.STRING(64), allowNull: true },
    ownerId: { type: DataTypes.STRING(64), allowNull: true },
    ownerName: { type: DataTypes.STRING(128), allowNull: true },
    ownerLabel: { type: DataTypes.STRING(160), allowNull: true },
    dueDate: { type: DataTypes.DATE, allowNull: true },
    tags: {
      type: DataTypes.JSON, // array of strings
      allowNull: false,
      defaultValue: []
    },
    activity: {
      type: DataTypes.JSON, // [{ts, actorId, action, from?, to?}]
      allowNull: false,
      defaultValue: []
    },
    wipKey: { // to enforce WIP per column+board if needed
      type: DataTypes.STRING(64),
      allowNull: true
    },
    createdBy: { type: DataTypes.STRING(64), allowNull: true },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true },
    meta: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {}
    },
  }, {
    tableName: 'tasks',
    underscored: true
  });

  return Task;
};
