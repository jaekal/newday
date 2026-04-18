// src/models/StaffAlias.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';

const StaffAlias = sequelize.define(
  'StaffAlias',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },

    /**
     * Backward-compatible field name.
     * In the current app, this points to User.id.
     * If you later want clearer semantics, migrate this to userId.
     */
    staffId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    aliasType: {
      type: DataTypes.ENUM(
        'DOMAIN_USERNAME',
        'EMPLOYEE_ID',
        'NAME',
        'USERNAME'
      ),
      allowNull: false,
    },

    /**
     * Always normalized to lowercase for consistent lookup behavior.
     */
    aliasValue: {
      type: DataTypes.STRING,
      allowNull: false,
      set(value) {
        const normalized =
          value == null ? '' : String(value).trim().toLowerCase();
        this.setDataValue('aliasValue', normalized);
      },
      validate: {
        notEmpty: true,
      },
    },
  },
  {
    tableName: 'StaffAliases',
    indexes: [
      { fields: ['staffId'] },
      { fields: ['aliasType'] },
      { unique: true, fields: ['aliasType', 'aliasValue'] },
    ],
    hooks: {
      beforeValidate(alias) {
        if (alias.aliasType != null) {
          alias.aliasType = String(alias.aliasType).trim().toUpperCase();
        }

        if (alias.aliasValue != null) {
          alias.aliasValue = String(alias.aliasValue).trim().toLowerCase();
        }
      },
    },
  }
);

StaffAlias.associate = (models) => {
  if (models?.User) {
    models.User.hasMany(StaffAlias, {
      foreignKey: 'staffId',
      as: 'Aliases',
    });

    StaffAlias.belongsTo(models.User, {
      foreignKey: 'staffId',
      as: 'Staff',
    });
  }
};

export default StaffAlias;