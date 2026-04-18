export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('manager_scopes', {
    id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
    userId: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    building: { type: Sequelize.STRING, allowNull: false },
    shift: { type: Sequelize.STRING, allowNull: false },
    createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  });

  await queryInterface.addConstraint('manager_scopes', {
    fields: ['userId', 'building'],
    type: 'unique',
    name: 'uniq_manager_scope_user_building',
  });
}

export async function down(queryInterface) {
  await queryInterface.dropTable('manager_scopes');
}
