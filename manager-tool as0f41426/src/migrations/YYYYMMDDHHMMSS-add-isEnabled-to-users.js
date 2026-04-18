// YYYYMMDDHHMMSS-add-isEnabled-to-users.js
export async function up(queryInterface, Sequelize) {
  await queryInterface.addColumn("Users", "isEnabled", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  });
}

export async function down(queryInterface) {
  await queryInterface.removeColumn("Users", "isEnabled");
}
