// src/constants/ratings.js

// ── Bucket field registry ─────────────────────────────────────────────────────
//
// These names MUST match the actual MonthlyReview model column names exactly.
// The dashboard's computeBucketedAverage() reads review records using these
// field names directly — a mismatch silently excludes a criterion from the
// bucket average, biasing scores for every review in the dashboard.
//
// All five buckets contain exactly 3 criteria each (equal-weighted by design).
// With equal bucket sizes, average-of-bucket-averages equals a flat average
// across all answered criteria — so the weighting approach is not a concern
// provided all criteria are answered (which server-side validation now enforces).
//
// DO NOT rename fields here without also updating:
//   • src/models/MonthlyReview.js          (model column definition)
//   • src/routes/reviews.js computeBucketScores()  (score write path)
//   • src/views/reviews/new.ejs + edit.ejs  (input name= attributes)
// ─────────────────────────────────────────────────────────────────────────────
export const RATING_BUCKETS = {
  PEOPLE_FIRST: [
    'positiveAttitude',
    'proactive',
    'integrity',
  ],
  OWNERSHIP_MENTALITY: [
    'accountability2',        // DB column: accountability2 (not the legacy 'accountability')
    'problemSolving',
    'efficiency',
  ],
  QUALITY: [
    'resultsOrientation',     // DB column: resultsOrientation (not the legacy 'results')
    'communication',
    'continuousImprovement',
  ],
  PARTNERSHIP: [
    'teamwork2',              // DB column: teamwork2 (not the legacy 'teamwork')
    'collaboration',
    'buildTrust',
  ],
  LEADING_PEOPLE: [
    'decisionMakingWithRisk',
    'enableTheTeam',
    'hireDevelopManage',      // DB column: hireDevelopManage (not 'hireDevelopManageEffectively')
  ],
};

// Buckets used for everyone
export const BASE_BUCKET_KEYS = [
  'PEOPLE_FIRST',
  'OWNERSHIP_MENTALITY',
  'QUALITY',
  'PARTNERSHIP',
];

// Leadership bucket (only used when scoring leads/supervisors)
export const LEADERSHIP_BUCKET_KEY = 'LEADING_PEOPLE';

export const RATING_FIELDS_BASE =
  BASE_BUCKET_KEYS.flatMap(key => RATING_BUCKETS[key]);

export const RATING_FIELDS_LEADERSHIP = RATING_BUCKETS[LEADERSHIP_BUCKET_KEY];

// All possible rating fields (base + leadership)
export const RATING_FIELDS = [
  ...RATING_FIELDS_BASE,
  ...RATING_FIELDS_LEADERSHIP,
];

/**
 * Compute bucket averages for a given review record.
 * Returns an object like:
 * {
 *   PEOPLE_FIRST: 3.7,
 *   OWNERSHIP_MENTALITY: 3.3,
 *   QUALITY: 3.8,
 *   PARTNERSHIP: 4.0,
 *   LEADING_PEOPLE: 3.5  // only if any leadership fields are present
 * }
 *
 * Buckets with no valid numbers are omitted.
 */
export function computeBucketAverages(review) {
  if (!review) return {};

  const bucketAverages = {};
  const hasLeadershipField =
    RATING_BUCKETS.LEADING_PEOPLE.some(field =>
      typeof review[field] === 'number' && !Number.isNaN(review[field])
    );

  const bucketsToUse = [...BASE_BUCKET_KEYS];
  if (hasLeadershipField) {
    bucketsToUse.push(LEADERSHIP_BUCKET_KEY);
  }

  for (const bucketKey of bucketsToUse) {
    const fields = RATING_BUCKETS[bucketKey] || [];
    let sum = 0;
    let count = 0;

    for (const field of fields) {
      const raw = review[field];
      const val = typeof raw === 'string' ? Number(raw) : raw;

      if (typeof val === 'number' && !Number.isNaN(val)) {
        sum += val;
        count += 1;
      }
    }

    if (count > 0) {
      bucketAverages[bucketKey] = sum / count;
    }
  }

  return bucketAverages;
}

/**
 * Overall bucketed average:
 * average of the bucket averages.
 * Returns number or null.
 */
export function computeBucketedAverage(review) {
  const bucketAverages = computeBucketAverages(review);
  const values = Object.values(bucketAverages);

  if (!values.length) return null;

  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}
