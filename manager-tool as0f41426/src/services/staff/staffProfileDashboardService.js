const CATEGORY_WEIGHTS = {
  throughput: 0.25,
  troubleshooting: 0.25,
  quality: 0.25,
  timeOwnership: 0.15,
  reliability: 0.1,
};

const GUARDRAILS = [
  { key: 'quality', threshold: 70, cap: 75, reason: 'Quality guardrail cap applied.' },
  { key: 'reliability', threshold: 60, cap: 70, reason: 'Reliability guardrail cap applied.' },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round1(v) {
  return v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
}

function averageScores(items) {
  const valid = items.filter((x) => x.score != null && x.weight > 0);
  if (!valid.length) return null;
  const totalWeight = valid.reduce((sum, x) => sum + x.weight, 0);
  const weighted = valid.reduce((sum, x) => sum + x.score * x.weight, 0);
  return round1(weighted / totalWeight);
}

function curveRatio(ratio, exponent = 1.7) {
  if (ratio == null) return null;
  return round1(Math.pow(clamp(ratio, 0, 1), exponent) * 100);
}

function directScore(value, bad, good, exponent = 1.7) {
  if (value == null) return null;
  if (value <= bad) return 0;
  if (value >= good) return 100;
  return curveRatio((value - bad) / (good - bad), exponent);
}

function inverseScore(value, good, bad, exponent = 1.7) {
  if (value == null) return null;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return curveRatio((bad - value) / (bad - good), exponent);
}

function statusFromScore(score) {
  if (score == null) return 'neutral';
  if (score >= 90) return 'good';
  if (score >= 75) return 'watch';
  return 'risk';
}

function trendMeta(delta) {
  if (delta == null) return { direction: 'flat', label: 'No trend', value: null };
  if (delta > 1) return { direction: 'up', label: `Up +${round1(delta)}`, value: round1(delta) };
  if (delta < -1) return { direction: 'down', label: `Down ${round1(delta)}`, value: round1(delta) };
  return { direction: 'flat', label: 'Stable', value: round1(delta) };
}

function metricRow(label, value, score = null, formula = null, standard = null, tone = 'default', extras = {}) {
  return { label, value, score, formula, standard, tone, ...extras };
}

function std(direction, good, bad, weight, note = '') {
  return { direction, good, bad, weight, note };
}

function fmt(v, suffix = '') {
  return v == null ? '-' : `${v}${suffix}`;
}

function pct(n, d) {
  return d ? round1((n / d) * 100) : null;
}

function avg(n, d) {
  return d ? round1(n / d) : null;
}

function dateRows(rows, limit, fn) {
  return rows
    .slice()
    .sort((a, b) => (b.metricDate > a.metricDate ? 1 : -1))
    .slice(0, limit)
    .map((r) => [r.metricDate, ...fn(r)]);
}

function reviewTrendDelta(reviewSummary) {
  const history = reviewSummary?.ratingHistory || [];
  if (history.length < 2) return null;
  const latest = history[history.length - 1]?.overallScore ?? null;
  const previous = history[history.length - 2]?.overallScore ?? null;
  if (latest == null || previous == null) return null;
  return round1((latest - previous) * 20);
}

function confidenceMultiplier(sampleSize, target) {
  if (sampleSize == null || target == null || target <= 0) return 1;
  return clamp(sampleSize / target, 0, 1);
}

function benchmarkRelativePct(value, median, direction) {
  if (value == null || median == null || median <= 0) return null;
  if (direction === 'higher') return round1((value / median) * 100);
  return round1((median / Math.max(value, 0.1)) * 100);
}

function buildMetricScore({ value, direction, good, bad, sampleSize, confidenceTarget, benchmarkMedian }) {
  const baseScore =
    direction === 'higher' ? directScore(value, bad, good) : inverseScore(value, good, bad);
  const relativePct = benchmarkRelativePct(value, benchmarkMedian, direction);
  const benchmarkScore = relativePct == null ? null : directScore(relativePct, 70, 115, 1.4);
  const rawScore =
    benchmarkScore == null
      ? baseScore
      : averageScores([
          { score: baseScore, weight: 0.82 },
          { score: benchmarkScore, weight: 0.18 },
        ]);
  const confidencePct = round1(confidenceMultiplier(sampleSize, confidenceTarget) * 100);
  const score = rawScore == null ? null : round1(rawScore * (confidencePct / 100));
  return { score, rawScore, confidencePct, relativePct, benchmarkMedian: round1(benchmarkMedian) };
}

function benchmarkNote(metric, cohortLabel) {
  if (!metric?.benchmarkMedian) return 'No cohort benchmark in range.';
  return `Benchmarked to ${cohortLabel}; current result is ${fmt(metric.relativePct, '%')} of median.`;
}

function confidenceNote(metric, sampleLabel) {
  if (!metric?.confidencePct) return 'Full confidence assumed.';
  return `Confidence uses current ${sampleLabel}; multiplier ${metric.confidencePct}%.`;
}

function buildBucket({ key, title, anchor, score, summary, insight, managerAction, highlight, metrics, detailRows, trend }) {
  return {
    key,
    title,
    anchor,
    score,
    summary,
    insight,
    managerAction,
    highlight,
    metrics,
    detailRows,
    trend,
    status: statusFromScore(score),
    weight: CATEGORY_WEIGHTS[key] || 1,
  };
}

function buildQualityIncidentSignal(incidents, startDate, endDate) {
  const weights = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  const relevant = (incidents || []).filter((incident) => {
    const d = incident?.incidentDate;
    if (!d) return false;
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    const impact = String(incident?.impactArea || '').toUpperCase();
    const type = String(incident?.type || '').toUpperCase();
    return impact === 'QUALITY' || type === 'FORMAL';
  });
  const weightedCount = relevant.reduce((sum, incident) => {
    const severity = String(incident?.severity || 'LOW').toUpperCase();
    return sum + (weights[severity] || 1);
  }, 0);
  return { count: relevant.length, weightedCount };
}

function buildShiftDependabilityPct(complianceSummary) {
  const stats = complianceSummary?.attendanceStats || {};
  if (!stats.totalDays) return null;
  return round1((((stats.onTimeDays || 0) + (stats.unpunctualDays || 0) * 0.5) / stats.totalDays) * 100);
}

function buildSkuBreadthScore(count) {
  if (!count) return 0;
  return round1((Math.log(1 + count) / Math.log(13)) * 100);
}

function topStrengthsAndFocus(buckets) {
  const scored = buckets.filter((b) => b.score != null).sort((a, b) => b.score - a.score);
  return {
    strengths: scored.slice(0, 2).map((b) => ({ title: b.title, text: b.highlight, score: b.score, anchor: b.anchor })),
    focusAreas: scored.slice(-2).reverse().map((b) => ({ title: b.title, text: b.highlight, score: b.score, anchor: b.anchor })),
  };
}

function buildExplainability(buckets) {
  const rows = buckets.flatMap((bucket) =>
    (bucket.detailRows || [])
      .filter((row) => row.score != null)
      .map((row) => ({ bucket: bucket.title, title: row.label, score: row.score }))
  );
  return {
    topPositive: rows.slice().sort((a, b) => b.score - a.score).slice(0, 3),
    topNegative: rows.slice().sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

function applyGuardrails(score, buckets) {
  let finalScore = score;
  const caps = [];
  for (const rule of GUARDRAILS) {
    const bucket = buckets.find((b) => b.key === rule.key);
    if (!bucket?.score || bucket.score >= rule.threshold) continue;
    if (finalScore == null || finalScore > rule.cap) {
      finalScore = rule.cap;
      caps.push({ ...rule, anchor: bucket.anchor });
    }
  }
  return { score: finalScore, caps };
}

function buildRiskFlags({ trainingSummary, complianceSummary, operationalMetrics, buckets, caps }) {
  const flags = [];
  const training = trainingSummary?.trainingStats || {};
  const esd = complianceSummary?.esdStats || {};
  const attendance = complianceSummary?.attendanceStats || {};
  const derived = operationalMetrics?.derived || {};
  const totals = operationalMetrics?.totals || {};

  if (training.expired > 0) flags.push({ label: `${training.expired} expired training items`, tone: 'risk', anchor: 'training-section' });
  if (training.expiring > 0) flags.push({ label: `${training.expiring} training items expiring soon`, tone: 'watch', anchor: 'training-section' });
  if (esd.daysWithoutPass > 0) flags.push({ label: `${esd.daysWithoutPass} days without ESD pass`, tone: 'risk', anchor: 'compliance-section' });
  if (attendance.absentDays > 0) flags.push({ label: `${attendance.absentDays} absent days tracked`, tone: 'risk', anchor: 'compliance-section' });
  if (attendance.lateDays > 0) flags.push({ label: `${attendance.lateDays} late attendance days`, tone: 'watch', anchor: 'compliance-section' });
  if ((totals.qualityEscapes || 0) > 0) flags.push({ label: `${totals.qualityEscapes} quality escapes`, tone: 'risk', anchor: 'bucket-quality' });
  if (derived.escalationRate != null && derived.escalationRate > 25) flags.push({ label: `High escalation rate ${derived.escalationRate}%`, tone: 'watch', anchor: 'bucket-troubleshooting' });
  if (derived.avgTimeToAttentionMinutes != null && derived.avgTimeToAttentionMinutes > 20) flags.push({ label: `Slow time to attention ${derived.avgTimeToAttentionMinutes} min`, tone: 'watch', anchor: 'bucket-time' });
  for (const cap of caps || []) flags.push({ label: cap.reason, tone: 'risk', anchor: cap.anchor });
  for (const bucket of buckets || []) {
    if ((bucket.detailRows || []).some((row) => row.confidencePct != null && row.confidencePct < 60)) {
      flags.push({ label: `${bucket.title} includes low-confidence metrics`, tone: 'watch', anchor: bucket.anchor });
    }
  }
  return flags;
}

function buildThroughputBucket({ assignmentSummary, operationalMetrics, reviewSummary, rows }) {
  const d = operationalMetrics?.derived || {};
  const t = operationalMetrics?.totals || {};
  const s = operationalMetrics?.samples || {};
  const cohort = operationalMetrics?.cohort || {};
  const medians = cohort.medians || {};
  const cohortLabel = [cohort.scope?.shift, cohort.scope?.area].filter(Boolean).join(' / ') || 'matched cohort';

  const servers = buildMetricScore({ value: d.avgServersCompletedPerDay, direction: 'higher', bad: 1, good: 15, sampleSize: s.daysTracked, confidenceTarget: 20, benchmarkMedian: medians.avgServersCompletedPerDay });
  const racks = buildMetricScore({ value: d.avgRacksCompletedPerDay, direction: 'higher', bad: 1, good: 8, sampleSize: s.daysTracked, confidenceTarget: 20, benchmarkMedian: medians.avgRacksCompletedPerDay });
  const closed = buildMetricScore({ value: d.avgAssignmentsClosedPerDay, direction: 'higher', bad: 1, good: 10, sampleSize: s.daysTracked, confidenceTarget: 20, benchmarkMedian: medians.avgAssignmentsClosedPerDay });
  const contrib = buildMetricScore({ value: d.productionContributionScore, direction: 'higher', bad: 50, good: 95, sampleSize: s.productionContributionDays, confidenceTarget: 15, benchmarkMedian: medians.productionContributionScore });

  const score = averageScores([
    { score: servers.score, weight: 0.22 },
    { score: racks.score, weight: 0.18 },
    { score: closed.score, weight: 0.22 },
    { score: contrib.score, weight: 0.38 },
  ]);

  return buildBucket({
    key: 'throughput',
    title: 'Throughput / Execution',
    anchor: 'bucket-throughput',
    score,
    summary: 'Measures clean output and closure rate.',
    insight: 'This bucket now blends thresholds, cohort-relative performance, and confidence.',
    managerAction: 'Check assignment mix before coaching pace when cohort-relative performance is healthy.',
    trend: trendMeta(reviewTrendDelta(reviewSummary)),
    highlight: t.serversCompleted != null ? `${t.serversCompleted} servers completed in window` : 'No throughput metric data available',
    metrics: {
      serversCompleted: t.serversCompleted,
      racksCompleted: t.racksCompleted ?? assignmentSummary?.assignmentStats?.totalRacks ?? null,
      assignmentsClosed: t.assignmentsClosed,
      checkTransactions: (t.checkInsCompleted || 0) + (t.checkOutsCompleted || 0),
      productionContributionScore: d.productionContributionScore,
    },
    detailRows: [
      metricRow('Servers Completed', t.serversCompleted ?? '-', servers.score, { aggregate: `${t.serversCompleted ?? 0} total / ${t.daysTracked || 0} days = ${fmt(d.avgServersCompletedPerDay)}`, cols: ['Date', 'Completed'], rows: dateRows(rows, 10, (r) => [r.serversCompleted ?? 0]) }, std('higher', '>=15 /day', '<=1 /day', '22%', `${confidenceNote(servers, 'days')}\n${benchmarkNote(servers, cohortLabel)}`), 'default', { confidencePct: servers.confidencePct, weight: 0.22 }),
      metricRow('Racks Completed', t.racksCompleted ?? '-', racks.score, { aggregate: `${t.racksCompleted ?? 0} total / ${t.daysTracked || 0} days = ${fmt(d.avgRacksCompletedPerDay)}`, cols: ['Date', 'Completed'], rows: dateRows(rows, 10, (r) => [r.racksCompleted ?? 0]) }, std('higher', '>=8 /day', '<=1 /day', '18%', `${confidenceNote(racks, 'days')}\n${benchmarkNote(racks, cohortLabel)}`), 'default', { confidencePct: racks.confidencePct, weight: 0.18 }),
      metricRow('Assignments Closed', t.assignmentsClosed ?? '-', closed.score, { aggregate: `${t.assignmentsClosed ?? 0} total / ${t.daysTracked || 0} days = ${fmt(d.avgAssignmentsClosedPerDay)}`, cols: ['Date', 'Closed'], rows: dateRows(rows, 10, (r) => [r.assignmentsClosed ?? 0]) }, std('higher', '>=10 /day', '<=1 /day', '22%', `${confidenceNote(closed, 'days')}\n${benchmarkNote(closed, cohortLabel)}`), 'default', { confidencePct: closed.confidencePct, weight: 0.22 }),
      metricRow('Production Contribution Score', d.productionContributionScore ?? '-', contrib.score, { aggregate: `Average across ${s.productionContributionDays || 0} days = ${fmt(d.productionContributionScore)}`, cols: ['Date', 'Score'], rows: dateRows(rows, 10, (r) => [fmt(r.productionContributionScore)]) }, std('higher', '>=95', '<=50', '38%', `${confidenceNote(contrib, 'days')}\n${benchmarkNote(contrib, cohortLabel)}`), 'default', { confidencePct: contrib.confidencePct, weight: 0.38 }),
    ],
  });
}

function buildTroubleshootingBucket({ operationalMetrics, reviewSummary, rows }) {
  const d = operationalMetrics?.derived || {};
  const t = operationalMetrics?.totals || {};
  const s = operationalMetrics?.samples || {};
  const cohort = operationalMetrics?.cohort || {};
  const medians = cohort.medians || {};
  const cohortLabel = [cohort.scope?.shift, cohort.scope?.area].filter(Boolean).join(' / ') || 'matched cohort';

  const ftfr = buildMetricScore({ value: d.firstTimeFixRate, direction: 'higher', bad: 40, good: 95, sampleSize: s.repairAttempts, confidenceTarget: 25, benchmarkMedian: medians.firstTimeFixRate });
  const misdiag = buildMetricScore({ value: d.misdiagnosisRate, direction: 'lower', good: 2, bad: 35, sampleSize: s.repairAttempts, confidenceTarget: 25, benchmarkMedian: medians.misdiagnosisRate });
  const rerun = buildMetricScore({ value: d.rerunSuccessRate, direction: 'higher', bad: 40, good: 95, sampleSize: s.rerunEvents, confidenceTarget: 20, benchmarkMedian: medians.rerunSuccessRate });
  const mttr = buildMetricScore({ value: d.mttrMinutes, direction: 'lower', good: 15, bad: 90, sampleSize: s.mttrEvents, confidenceTarget: 20, benchmarkMedian: medians.mttrMinutes });
  const recovery = buildMetricScore({ value: d.recoveryYieldRate, direction: 'higher', bad: 40, good: 85, sampleSize: s.repairAttempts, confidenceTarget: 25, benchmarkMedian: medians.recoveryYieldRate });
  const escalation = buildMetricScore({ value: d.escalationRate, direction: 'lower', good: 5, bad: 40, sampleSize: s.repairAttempts, confidenceTarget: 25, benchmarkMedian: medians.escalationRate });
  const touch = buildMetricScore({ value: d.touchCountPerUnit, direction: 'lower', good: 1.2, bad: 4.5, sampleSize: s.touchCountUnits, confidenceTarget: 20, benchmarkMedian: medians.touchCountPerUnit });
  const resolution = averageScores([{ score: ftfr.score, weight: 0.45 }, { score: misdiag.score, weight: 0.25 }, { score: rerun.score, weight: 0.3 }]);

  const score = averageScores([
    { score: resolution, weight: 0.45 },
    { score: recovery.score, weight: 0.2 },
    { score: mttr.score, weight: 0.15 },
    { score: escalation.score, weight: 0.12 },
    { score: touch.score, weight: 0.08 },
  ]);

  return buildBucket({
    key: 'troubleshooting',
    title: 'Troubleshooting Effectiveness',
    anchor: 'bucket-troubleshooting',
    score,
    summary: 'Measures whether work is truly being solved.',
    insight: 'Overlapping fix signals are collapsed into a resolution-effectiveness view.',
    managerAction: 'Review escalations and repeat loops before coaching raw speed.',
    trend: trendMeta(reviewTrendDelta(reviewSummary)),
    highlight: d.firstTimeFixRate != null ? `FTFR ${d.firstTimeFixRate}% with recovery yield ${fmt(d.recoveryYieldRate, '%')}` : 'Troubleshooting metrics not yet loaded',
    metrics: { mttr: d.mttrMinutes, firstTimeFixRate: d.firstTimeFixRate, misdiagnosisRate: d.misdiagnosisRate, escalationRate: d.escalationRate, touchCountPerUnit: d.touchCountPerUnit, attemptsToPass: d.attemptsToPass, rerunSuccessRate: d.rerunSuccessRate, recoveryYieldRate: d.recoveryYieldRate },
    detailRows: [
      metricRow('Resolution Effectiveness Score', resolution ?? '-', resolution, { aggregate: `Composite of FTFR ${fmt(d.firstTimeFixRate, '%')}, misdiagnosis ${fmt(d.misdiagnosisRate, '%')}, rerun success ${fmt(d.rerunSuccessRate, '%')}`, cols: ['Metric', 'Value'], rows: [['FTFR', fmt(d.firstTimeFixRate, '%')], ['Misdiagnosis', fmt(d.misdiagnosisRate, '%')], ['Rerun success', fmt(d.rerunSuccessRate, '%')]] }, std('higher', '>=90 composite', '<=55 composite', '45%', 'Combines overlapping resolution signals into one score.'), 'default', { weight: 0.45 }),
      metricRow('Recovery Yield', d.recoveryYieldRate != null ? `${d.recoveryYieldRate}%` : '-', recovery.score, { aggregate: `${t.recoveredUnits ?? 0} recovered / ${t.repairAttempts ?? 0} attempts = ${fmt(d.recoveryYieldRate, '%')}`, cols: ['Date', 'Recovered', 'Attempts', 'Yield %'], rows: dateRows(rows, 10, (r) => [r.recoveredUnits ?? 0, r.repairAttempts ?? 0, fmt(pct(r.recoveredUnits, r.repairAttempts))]) }, std('higher', '>=85%', '<=40%', '20%', `${confidenceNote(recovery, 'attempts')}\n${benchmarkNote(recovery, cohortLabel)}`), 'default', { confidencePct: recovery.confidencePct, weight: 0.2 }),
      metricRow('MTTR', d.mttrMinutes != null ? `${d.mttrMinutes} min` : '-', mttr.score, { aggregate: `${t.mttrMinutesTotal ?? 0} min / ${t.mttrEvents ?? 0} events = ${fmt(d.mttrMinutes, ' min')}`, cols: ['Date', 'Total min', 'Events', 'Avg min'], rows: dateRows(rows, 10, (r) => [r.mttrMinutesTotal ?? 0, r.mttrEvents ?? 0, fmt(avg(r.mttrMinutesTotal, r.mttrEvents))]) }, std('lower', '<=15 min', '>=90 min', '15%', `${confidenceNote(mttr, 'events')}\n${benchmarkNote(mttr, cohortLabel)}`), 'default', { confidencePct: mttr.confidencePct, weight: 0.15 }),
      metricRow('Diagnostic Depth Score', d.escalationRate != null ? `${d.escalationRate}% escalation` : '-', escalation.score, { aggregate: `${t.escalationCount ?? 0} escalated / ${t.repairAttempts ?? 0} attempts = ${fmt(d.escalationRate, '%')}`, cols: ['Date', 'Escalated', 'Attempts', 'Rate %'], rows: dateRows(rows, 10, (r) => [r.escalationCount ?? 0, r.repairAttempts ?? 0, fmt(pct(r.escalationCount, r.repairAttempts))]) }, std('lower', '<=5%', '>=40%', '12%', `${confidenceNote(escalation, 'attempts')}\n${benchmarkNote(escalation, cohortLabel)}`), 'default', { confidencePct: escalation.confidencePct, weight: 0.12 }),
      metricRow('Touch Count / Unit', d.touchCountPerUnit ?? '-', touch.score, { aggregate: `${t.touchCountTotal ?? 0} touches / ${t.touchCountUnits ?? 0} units = ${fmt(d.touchCountPerUnit)}`, cols: ['Date', 'Touches', 'Units', 'Avg'], rows: dateRows(rows, 10, (r) => [r.touchCountTotal ?? 0, r.touchCountUnits ?? 0, fmt(avg(r.touchCountTotal, r.touchCountUnits))]) }, std('lower', '<=1.2', '>=4.5', '8%', `${confidenceNote(touch, 'units')}\n${benchmarkNote(touch, cohortLabel)}`), 'default', { confidencePct: touch.confidencePct, weight: 0.08 }),
    ],
  });
}

function buildQualityBucket({ operationalMetrics, reviewSummary, incidents, rows }) {
  const d = operationalMetrics?.derived || {};
  const t = operationalMetrics?.totals || {};
  const s = operationalMetrics?.samples || {};
  const cohort = operationalMetrics?.cohort || {};
  const medians = cohort.medians || {};
  const cohortLabel = [cohort.scope?.shift, cohort.scope?.area].filter(Boolean).join(' / ') || 'matched cohort';
  const latest = (reviewSummary?.ratingHistory || []).slice(-1)[0] || null;
  const qualityReviewScore = latest?.buckets?.quality != null ? round1((latest.buckets.quality / 5) * 100) : null;

  const escapes = buildMetricScore({ value: d.qualityEscapesPer100RecoveredUnits, direction: 'lower', good: 0, bad: 6, sampleSize: s.recoveredUnits, confidenceTarget: 25, benchmarkMedian: medians.qualityEscapesPer100RecoveredUnits });
  const repeat = buildMetricScore({ value: d.repeatFailureRate, direction: 'lower', good: 2, bad: 30, sampleSize: s.recoveredUnits, confidenceTarget: 25, benchmarkMedian: medians.repeatFailureRate });
  const retest = buildMetricScore({ value: d.postRepairRetestSuccessRate, direction: 'higher', bad: 50, good: 98, sampleSize: s.postRepairRetestTotal, confidenceTarget: 20, benchmarkMedian: medians.postRepairRetestSuccessRate });
  const attribution = buildMetricScore({ value: d.defectAttributionAccuracy, direction: 'higher', bad: 40, good: 95, sampleSize: s.defectAttributionTotal, confidenceTarget: 20, benchmarkMedian: medians.defectAttributionAccuracy });
  const sevSignal = buildQualityIncidentSignal(incidents, operationalMetrics?.startDate, operationalMetrics?.endDate);
  const severity = buildMetricScore({ value: sevSignal.weightedCount, direction: 'lower', good: 0, bad: 6, sampleSize: sevSignal.count, confidenceTarget: 2 });
  const review = buildMetricScore({ value: qualityReviewScore, direction: 'higher', bad: 40, good: 95, sampleSize: qualityReviewScore != null ? 1 : null, confidenceTarget: 1 });

  const score = averageScores([
    { score: escapes.score, weight: 0.3 },
    { score: repeat.score, weight: 0.2 },
    { score: retest.score, weight: 0.2 },
    { score: attribution.score, weight: 0.1 },
    { score: severity.score, weight: 0.15 },
    { score: review.score, weight: 0.05 },
  ]);

  return buildBucket({
    key: 'quality',
    title: 'Quality Protection',
    anchor: 'bucket-quality',
    score,
    summary: 'Measures whether completed work stays clean.',
    insight: 'Escapes are normalized per 100 recovered units and paired with severity weighting.',
    managerAction: 'Use downstream failures first when this bucket slips; raw volume alone is no longer the story.',
    trend: trendMeta(reviewTrendDelta(reviewSummary)),
    highlight: d.qualityEscapesPer100RecoveredUnits != null ? `${d.qualityEscapesPer100RecoveredUnits} escapes per 100 recovered units` : 'Quality metric feed not loaded',
    metrics: { qualityEscapes: t.qualityEscapes, qualityEscapesPer100RecoveredUnits: d.qualityEscapesPer100RecoveredUnits, repeatFailureRate: d.repeatFailureRate, defectAttribution: d.defectAttributionAccuracy, postRepairRetestSuccess: d.postRepairRetestSuccessRate, severityWeightedQualitySignal: sevSignal.weightedCount },
    detailRows: [
      metricRow('Quality Escapes per 100 Recovered Units', d.qualityEscapesPer100RecoveredUnits ?? '-', escapes.score, { aggregate: `${t.qualityEscapes ?? 0} escapes / ${t.recoveredUnits ?? 0} recovered x 100 = ${fmt(d.qualityEscapesPer100RecoveredUnits)}`, cols: ['Date', 'Escapes', 'Recovered', 'Per 100'], rows: dateRows(rows, 10, (r) => [r.qualityEscapes ?? 0, r.recoveredUnits ?? 0, fmt(r.recoveredUnits ? round1(((r.qualityEscapes ?? 0) / r.recoveredUnits) * 100) : null)]) }, std('lower', '0 per 100', '>=6 per 100', '30%', `${confidenceNote(escapes, 'recovered units')}\n${benchmarkNote(escapes, cohortLabel)}`), 'default', { confidencePct: escapes.confidencePct, weight: 0.3 }),
      metricRow('Repeat Failure Rate', d.repeatFailureRate != null ? `${d.repeatFailureRate}%` : '-', repeat.score, { aggregate: `${t.repeatFailures ?? 0} repeat failures / ${t.recoveredUnits ?? 0} recovered = ${fmt(d.repeatFailureRate, '%')}`, cols: ['Date', 'Repeats', 'Recovered', 'Rate %'], rows: dateRows(rows, 10, (r) => [r.repeatFailures ?? 0, r.recoveredUnits ?? 0, fmt(pct(r.repeatFailures, r.recoveredUnits))]) }, std('lower', '<=2%', '>=30%', '20%', `${confidenceNote(repeat, 'recovered units')}\n${benchmarkNote(repeat, cohortLabel)}`), 'default', { confidencePct: repeat.confidencePct, weight: 0.2 }),
      metricRow('Post-Repair Retest Success', d.postRepairRetestSuccessRate != null ? `${d.postRepairRetestSuccessRate}%` : '-', retest.score, { aggregate: `${t.postRepairRetestSuccessCount ?? 0} passed / ${t.postRepairRetestTotal ?? 0} retested = ${fmt(d.postRepairRetestSuccessRate, '%')}`, cols: ['Date', 'Passed', 'Total', 'Rate %'], rows: dateRows(rows, 10, (r) => [r.postRepairRetestSuccessCount ?? 0, r.postRepairRetestTotal ?? 0, fmt(pct(r.postRepairRetestSuccessCount, r.postRepairRetestTotal))]) }, std('higher', '>=98%', '<=50%', '20%', `${confidenceNote(retest, 'retests')}\n${benchmarkNote(retest, cohortLabel)}`), 'default', { confidencePct: retest.confidencePct, weight: 0.2 }),
      metricRow('Severity-Weighted Quality Signal', sevSignal.weightedCount, severity.score, { aggregate: `${sevSignal.count} quality-related incidents weighted LOW=1 MEDIUM=2 HIGH=3 = ${sevSignal.weightedCount}`, cols: ['Signal', 'Value'], rows: [['Incidents', sevSignal.count], ['Weighted score', sevSignal.weightedCount]] }, std('lower', '0 points', '>=6 points', '15%', 'Adds severity weighting so each event does not count equally.'), 'default', { confidencePct: severity.confidencePct, weight: 0.15 }),
      metricRow('Defect Attribution Accuracy', d.defectAttributionAccuracy != null ? `${d.defectAttributionAccuracy}%` : '-', attribution.score, { aggregate: `${t.defectAttributionCorrectCount ?? 0} correct / ${t.defectAttributionTotal ?? 0} total = ${fmt(d.defectAttributionAccuracy, '%')}`, cols: ['Date', 'Correct', 'Total', 'Accuracy %'], rows: dateRows(rows, 10, (r) => [r.defectAttributionCorrectCount ?? 0, r.defectAttributionTotal ?? 0, fmt(pct(r.defectAttributionCorrectCount, r.defectAttributionTotal))]) }, std('higher', '>=95%', '<=40%', '10%', `${confidenceNote(attribution, 'attribution events')}\n${benchmarkNote(attribution, cohortLabel)}`), 'default', { confidencePct: attribution.confidencePct, weight: 0.1 }),
    ],
  });
}

function buildTimeOwnershipBucket({ operationalMetrics, reviewSummary, rows }) {
  const d = operationalMetrics?.derived || {};
  const t = operationalMetrics?.totals || {};
  const s = operationalMetrics?.samples || {};
  const cohort = operationalMetrics?.cohort || {};
  const medians = cohort.medians || {};
  const cohortLabel = [cohort.scope?.shift, cohort.scope?.area].filter(Boolean).join(' / ') || 'matched cohort';

  const attention = buildMetricScore({ value: d.avgTimeToAttentionMinutes, direction: 'lower', good: 5, bad: 45, sampleSize: s.timeToAttentionEvents, confidenceTarget: 20, benchmarkMedian: medians.avgTimeToAttentionMinutes });
  const idle = buildMetricScore({ value: d.avgIdleGapMinutes, direction: 'lower', good: 2, bad: 30, sampleSize: s.idleGapEvents, confidenceTarget: 20, benchmarkMedian: medians.avgIdleGapMinutes });
  const techDowntime = buildMetricScore({ value: d.technicianAddedDowntimeMinutes, direction: 'lower', good: 0, bad: 240, sampleSize: s.daysTracked, confidenceTarget: 20, benchmarkMedian: medians.technicianAddedDowntimeMinutes });
  const netDowntime = buildMetricScore({ value: d.netDowntimeContributionMinutes, direction: 'lower', good: 0, bad: 360, sampleSize: s.daysTracked, confidenceTarget: 20, benchmarkMedian: medians.netDowntimeContributionMinutes });
  const util = buildMetricScore({ value: d.utilizationPct, direction: 'higher', bad: 40, good: 90, sampleSize: s.utilizationDays, confidenceTarget: 15, benchmarkMedian: medians.utilizationPct });
  const response = averageScores([{ score: attention.score, weight: 0.7 }, { score: idle.score, weight: 0.3 }]);

  const score = averageScores([
    { score: response, weight: 0.5 },
    { score: techDowntime.score, weight: 0.2 },
    { score: netDowntime.score, weight: 0.15 },
    { score: util.score, weight: 0.15 },
  ]);

  return buildBucket({
    key: 'timeOwnership',
    title: 'Time Ownership / Downtime',
    anchor: 'bucket-time',
    score,
    summary: 'Measures response discipline and time control.',
    insight: 'Time-to-attention and idle gap now roll into a single response-efficiency signal.',
    managerAction: 'Check prioritization and queue response before coaching utilization alone.',
    trend: trendMeta(reviewTrendDelta(reviewSummary)),
    highlight: d.avgTimeToAttentionMinutes != null ? `Response built from ${d.avgTimeToAttentionMinutes} min attention lag` : 'Time-ownership metrics not yet loaded',
    metrics: { responseEfficiencyScore: response, timeToAttention: d.avgTimeToAttentionMinutes, technicianAddedDowntime: d.technicianAddedDowntimeMinutes, netDowntimeContribution: d.netDowntimeContributionMinutes, utilization: d.utilizationPct, idleGap: d.avgIdleGapMinutes },
    detailRows: [
      metricRow('Response Efficiency Index', response ?? '-', response, { aggregate: `Composite of time-to-attention ${fmt(d.avgTimeToAttentionMinutes, ' min')} and idle gap ${fmt(d.avgIdleGapMinutes, ' min')}`, cols: ['Metric', 'Value'], rows: [['Time to attention', fmt(d.avgTimeToAttentionMinutes, ' min')], ['Idle gap', fmt(d.avgIdleGapMinutes, ' min')]] }, std('higher', '>=90 composite', '<=55 composite', '50%', 'Merges overlapping latency signals.'), 'default', { weight: 0.5 }),
      metricRow('Technician-Added Downtime', d.technicianAddedDowntimeMinutes != null ? `${d.technicianAddedDowntimeMinutes} min` : '-', techDowntime.score, { aggregate: `${t.technicianAddedDowntimeMinutes ?? 0} technician-attributed downtime minutes`, cols: ['Date', 'Minutes'], rows: dateRows(rows, 10, (r) => [r.technicianAddedDowntimeMinutes ?? 0]) }, std('lower', '0 min', '>=240 min', '20%', `${confidenceNote(techDowntime, 'days')}\n${benchmarkNote(techDowntime, cohortLabel)}`), 'default', { confidencePct: techDowntime.confidencePct, weight: 0.2 }),
      metricRow('Net Downtime Contribution', d.netDowntimeContributionMinutes != null ? `${d.netDowntimeContributionMinutes} min` : '-', netDowntime.score, { aggregate: `${t.netDowntimeContributionMinutes ?? 0} total downtime minutes in scope`, cols: ['Date', 'Minutes'], rows: dateRows(rows, 10, (r) => [r.netDowntimeContributionMinutes ?? 0]) }, std('lower', '0 min', '>=360 min', '15%', `${confidenceNote(netDowntime, 'days')}\n${benchmarkNote(netDowntime, cohortLabel)}`), 'default', { confidencePct: netDowntime.confidencePct, weight: 0.15 }),
      metricRow('Utilization', d.utilizationPct != null ? `${d.utilizationPct}%` : '-', util.score, { aggregate: `Average utilization across ${s.utilizationDays || 0} days = ${fmt(d.utilizationPct, '%')}`, cols: ['Date', 'Utilization %'], rows: dateRows(rows, 10, (r) => [fmt(r.utilizationPct)]) }, std('higher', '>=90%', '<=40%', '15%', `${confidenceNote(util, 'days')}\n${benchmarkNote(util, cohortLabel)}`), 'default', { confidencePct: util.confidencePct, weight: 0.15 }),
    ],
  });
}

function buildReliabilityBucket({ operationalMetrics, trainingSummary, complianceSummary, skuExposure, reviewSummary, rows }) {
  const d = operationalMetrics?.derived || {};
  const s = operationalMetrics?.samples || {};
  const cohort = operationalMetrics?.cohort || {};
  const medians = cohort.medians || {};
  const cohortLabel = [cohort.scope?.shift, cohort.scope?.area].filter(Boolean).join(' / ') || 'matched cohort';
  const training = trainingSummary?.trainingStats || {};
  const skuCount = (skuExposure || []).length;
  const shiftDependabilityPct = buildShiftDependabilityPct(complianceSummary);

  const attendance = buildMetricScore({ value: d.attendanceReliabilityPct, direction: 'higher', bad: 50, good: 98, sampleSize: s.attendanceDays, confidenceTarget: 15, benchmarkMedian: medians.attendanceReliabilityPct });
  const esd = buildMetricScore({ value: d.esdCompliancePct, direction: 'higher', bad: 60, good: 99, sampleSize: s.esdDays, confidenceTarget: 15, benchmarkMedian: medians.esdCompliancePct });
  const cert = buildMetricScore({ value: d.certificationHealthPct, direction: 'higher', bad: 50, good: 98, sampleSize: s.certificationDays, confidenceTarget: 15, benchmarkMedian: medians.certificationHealthPct });
  const cross = buildMetricScore({ value: d.crossTrainingReadinessPct, direction: 'higher', bad: 30, good: 90, sampleSize: s.crossTrainingDays, confidenceTarget: 10, benchmarkMedian: medians.crossTrainingReadinessPct });
  const dependability = buildMetricScore({ value: shiftDependabilityPct, direction: 'higher', bad: 50, good: 95, sampleSize: complianceSummary?.attendanceStats?.totalDays, confidenceTarget: 15 });
  const skuScore = buildSkuBreadthScore(skuCount);

  const score = averageScores([
    { score: attendance.score, weight: 0.25 },
    { score: esd.score, weight: 0.25 },
    { score: cert.score, weight: 0.2 },
    { score: dependability.score, weight: 0.1 },
    { score: skuScore, weight: 0.1 },
    { score: cross.score, weight: 0.1 },
  ]);

  return buildBucket({
    key: 'reliability',
    title: 'Reliability / Readiness',
    anchor: 'bucket-reliability',
    score,
    summary: 'Measures readiness, compliance, and dependability.',
    insight: 'SKU breadth saturates and punctuality is now visible through shift dependability.',
    managerAction: 'Fix readiness hygiene before expecting stable quality or throughput gains.',
    trend: trendMeta(reviewTrendDelta(reviewSummary)),
    highlight: d.esdCompliancePct != null ? `ESD compliance ${d.esdCompliancePct}% with ${skuCount} SKUs of exposure` : 'Reliability feed partially available',
    metrics: { attendanceReliability: d.attendanceReliabilityPct, esdPassRate: d.esdCompliancePct, skuExposureCount: skuCount, skuBreadthScore: skuScore, shiftDependabilityPct, crossTrainingReadiness: d.crossTrainingReadinessPct, certificationHealth: d.certificationHealthPct },
    detailRows: [
      metricRow('Attendance Reliability', d.attendanceReliabilityPct != null ? `${d.attendanceReliabilityPct}%` : '-', attendance.score, { aggregate: `Average attendance reliability across ${s.attendanceDays || 0} days = ${fmt(d.attendanceReliabilityPct, '%')}`, cols: ['Date', 'Attendance %'], rows: dateRows(rows, 10, (r) => [fmt(r.attendanceReliabilityPct)]) }, std('higher', '>=98%', '<=50%', '25%', `${confidenceNote(attendance, 'days')}\n${benchmarkNote(attendance, cohortLabel)}`), 'default', { confidencePct: attendance.confidencePct, weight: 0.25 }),
      metricRow('ESD Compliance', d.esdCompliancePct != null ? `${d.esdCompliancePct}%` : '-', esd.score, { aggregate: `Average ESD pass rate across ${s.esdDays || 0} days = ${fmt(d.esdCompliancePct, '%')}`, cols: ['Date', 'ESD %'], rows: dateRows(rows, 10, (r) => [fmt(r.esdCompliancePct)]) }, std('higher', '>=99%', '<=60%', '25%', `${confidenceNote(esd, 'days')}\n${benchmarkNote(esd, cohortLabel)}`), 'default', { confidencePct: esd.confidencePct, weight: 0.25 }),
      metricRow('Certification Health', d.certificationHealthPct != null ? `${d.certificationHealthPct}%` : '-', cert.score, { aggregate: `Average certification health across ${s.certificationDays || 0} days = ${fmt(d.certificationHealthPct, '%')}`, cols: ['Date', 'Cert %'], rows: dateRows(rows, 10, (r) => [fmt(r.certificationHealthPct)]) }, std('higher', '>=98%', '<=50%', '20%', `${confidenceNote(cert, 'days')}\n${benchmarkNote(cert, cohortLabel)}`), 'default', { confidencePct: cert.confidencePct, weight: 0.2 }),
      metricRow('Shift Dependability Score', shiftDependabilityPct != null ? `${shiftDependabilityPct}%` : '-', dependability.score, { aggregate: `((on-time ${complianceSummary?.attendanceStats?.onTimeDays || 0}) + 0.5 x unpunctual ${complianceSummary?.attendanceStats?.unpunctualDays || 0}) / ${complianceSummary?.attendanceStats?.totalDays || 0} x 100`, cols: ['Signal', 'Value'], rows: [['On-time days', complianceSummary?.attendanceStats?.onTimeDays || 0], ['Unpunctual days', complianceSummary?.attendanceStats?.unpunctualDays || 0], ['Late days', complianceSummary?.attendanceStats?.lateDaysByBucket || 0]] }, std('higher', '>=95%', '<=50%', '10%', 'Weights last-minute punctuality misses more directly than basic attendance.'), 'default', { confidencePct: dependability.confidencePct, weight: 0.1 }),
      metricRow('SKU Exposure Breadth', skuCount, skuScore, { aggregate: `Log-scaled breadth score from ${skuCount} SKUs. Growth saturates around 12 SKUs.`, cols: ['SKU', 'Times worked'], rows: (skuExposure || []).slice(0, 10).map((x) => [x.skuCode || x.sku || '-', x.timesWorked ?? '-']) }, std('higher', '12+ SKUs', '0 SKUs', '10%', 'Breadth helps, but it no longer scales endlessly.'), 'default', { weight: 0.1 }),
      metricRow('Cross-Training Readiness', d.crossTrainingReadinessPct != null ? `${d.crossTrainingReadinessPct}%` : '-', cross.score, { aggregate: `Average cross-training readiness = ${fmt(d.crossTrainingReadinessPct, '%')}`, cols: ['Date', 'Readiness %'], rows: dateRows(rows, 10, (r) => [fmt(r.crossTrainingReadinessPct)]) }, std('higher', '>=90%', '<=30%', '10%', `${confidenceNote(cross, 'days')}\n${benchmarkNote(cross, cohortLabel)}`), 'default', { confidencePct: cross.confidencePct, weight: 0.1 }),
      metricRow('Expired Training Items', training.expired || 0, inverseScore(training.expired || 0, 0, 3, 1.5), { aggregate: `${training.expired || 0} expired, ${training.expiring || 0} expiring soon, ${training.current || 0} current`, cols: ['Status', 'Count'], rows: [['Current', training.current || 0], ['Expiring soon', training.expiring || 0], ['Expired', training.expired || 0]] }, std('lower', '0 expired', '>=3 expired', 'Risk flag', 'Shown as readiness risk but not counted in weighted bucket score.')),
    ],
  });
}

export function buildPerformanceDashboard({ reviewSummary, trainingSummary, complianceSummary, assignmentSummary, operationalMetrics, skuExposure, incidents }) {
  const rows = operationalMetrics?.rows || [];
  const buckets = [
    buildThroughputBucket({ assignmentSummary, operationalMetrics, reviewSummary, rows }),
    buildTroubleshootingBucket({ operationalMetrics, reviewSummary, rows }),
    buildQualityBucket({ operationalMetrics, reviewSummary, incidents, rows }),
    buildTimeOwnershipBucket({ operationalMetrics, reviewSummary, rows }),
    buildReliabilityBucket({ operationalMetrics, trainingSummary, complianceSummary, skuExposure, reviewSummary, rows }),
  ];

  const overallRawScore = averageScores(buckets.map((b) => ({ score: b.score, weight: b.weight })));
  const guardrails = applyGuardrails(overallRawScore, buckets);
  const explainability = buildExplainability(buckets);
  const { strengths, focusAreas } = topStrengthsAndFocus(buckets);
  const riskFlags = buildRiskFlags({ trainingSummary, complianceSummary, operationalMetrics, buckets, caps: guardrails.caps });

  return {
    overallPerformanceScore: guardrails.score,
    overallRawScore,
    overallTrend: trendMeta(reviewTrendDelta(reviewSummary)),
    overallCaps: guardrails.caps,
    buckets,
    performanceBuckets: buckets.reduce((acc, bucket) => {
      acc[bucket.key] = bucket;
      return acc;
    }, {}),
    navigation: [
      { label: 'Snapshot', anchor: 'profile-top' },
      { label: 'Performance', anchor: 'performance-dashboard' },
      { label: 'Compliance', anchor: 'compliance-section' },
      { label: 'Training', anchor: 'training-section' },
      { label: 'Coaching', anchor: 'coaching-section' },
      { label: 'Reviews', anchor: 'reviews-section' },
      { label: 'Goals', anchor: 'goals-section' },
      { label: 'Assignments', anchor: 'assignments-section' },
    ],
    summary: { strengths, focusAreas, riskFlags, explainability },
  };
}
