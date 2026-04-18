// src/services/scoreUtils.js
export function clampScore(value) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function ratioPercent(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function thresholdScore(value, bands = []) {
  if (value == null || Number.isNaN(value)) return null;

  for (const band of bands) {
    if (value >= band.min) return band.score;
  }

  return bands.length ? bands[bands.length - 1].score : null;
}

export function inverseThresholdScore(value, bands = []) {
  if (value == null || Number.isNaN(value)) return null;

  for (const band of bands) {
    if (value <= band.max) return band.score;
  }

  return bands.length ? bands[bands.length - 1].score : null;
}

export function normalizedTargetScore(actual, target) {
  if (actual == null || Number.isNaN(actual) || !target || target <= 0) return null;
  return clampScore((target / actual) * 100);
}

export function weightedAverage(items = []) {
  const valid = items.filter(
    (x) => x && x.score != null && !Number.isNaN(x.score) && x.weight != null && !Number.isNaN(x.weight)
  );

  if (!valid.length) return null;

  const totalWeight = valid.reduce((sum, x) => sum + x.weight, 0);
  if (totalWeight <= 0) return null;

  const weighted = valid.reduce((sum, x) => sum + x.score * x.weight, 0);
  return weighted / totalWeight;
}

export function scoreBandFromOverall(score) {
  if (score == null || Number.isNaN(score)) return 'INSUFFICIENT_DATA';
  if (score >= 90) return 'EXCEPTIONAL';
  if (score >= 80) return 'STRONG';
  if (score >= 70) return 'MEETS_EXPECTATIONS';
  if (score >= 60) return 'NEEDS_COACHING';
  return 'IMMEDIATE_REVIEW';
}