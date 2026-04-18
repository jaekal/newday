// src/migrations/XXXXXXXXXXXX-create-incidents.js
export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('Incidents', {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    staffId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    submitterId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    incidentDate: {
      type: Sequelize.DATEONLY,
      allowNull: false,
    },
    requiresFollowUp: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    title: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    details: {
      type: Sequelize.TEXT,
      allowNull: true,
    },
    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('Incidents');
}
