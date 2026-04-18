// src/services/technicianScoreService.js
import {
  clampScore,
  ratioPercent,
  thresholdScore,
  inverseThresholdScore,
  normalizedTargetScore,
  weightedAverage,
  scoreBandFromOverall,
} from './scoreUtils.js';

const DEFAULT_TARGETS = {
  mttrMinutes: 20,
  attemptsToPass: 1.3,
  escalationRate: 5,
};

export function buildTechnicianScoreFromMetric(metric, options = {}) {
  const targets = { ...DEFAULT_TARGETS, ...(options.targets || {}) };

  // ─────────────────────────────────────────────
  // Raw KPIs
  // ─────────────────────────────────────────────
  const completionAttainment = ratioPercent(metric.serversCompleted, metric.serversAssigned);
  const rackCompletionAttainment = ratioPercent(metric.racksCompleted, metric.racksAssigned);
  const checkAccuracy = ratioPercent(metric.validCheckActions, metric.expectedCheckActions);
  const inspectionCompletion = ratioPercent(metric.inspectionsCompleted, metric.inspectionsExpected);

  const firstTimeFixRate = ratioPercent(metric.unitsPassedFirstRerun, metric.unitsRepaired);
  const repairSuccessRate = ratioPercent(metric.unitsEventuallyPassed, metric.unitsRepaired);
  const rerunPassRate = ratioPercent(metric.successfulReruns, metric.totalReruns);
  const escalationRate = ratioPercent(metric.escalatedUnits, metric.totalFailedUnitsWorked);

  const averageMttr =
    metric.mttrSampleCount > 0 ? metric.mttrMinutesTotal / metric.mttrSampleCount : null;

  const averageAttemptsToPass =
    metric.passedRepairUnitCount > 0 ? metric.totalAttemptsToPass / metric.passedRepairUnitCount : null;

  const escapeRate = ratioPercent(metric.postTestEscapes, metric.unitsPassed);
  const repeatFailureRate = ratioPercent(metric.repeatFailures, metric.repairedUnitsForRepeatCheck);
  const inspectionEffectiveness = ratioPercent(metric.inspectionIssuesCaught, metric.totalIssuesFound);
  const misdiagnosisRate = ratioPercent(metric.incorrectRepairActions, metric.totalRepairActions);
  const defectAttributionRate = ratioPercent(metric.technicianAttributedDefects, metric.unitsHandled);

  const attendanceReliability = ratioPercent(metric.shiftsAttendedOnTime, metric.scheduledShifts);
  const esdCompletionRate = ratioPercent(metric.daysWithSuccessfulEsd, metric.daysWorked);
  const esdFirstPassRate = ratioPercent(metric.esdFirstPassDays, metric.totalEsdDays);

  const crossTrainingRate = ratioPercent(
    metric.completedCrossTrainingModules,
    metric.plannedCrossTrainingModules
  );

  // ─────────────────────────────────────────────
  // Score each component
  // ─────────────────────────────────────────────
  const completionAttainmentScore = thresholdScore(completionAttainment, [
    { min: 95, score: 100 },
    { min: 90, score: 90 },
    { min: 85, score: 80 },
    { min: 80, score: 70 },
    { min: 75, score: 60 },
    { min: 0, score: 40 },
  ]);

  const rackCompletionScore = thresholdScore(rackCompletionAttainment, [
    { min: 95, score: 100 },
    { min: 90, score: 90 },
    { min: 85, score: 80 },
    { min: 80, score: 70 },
    { min: 75, score: 60 },
    { min: 0, score: 40 },
  ]);

  const checkAccuracyScore = thresholdScore(checkAccuracy, [
    { min: 98, score: 100 },
    { min: 95, score: 90 },
    { min: 90, score: 80 },
    { min: 85, score: 70 },
    { min: 0, score: 50 },
  ]);

  const inspectionCompletionScore = thresholdScore(inspectionCompletion, [
    { min: 98, score: 100 },
    { min: 95, score: 90 },
    { min: 90, score: 80 },
    { min: 85, score: 70 },
    { min: 0, score: 50 },
  ]);

  const firstTimeFixScore = thresholdScore(firstTimeFixRate, [
    { min: 85, score: 100 },
    { min: 80, score: 90 },
    { min: 75, score: 80 },
    { min: 70, score: 70 },
    { min: 65, score: 60 },
    { min: 0, score: 40 },
  ]);

  const repairSuccessScore = thresholdScore(repairSuccessRate, [
    { min: 92, score: 100 },
    { min: 88, score: 90 },
    { min: 84, score: 80 },
    { min: 80, score: 70 },
    { min: 75, score: 60 },
    { min: 0, score: 40 },
  ]);

  const mttrScore = normalizedTargetScore(averageMttr, targets.mttrMinutes);
  const attemptsScore = normalizedTargetScore(averageAttemptsToPass, targets.attemptsToPass);

  const rerunPassScore = thresholdScore(rerunPassRate, [
    { min: 85, score: 100 },
    { min: 80, score: 90 },
    { min: 75, score: 80 },
    { min: 70, score: 70 },
    { min: 65, score: 60 },
    { min: 0, score: 40 },
  ]);

  const escalationControlScore =
    escalationRate == null
      ? null
      : clampScore((targets.escalationRate / Math.max(escalationRate, 0.1)) * 100);

  const escapePreventionScore = inverseThresholdScore(escapeRate, [
    { max: 0.5, score: 100 },
    { max: 1.0, score: 90 },
    { max: 1.5, score: 75 },
    { max: 2.0, score: 60 },
    { max: Infinity, score: 40 },
  ]);

  const repeatFailurePreventionScore = inverseThresholdScore(repeatFailureRate, [
    { max: 2, score: 100 },
    { max: 4, score: 90 },
    { max: 6, score: 80 },
    { max: 8, score: 65 },
    { max: Infinity, score: 45 },
  ]);

  const inspectionEffectivenessScore = thresholdScore(inspectionEffectiveness, [
    { min: 90, score: 100 },
    { min: 85, score: 90 },
    { min: 80, score: 80 },
    { min: 75, score: 70 },
    { min: 0, score: 50 },
  ]);

  const misdiagnosisPreventionScore = inverseThresholdScore(misdiagnosisRate, [
    { max: 3, score: 100 },
    { max: 5, score: 90 },
    { max: 8, score: 80 },
    { max: 10, score: 65 },
    { max: Infinity, score: 45 },
  ]);

  const defectAttributionControlScore = inverseThresholdScore(defectAttributionRate, [
    { max: 1, score: 100 },
    { max: 2, score: 90 },
    { max: 3, score: 75 },
    { max: 4, score: 60 },
    { max: Infinity, score: 40 },
  ]);

  const attendanceReliabilityScore = thresholdScore(attendanceReliability, [
    { min: 98, score: 100 },
    { min: 95, score: 90 },
    { min: 92, score: 80 },
    { min: 88, score: 70 },
    { min: 0, score: 50 },
  ]);

  const esdCompletionScore = thresholdScore(esdCompletionRate, [
    { min: 100, score: 100 },
    { min: 98, score: 90 },
    { min: 95, score: 75 },
    { min: 0, score: 50 },
  ]);

  const esdFirstPassScore = thresholdScore(esdFirstPassRate, [
    { min: 95, score: 100 },
    { min: 90, score: 90 },
    { min: 85, score: 80 },
    { min: 80, score: 70 },
    { min: 0, score: 50 },
  ]);

  const policyAdherenceScore = clampScore(100 - (metric.infractionPoints || 0) * 5);

  const crossTrainingScore = clampScore(crossTrainingRate);
  const knowledgeSharingScore = clampScore(Math.min(metric.knowledgeSharingEvents * 20, 100));
  const ciParticipationScore = clampScore(Math.min(metric.ciParticipationEvents * 20, 100));
  const leadershipSupportScore = clampScore(Math.min(metric.leadershipSupportEvents * 20, 100));

  // ─────────────────────────────────────────────
  // Category scores
  // ─────────────────────────────────────────────
  const productivityScore = weightedAverage([
    { score: completionAttainmentScore, weight: 0.5 },
    { score: rackCompletionScore, weight: 0.25 },
    { score: checkAccuracyScore, weight: 0.15 },
    { score: inspectionCompletionScore, weight: 0.1 },
  ]);

  const troubleshootingScore = weightedAverage([
    { score: firstTimeFixScore, weight: 0.30 },
    { score: repairSuccessScore, weight: 0.25 },
    { score: mttrScore, weight: 0.20 },
    { score: attemptsScore, weight: 0.10 },
    { score: rerunPassScore, weight: 0.10 },
    { score: escalationControlScore, weight: 0.05 },
  ]);

  const qualityScore = weightedAverage([
    { score: escapePreventionScore, weight: 0.35 },
    { score: repeatFailurePreventionScore, weight: 0.25 },
    { score: inspectionEffectivenessScore, weight: 0.20 },
    { score: misdiagnosisPreventionScore, weight: 0.10 },
    { score: defectAttributionControlScore, weight: 0.10 },
  ]);

  const complianceScore = weightedAverage([
    { score: attendanceReliabilityScore, weight: 0.40 },
    { score: esdCompletionScore, weight: 0.35 },
    { score: esdFirstPassScore, weight: 0.15 },
    { score: policyAdherenceScore, weight: 0.10 },
  ]);

  const developmentScore = weightedAverage([
    { score: crossTrainingScore, weight: 0.35 },
    { score: knowledgeSharingScore, weight: 0.25 },
    { score: ciParticipationScore, weight: 0.25 },
    { score: leadershipSupportScore, weight: 0.15 },
  ]);

  let overallScore = weightedAverage([
    { score: productivityScore, weight: 0.25 },
    { score: troubleshootingScore, weight: 0.35 },
    { score: qualityScore, weight: 0.25 },
    { score: complianceScore, weight: 0.10 },
    { score: developmentScore, weight: 0.05 },
  ]);

  if (overallScore != null && metric.complexityMultiplier && metric.complexityMultiplier > 0) {
    overallScore = clampScore(overallScore * metric.complexityMultiplier);
  }

  const scoreBand = scoreBandFromOverall(overallScore);

  const minimumSampleMet =
    (metric.serversAssigned || 0) >= 10 &&
    (metric.unitsRepaired || 0) >= 5 &&
    (metric.unitsPassed || 0) >= 20;

  return {
    productivityScore,
    troubleshootingScore,
    qualityScore,
    complianceScore,
    developmentScore,
    overallScore,
    scoreBand,
    minimumSampleMet,
    rawMetricsJson: {
      completionAttainment,
      rackCompletionAttainment,
      checkAccuracy,
      inspectionCompletion,
      firstTimeFixRate,
      repairSuccessRate,
      averageMttr,
      averageAttemptsToPass,
      rerunPassRate,
      escalationRate,
      escapeRate,
      repeatFailureRate,
      inspectionEffectiveness,
      misdiagnosisRate,
      defectAttributionRate,
      attendanceReliability,
      esdCompletionRate,
      esdFirstPassRate,
      crossTrainingRate,
    },
    scoreBreakdownJson: {
      productivity: {
        completionAttainmentScore,
        rackCompletionScore,
        checkAccuracyScore,
        inspectionCompletionScore,
        finalScore: productivityScore,
      },
      troubleshooting: {
        firstTimeFixScore,
        repairSuccessScore,
        mttrScore,
        attemptsScore,
        rerunPassScore,
        escalationControlScore,
        finalScore: troubleshootingScore,
      },
      quality: {
        escapePreventionScore,
        repeatFailurePreventionScore,
        inspectionEffectivenessScore,
        misdiagnosisPreventionScore,
        defectAttributionControlScore,
        finalScore: qualityScore,
      },
      compliance: {
        attendanceReliabilityScore,
        esdCompletionScore,
        esdFirstPassScore,
        policyAdherenceScore,
        finalScore: complianceScore,
      },
      development: {
        crossTrainingScore,
        knowledgeSharingScore,
        ciParticipationScore,
        leadershipSupportScore,
        finalScore: developmentScore,
      },
    },
  };
}