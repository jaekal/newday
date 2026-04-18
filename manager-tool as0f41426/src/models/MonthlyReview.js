// src/models/MonthlyReview.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const MonthlyReview = sequelize.define(
  'MonthlyReview',
  {
    periodMonth: { type: DataTypes.INTEGER, allowNull: false }, // 1–12
    periodYear:  { type: DataTypes.INTEGER, allowNull: false },

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy technician ratings (kept for backward compatibility)
    // ─────────────────────────────────────────────────────────────────────────
    technicalCompetence: { type: DataTypes.INTEGER, allowNull: true },
    materialHandling:    { type: DataTypes.INTEGER, allowNull: true },
    timeManagement:      { type: DataTypes.INTEGER, allowNull: true },
    repair:              { type: DataTypes.INTEGER, allowNull: true },
    accountability:      { type: DataTypes.INTEGER, allowNull: true },
    troubleshooting:     { type: DataTypes.INTEGER, allowNull: true },
    initiative:          { type: DataTypes.INTEGER, allowNull: true },
    culturalFit:         { type: DataTypes.INTEGER, allowNull: true },
    communicationSkills: { type: DataTypes.INTEGER, allowNull: true },
    teamwork:            { type: DataTypes.INTEGER, allowNull: true },

    // ─────────────────────────────────────────────────────────────────────────
    // Bucket criteria — People First
    // ─────────────────────────────────────────────────────────────────────────
    positiveAttitude: { type: DataTypes.INTEGER, allowNull: true },
    proactive:        { type: DataTypes.INTEGER, allowNull: true },
    integrity:        { type: DataTypes.INTEGER, allowNull: true },

    // Ownership Mentality
    accountability2: { type: DataTypes.INTEGER, allowNull: true },
    problemSolving:  { type: DataTypes.INTEGER, allowNull: true },
    efficiency:      { type: DataTypes.INTEGER, allowNull: true },

    // Quality
    resultsOrientation:    { type: DataTypes.INTEGER, allowNull: true },
    communication:         { type: DataTypes.INTEGER, allowNull: true },
    continuousImprovement: { type: DataTypes.INTEGER, allowNull: true },

    // Partnership
    teamwork2:     { type: DataTypes.INTEGER, allowNull: true },
    collaboration: { type: DataTypes.INTEGER, allowNull: true },
    buildTrust:    { type: DataTypes.INTEGER, allowNull: true },

    // Leading People (only populated for Lead / Supervisor / Champion roles)
    decisionMakingWithRisk: { type: DataTypes.INTEGER, allowNull: true },
    enableTheTeam:          { type: DataTypes.INTEGER, allowNull: true },
    hireDevelopManage:      { type: DataTypes.INTEGER, allowNull: true },

    // ─────────────────────────────────────────────────────────────────────────
    // Per-question comments (TEXT, optional)
    // ─────────────────────────────────────────────────────────────────────────
    positiveAttitudeComment: { type: DataTypes.TEXT, allowNull: true },
    proactiveComment:        { type: DataTypes.TEXT, allowNull: true },
    integrityComment:        { type: DataTypes.TEXT, allowNull: true },

    accountability2Comment: { type: DataTypes.TEXT, allowNull: true },
    problemSolvingComment:  { type: DataTypes.TEXT, allowNull: true },
    efficiencyComment:      { type: DataTypes.TEXT, allowNull: true },

    resultsOrientationComment:    { type: DataTypes.TEXT, allowNull: true },
    communicationComment:         { type: DataTypes.TEXT, allowNull: true },
    continuousImprovementComment: { type: DataTypes.TEXT, allowNull: true },

    teamwork2Comment:      { type: DataTypes.TEXT, allowNull: true },
    collaborationComment:  { type: DataTypes.TEXT, allowNull: true },
    buildTrustComment:     { type: DataTypes.TEXT, allowNull: true },

    decisionMakingWithRiskComment: { type: DataTypes.TEXT, allowNull: true },
    enableTheTeamComment:          { type: DataTypes.TEXT, allowNull: true },
    hireDevelopManageComment:      { type: DataTypes.TEXT, allowNull: true },

    // ─────────────────────────────────────────────────────────────────────────
    // Computed bucket averages (stored for fast dashboard queries)
    // ─────────────────────────────────────────────────────────────────────────
    bucketPeopleAvg:      { type: DataTypes.FLOAT, allowNull: true },
    bucketOwnershipAvg:   { type: DataTypes.FLOAT, allowNull: true },
    bucketQualityAvg:     { type: DataTypes.FLOAT, allowNull: true },
    bucketPartnershipAvg: { type: DataTypes.FLOAT, allowNull: true },
    bucketLeadingAvg:     { type: DataTypes.FLOAT, allowNull: true }, // null for non-lead roles
    overallBucketAvg:     { type: DataTypes.FLOAT, allowNull: true },

    // Role / position recorded at review time so re-classification doesn't
    // retroactively change which bucket set was used.
    positionTypeSnapshot: { type: DataTypes.STRING, allowNull: true },

    // Top-level summary comment
    comment: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    // ── Indexes ───────────────────────────────────────────────────────────────
    //
    // The unique index is the primary guard against duplicate reviews at the
    // database level.  The route handler already does a soft pre-check with
    // MonthlyReview.findOne() and redirects to the edit page when a review
    // exists, but that check has a race condition window.  This index closes
    // that window and acts as the hard guarantee.
    //
    // The non-unique lookup indexes speed up the most common queries:
    //  • Dashboard: all reviews by a submitter for a given month/year
    //  • Staff profile: all reviews for one staff member
    //  • "My reviews" page: reviews submitted by the logged-in user
    indexes: [
      // ── UNIQUE guard: one review per staff per submitter per period ─────────
      {
        unique: true,
        name: 'uniq_monthly_review_staff_submitter_period',
        fields: ['staffId', 'submitterId', 'periodMonth', 'periodYear'],
      },

      // ── Lookup: all reviews for a given staff member ───────────────────────
      {
        name: 'idx_monthly_review_staff',
        fields: ['staffId'],
      },

      // ── Lookup: all reviews submitted by one manager ───────────────────────
      {
        name: 'idx_monthly_review_submitter',
        fields: ['submitterId'],
      },

      // ── Lookup: dashboard monthly aggregate (month + year filter) ──────────
      {
        name: 'idx_monthly_review_period',
        fields: ['periodYear', 'periodMonth'],
      },
    ],
  }
);

// ── Associations ─────────────────────────────────────────────────────────────
User.hasMany(MonthlyReview, { as: 'SubmittedReviews', foreignKey: 'submitterId' });
MonthlyReview.belongsTo(User, { as: 'Submitter', foreignKey: 'submitterId' });

User.hasMany(MonthlyReview, { as: 'StaffReviews', foreignKey: 'staffId' });
MonthlyReview.belongsTo(User, { as: 'Staff', foreignKey: 'staffId' });

export default MonthlyReview;
