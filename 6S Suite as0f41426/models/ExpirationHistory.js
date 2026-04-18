// src/models/ExpirationHistory.js
export default (sequelize, DataTypes) => {
  const ExpirationHistory = sequelize.define(
    'ExpirationHistory',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      itemType: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      itemId: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      action: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'update',
      },

      actor: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      changes: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'expiration_histories',
      timestamps: true,
      indexes: [
        { fields: ['itemType'] },
        { fields: ['itemId'] },
        { fields: ['itemType', 'itemId'] },
        { fields: ['action'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  ExpirationHistory.associate = (models) => {
    // No hard FK because itemId may refer to:
    // - tool serial number
    // - equipment asset id
    // - asset id
    // This keeps the model flexible.
  };

  return ExpirationHistory;
};