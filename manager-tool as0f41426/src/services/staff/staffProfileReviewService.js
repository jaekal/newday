// src/services/staff/staffProfileReviewService.js
import { MonthlyReview, User } from '../../models/index.js';
import { computeBucketedAverage } from '../../constants/ratings.js';

export async function buildReviewSummary({ staffId, viewer }) {
  const viewerRole = viewer.role || 'STAFF';
  const viewerId = viewer.id;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const allReviews = await MonthlyReview.findAll({
    where: { staffId },
    include: [{ model: User, as: 'Submitter' }],
    order: [['periodYear', 'ASC'], ['periodMonth', 'ASC'], ['createdAt', 'ASC']],
  });

  let visibleReviews = [];
  if (viewerRole === 'LEAD') {
    visibleReviews = allReviews.filter((rev) => rev.submitterId === viewerId);
  } else if (viewerRole === 'SUPERVISOR') {
    visibleReviews = allReviews.filter((rev) => {
      const submitterRole = rev.Submitter ? rev.Submitter.role : null;
      return submitterRole === 'LEAD' || submitterRole === 'SUPERVISOR' || rev.submitterId === viewerId;
    });
  } else if (viewerRole === 'ADMIN' || viewerRole === 'SENIOR_MANAGER' || viewerRole === 'MANAGER') {
    visibleReviews = allReviews;
  }

  let overallTotal = 0;
  let overallCount = 0;
  let currentMonthTotal = 0;
  let currentMonthCount = 0;

  const ratingHistory = [];

  for (const rev of visibleReviews) {
    const avg = computeBucketedAverage(rev.toJSON());

    if (avg != null && !Number.isNaN(avg)) {
      overallTotal += avg;
      overallCount += 1;

      if (rev.periodMonth === currentMonth && rev.periodYear === currentYear) {
        currentMonthTotal += avg;
        currentMonthCount += 1;
      }
    }

    ratingHistory.push({
      id: rev.id,
      periodLabel: `${rev.periodYear}-${String(rev.periodMonth).padStart(2, '0')}`,
      periodYear: rev.periodYear,
      periodMonth: rev.periodMonth,
      overallScore: avg,
      submitterName: rev.Submitter ? rev.Submitter.name : 'N/A',
      submitterRole: rev.Submitter ? (rev.Submitter.role || '').toUpperCase() : '',
      comment: rev.comment,

      positiveAttitudeComment: rev.positiveAttitudeComment,
      proactiveComment: rev.proactiveComment,
      integrityComment: rev.integrityComment,
      accountability2Comment: rev.accountability2Comment,
      problemSolvingComment: rev.problemSolvingComment,
      efficiencyComment: rev.efficiencyComment,
      resultsOrientationComment: rev.resultsOrientationComment,
      communicationComment: rev.communicationComment,
      continuousImprovementComment: rev.continuousImprovementComment,
      teamwork2Comment: rev.teamwork2Comment,
      collaborationComment: rev.collaborationComment,
      buildTrustComment: rev.buildTrustComment,
      decisionMakingWithRiskComment: rev.decisionMakingWithRiskComment,
      enableTheTeamComment: rev.enableTheTeamComment,
      hireDevelopManageComment: rev.hireDevelopManageComment,

      buckets: {
        people: rev.bucketPeopleAvg,
        ownership: rev.bucketOwnershipAvg,
        quality: rev.bucketQualityAvg,
        partnership: rev.bucketPartnershipAvg,
        leading: rev.bucketLeadingAvg,
      },
      questions: {
        positiveAttitude: rev.positiveAttitude,
        proactive: rev.proactive,
        integrity: rev.integrity,
        accountability2: rev.accountability2,
        problemSolving: rev.problemSolving,
        efficiency: rev.efficiency,
        resultsOrientation: rev.resultsOrientation,
        communication: rev.communication,
        continuousImprovement: rev.continuousImprovement,
        teamwork2: rev.teamwork2,
        collaboration: rev.collaboration,
        buildTrust: rev.buildTrust,
        decisionMakingWithRisk: rev.decisionMakingWithRisk,
        enableTheTeam: rev.enableTheTeam,
        hireDevelopManage: rev.hireDevelopManage,
      },
    });
  }

  const overallAverage = overallCount > 0 ? overallTotal / overallCount : null;
  const currentMonthAverage = currentMonthCount > 0 ? currentMonthTotal / currentMonthCount : null;

  return {
    currentMonth,
    currentYear,
    overallAverage,
    currentMonthAverage,
    ratingHistory,
    visibleReviews,
  };
}