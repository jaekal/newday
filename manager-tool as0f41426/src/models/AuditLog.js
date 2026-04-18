// src/models/AuditLog.js
export default (sequelize, DataTypes) => {
  const AuditLog = sequelize.define(
    'AuditLog',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      actorUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },

      actorName: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      actorRole: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      actionType: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      entityType: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      entityId: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      targetName: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      detailsJson: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'AuditLogs',
      timestamps: true,
      indexes: [
        { fields: ['actorUserId'] },
        { fields: ['actionType'] },
        { fields: ['entityType'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  AuditLog.associate = ({ User }) => {
    if (User) {
      AuditLog.belongsTo(User, {
        foreignKey: 'actorUserId',
        as: 'actor',
      });
    }
  };

  return AuditLog;
};