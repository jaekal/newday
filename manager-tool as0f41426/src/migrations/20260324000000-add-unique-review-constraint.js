// src/migrations/20260324000000-add-unique-review-constraint.js
//
// Adds a composite UNIQUE index on MonthlyReviews(staffId, submitterId,
// periodMonth, periodYear) so the database itself rejects duplicate reviews,
// regardless of which code path attempts the insert.
//
// Safe to run against an existing database that may already contain duplicates.
// The up() function detects and removes duplicates first (keeping the latest
// row by updatedAt / id), then applies the index.  down() removes the index.

export async function up(queryInterface, Sequelize) {
  // ── 1. Detect any pre-existing duplicates ─────────────────────────────────
  //
  // SQLite does not support partial-index-based deduplication in a single step,
  // so we identify and delete duplicates before the unique index is applied.
  //
  // "Duplicate" means: same staffId + submitterId + periodMonth + periodYear.
  // We keep the row with the highest updatedAt; ties broken by highest id.

  const [dupes] = await queryInterface.sequelize.query(`
    SELECT staffId, submitterId, periodMonth, periodYear, COUNT(*) AS cnt
    FROM MonthlyReviews
    WHERE staffId     IS NOT NULL
      AND submitterId IS NOT NULL
      AND periodMonth IS NOT NULL
      AND periodYear  IS NOT NULL
    GROUP BY staffId, submitterId, periodMonth, periodYear
    HAVING COUNT(*) > 1;
  `);

  if (dupes && dupes.length > 0) {
    console.warn(
      `[migration] Found ${dupes.length} duplicate review group(s). ` +
      `Removing all but the most-recent row in each group.`
    );

    for (const dupe of dupes) {
      // Identify every id in this duplicate group, ordered newest → oldest.
      const [rows] = await queryInterface.sequelize.query(`
        SELECT id
        FROM MonthlyReviews
        WHERE staffId     = ${Number(dupe.staffId)}
          AND submitterId = ${Number(dupe.submitterId)}
          AND periodMonth = ${Number(dupe.periodMonth)}
          AND periodYear  = ${Number(dupe.periodYear)}
        ORDER BY datetime(updatedAt) DESC, id DESC;
      `);

      // Keep the first (newest) row; delete the rest.
      const keepId  = rows[0].id;
      const dropIds = rows.slice(1).map((r) => r.id);

      if (dropIds.length) {
        console.warn(
          `[migration] Keeping review id=${keepId}; ` +
          `deleting duplicate id(s): ${dropIds.join(', ')}`
        );

        await queryInterface.sequelize.query(`
          DELETE FROM MonthlyReviews
          WHERE id IN (${dropIds.join(',')});
        `);
      }
    }
  } else {
    console.info('[migration] No duplicate reviews found — proceeding cleanly.');
  }

  // ── 2. Drop the index if it already exists (idempotent re-runs) ────────────
  try {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS uniq_monthly_review_staff_submitter_period;`
    );
  } catch {
    // SQLite doesn't error on DROP INDEX IF EXISTS, but guard anyway.
  }

  // ── 3. Add the composite unique index ─────────────────────────────────────
  await queryInterface.addIndex('MonthlyReviews', {
    fields: ['staffId', 'submitterId', 'periodMonth', 'periodYear'],
    unique: true,
    name: 'uniq_monthly_review_staff_submitter_period',
  });

  console.info('[migration] unique index uniq_monthly_review_staff_submitter_period created.');
}

export async function down(queryInterface) {
  await queryInterface.removeIndex(
    'MonthlyReviews',
    'uniq_monthly_review_staff_submitter_period'
  );

  console.info('[migration] unique index uniq_monthly_review_staff_submitter_period removed.');
}
