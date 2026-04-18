// src/models/rackAssignment.js
export default (sequelize, DataTypes) => {
  const RackAssignment = sequelize.define(
    'RackAssignment',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      employeeId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      assignmentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      rackCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      rackList: {
        // optional: comma-separated list or raw text of racks
        type: DataTypes.TEXT,
        allowNull: true,
      },
      area: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      shift: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: 'RackAssignments',
      indexes: [
        { fields: ['staffId', 'assignmentDate'] },
        { fields: ['employeeId'] },
      ],
    }
  );

  RackAssignment.associate = (models) => {
    RackAssignment.belongsTo(models.User, {
      as: 'Staff',
      foreignKey: 'staffId',
    });
  };

  return RackAssignment;
};
