'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const fields = [
      'positiveAttitudeComment',
      'proactiveComment',
      'integrityComment',

      'accountability2Comment',
      'problemSolvingComment',
      'efficiencyComment',

      'resultsOrientationComment',
      'communicationComment',
      'continuousImprovementComment',

      'teamwork2Comment',
      'collaborationComment',
      'buildTrustComment',

      'decisionMakingWithRiskComment',
      'enableTheTeamComment',
      'hireDevelopManageComment',
    ];

    for (const f of fields) {
      await queryInterface.addColumn('MonthlyReviews', f, {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const fields = [
      'positiveAttitudeComment',
      'proactiveComment',
      'integrityComment',
      'accountability2Comment',
      'problemSolvingComment',
      'efficiencyComment',
      'resultsOrientationComment',
      'communicationComment',
      'continuousImprovementComment',
      'teamwork2Comment',
      'collaborationComment',
      'buildTrustComment',
      'decisionMakingWithRiskComment',
      'enableTheTeamComment',
      'hireDevelopManageComment',
    ];

    for (const f of fields) {
      await queryInterface.removeColumn('MonthlyReviews', f);
    }
  }
};
