// src/models/LoginAuditLog.js
export default (sequelize, DataTypes) => {
  const LoginAuditLog = sequelize.define(
    'LoginAuditLog',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },

      loginName: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      emailSnapshot: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      roleSnapshot: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      eventType: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      failureReason: {
        type: DataTypes.STRING,
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
      tableName: 'LoginAuditLogs',
      timestamps: true,
      indexes: [
        { fields: ['userId'] },
        { fields: ['loginName'] },
        { fields: ['eventType'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  LoginAuditLog.associate = ({ User }) => {
    if (User) {
      LoginAuditLog.belongsTo(User, {
        foreignKey: 'userId',
        as: 'user',
      });
    }
  };

  return LoginAuditLog;
};