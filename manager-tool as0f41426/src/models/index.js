// src/models/index.js
import sequelize from '../db.js';
import { DataTypes } from 'sequelize';

import TrainingFactory from './training.js';
import IncidentModel from './incident.js';
import RackAssignmentFactory from './rackAssignment.js';

import EsdCheck from './EsdCheck.js';
import Attendance from './Attendance.js';
import AuditLogFactory from './AuditLog.js';
import User from './User.js';
import StaffProfile from './StaffProfile.js';
import MonthlyReview from './MonthlyReview.js';
import Goal from './Goal.js';
import GoalCheckIn from './GoalCheckIn.js';
import SkuExposure from './SkuExposure.js';
import Meeting from './Meeting.js';
import ReviewChange from './ReviewChange.js';
import ReviewAssignmentModel from './ReviewAssignment.js';
import RosterEntry from './RosterEntry.js';
import StaffAlias from './StaffAlias.js';
import ManagerScopeModel from './ManagerScope.js';
import ReviewChangeLog from './ReviewChangeLog.js';
import RackAssignmentEvent from './RackAssignmentEvent.js';
import LoginAuditLogFactory from './LoginAuditLog.js';

import TechnicianDailyMetricFactory from './TechnicianDailyMetric.js';
import TechnicianScoreSnapshotFactory from './TechnicianScoreSnapshot.js';
import ShiftDailyMetricFactory from './ShiftDailyMetric.js';
import TroubleshootingEventFactory from './TroubleshootingEvent.js';
import QualityEventFactory from './QualityEvent.js';
import TechnicianPresenceDailyFactory from './TechnicianPresenceDaily.js';
import defineStaffDailyMetric from './StaffDailyMetric.js';
import ExposureAggregate from './ExposureAggregate.js';
import TrainingAssignment from './TrainingAssignment.js';

/* ─────────────────────────────────────────────
 * Factory models
 * ───────────────────────────────────────────── */
const ReviewAssignment = ReviewAssignmentModel(sequelize, DataTypes);
const Incident = IncidentModel(sequelize, DataTypes);
const Training = TrainingFactory(sequelize, DataTypes);
const RackAssignment = RackAssignmentFactory(sequelize, DataTypes);
const ManagerScope = ManagerScopeModel(sequelize, DataTypes);
const LoginAuditLog = LoginAuditLogFactory(sequelize, DataTypes);
const AuditLog = AuditLogFactory(sequelize, DataTypes);

const TechnicianDailyMetric = TechnicianDailyMetricFactory(sequelize, DataTypes);
const TechnicianScoreSnapshot = TechnicianScoreSnapshotFactory(sequelize, DataTypes);
const ShiftDailyMetric = ShiftDailyMetricFactory(sequelize, DataTypes);
const TroubleshootingEvent = TroubleshootingEventFactory(sequelize, DataTypes);
const QualityEvent = QualityEventFactory(sequelize, DataTypes);
const TechnicianPresenceDaily = TechnicianPresenceDailyFactory(sequelize, DataTypes);
const StaffDailyMetric = defineStaffDailyMetric(sequelize, DataTypes);

/* ─────────────────────────────────────────────
 * Model registry
 * ───────────────────────────────────────────── */
const models = {
  sequelize,
  User,
  StaffProfile,
  MonthlyReview,
  Goal,
  SkuExposure,
  Meeting,
  ReviewChange,
  ReviewAssignment,
  ReviewChangeLog,
  Incident,
  Training,
  EsdCheck,
  Attendance,
  RackAssignment,
  RosterEntry,
  StaffAlias,
  ManagerScope,
  RackAssignmentEvent,
  LoginAuditLog,
  AuditLog,
  TechnicianDailyMetric,
  TechnicianScoreSnapshot,
  ShiftDailyMetric,
  TroubleshootingEvent,
  QualityEvent,
  TechnicianPresenceDaily,
  StaffDailyMetric,
  TrainingAssignment,
};

/* ─────────────────────────────────────────────
 * Direct associations
 * ───────────────────────────────────────────── */
User.hasMany(ManagerScope, { foreignKey: 'userId', as: 'ManagerScopes' });
User.hasMany(LoginAuditLog, { foreignKey: 'userId', as: 'LoginAuditLogs' });

/* ─────────────────────────────────────────────
 * Model-defined associations
 * Pass the full registry once to each model.
 * ───────────────────────────────────────────── */
for (const model of Object.values(models)) {
  if (model && typeof model.associate === 'function') {
    model.associate(models);
  }
}

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
async function tableExists(tableName) {
  try {
    await sequelize.query(`SELECT 1 FROM ${tableName} LIMIT 1;`);
    return true;
  } catch {
    return false;
  }
}

async function dropIndexIfExists(indexName) {
  if (!indexName) return;
  const safe = `"${String(indexName).replace(/"/g, '""')}"`;

  try {
    await sequelize.query(`DROP INDEX IF EXISTS ${safe};`);
  } catch {
    // ignore
  }
}

async function dropIndexesByPrefix(prefix) {
  const p = String(prefix).replace(/'/g, "''");
  const [rows] = await sequelize.query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name LIKE '${p}%'
      AND name NOT LIKE 'sqlite_autoindex_%';
  `);

  for (const r of rows || []) {
    if (r?.name) {
      console.warn(`DB REPAIR → Dropping index by prefix: ${r.name}`);
      await dropIndexIfExists(r.name);
    }
  }
}

async function dropUniqueIndexByColumns(tableName, colNames) {
  try {
    const [indexes] = await sequelize.query(`PRAGMA index_list('${tableName}');`);
    const uniqueIndexes = (indexes || []).filter((ix) => ix && ix.unique);

    for (const ix of uniqueIndexes) {
      const idxName = ix.name;
      if (!idxName) continue;

      const [cols] = await sequelize.query(`PRAGMA index_info('${idxName}');`);
      const names = (cols || []).map((c) => c && c.name).filter(Boolean);

      const same =
        names.length === colNames.length &&
        names.every((n, i) => n === colNames[i]);

      if (same) {
        console.warn(
          `DB REPAIR → Dropping legacy UNIQUE index ${idxName} on ${tableName}(${names.join(',')})`
        );
        await dropIndexIfExists(idxName);
      }
    }
  } catch {
    // ignore
  }
}

async function dropAllIndexesForTable(tableName) {
  const tn = String(tableName).replace(/'/g, "''");
  const [rows] = await sequelize.query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name = '${tn}'
      AND name NOT LIKE 'sqlite_autoindex_%';
  `);

  for (const r of rows || []) {
    if (r?.name) {
      console.warn(`DB REPAIR → Dropping index ${r.name} on ${tableName}`);
      await dropIndexIfExists(r.name);
    }
  }
}

/* ─────────────────────────────────────────────
 * ManagerScope safe rebuild
 * ───────────────────────────────────────────── */
async function rebuildManagerScopesSafely() {
  const table = 'manager_scopes';

  if (!(await tableExists(table))) {
    await ManagerScope.sync();
    return;
  }

  console.warn('DB REPAIR → Rebuilding manager_scopes safely (bypassing alter)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE ${table} RENAME TO ${oldTable};`);

  await dropIndexIfExists('uniq_manager_scope_user_building');
  await dropIndexIfExists('uniq_manager_scope_user_building_shift');
  await dropIndexIfExists('idx_manager_scope_userId');
  await dropIndexIfExists('idx_manager_scope_building');
  await dropIndexIfExists('idx_manager_scope_shift');

  await ManagerScope.sync({ force: true });

  await sequelize.query(`
    INSERT OR REPLACE INTO ${table} (id, userId, building, shift, createdAt, updatedAt)
    SELECT
      id,
      userId,
      building,
      shift,
      createdAt,
      updatedAt
    FROM ${oldTable}
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          userId,
          building,
          shift,
          ROW_NUMBER() OVER (
            PARTITION BY userId, building, shift
            ORDER BY datetime(updatedAt) DESC, datetime(createdAt) DESC, id DESC
          ) AS rn
        FROM ${oldTable}
        WHERE userId IS NOT NULL
          AND building IS NOT NULL
          AND shift IS NOT NULL
      )
      WHERE rn = 1
    );
  `);

  await sequelize.query(`DROP TABLE ${oldTable};`);
  console.warn('DB REPAIR → manager_scopes rebuild complete.');
}

/* ─────────────────────────────────────────────
 * MonthlyReviews + ReviewChanges + ReviewChangeLogs rebuild
 * ───────────────────────────────────────────── */
async function rebuildReviewClusterSafely() {
  const reviewsTable = 'MonthlyReviews';
  const changesTable = 'ReviewChanges';
  const logsTable = 'ReviewChangeLogs';

  const hasReviews = await tableExists(reviewsTable);
  const hasChanges = await tableExists(changesTable);
  const hasLogs = await tableExists(logsTable);

  if (!hasReviews && !hasChanges && !hasLogs) {
    await MonthlyReview.sync();
    await ReviewChange.sync();
    await ReviewChangeLog.sync();
    return;
  }

  console.warn('DB REPAIR → Rebuilding MonthlyReviews + ReviewChanges + ReviewChangeLogs safely...');

  const reviewsOld = `${reviewsTable}_old_${Date.now()}`;
  const changesOld = `${changesTable}_old_${Date.now()}`;
  const logsOld = `${logsTable}_old_${Date.now()}`;

  if (hasLogs) await sequelize.query(`ALTER TABLE ${logsTable} RENAME TO ${logsOld};`);
  if (hasChanges) await sequelize.query(`ALTER TABLE ${changesTable} RENAME TO ${changesOld};`);
  if (hasReviews) await sequelize.query(`ALTER TABLE ${reviewsTable} RENAME TO ${reviewsOld};`);

  // Drop all known MonthlyReviews indexes before sync({ force: true }).
  // sync({ force: true }) issues DROP TABLE IF EXISTS + CREATE TABLE which
  // removes the table but SQLite can leave orphaned index entries in
  // sqlite_master. Explicitly dropping them first matches the pattern used by
  // rebuildManagerScopesSafely() and rebuildRackAssignmentEventsSafely().
  await dropIndexIfExists('uniq_monthly_review_staff_submitter_period');
  await dropIndexIfExists('idx_monthly_review_staff');
  await dropIndexIfExists('idx_monthly_review_submitter');
  await dropIndexIfExists('idx_monthly_review_period');
  // Sweep any stale indexes left by a previous partial run.
  await dropIndexesByPrefix('monthly_reviews_');

  await MonthlyReview.sync({ force: true });
  await ReviewChange.sync({ force: true });
  await ReviewChangeLog.sync({ force: true });

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ReviewIdMap (
      oldId INTEGER,
      staffId INTEGER,
      submitterId INTEGER,
      periodMonth INTEGER,
      periodYear INTEGER,
      createdAt TEXT,
      newId INTEGER,
      PRIMARY KEY (newId)
    );
  `);
  await sequelize.query(`DELETE FROM ReviewIdMap;`);

  // Build the id-mapping table.  Only ONE row per unique key group is kept —
  // the one with the most-recent updatedAt (then createdAt, then highest id).
  // This deduplication step prevents the unique constraint on MonthlyReviews
  // from being violated when the old table contained duplicate reviews.
  await sequelize.query(`
    INSERT INTO ReviewIdMap (oldId, staffId, submitterId, periodMonth, periodYear, createdAt, newId)
    SELECT
      sub.id          AS oldId,
      sub.staffId,
      sub.submitterId,
      sub.periodMonth,
      sub.periodYear,
      sub.createdAt,
      ROW_NUMBER() OVER (
        ORDER BY datetime(sub.updatedAt) DESC,
                 datetime(sub.createdAt) DESC,
                 COALESCE(sub.id, 0) DESC,
                 sub.rowid DESC
      ) AS newId
    FROM ${reviewsOld} sub
    WHERE sub.rowid IN (
      -- For every unique key group, pick the row with the most-recent
      -- updatedAt.  Ties broken by createdAt, then id, then rowid.
      SELECT keep.rowid
      FROM ${reviewsOld} keep
      WHERE keep.rowid = (
        SELECT winner.rowid
        FROM   ${reviewsOld} winner
        WHERE  ((winner.staffId     = keep.staffId)     OR (winner.staffId     IS NULL AND keep.staffId     IS NULL))
          AND  ((winner.submitterId = keep.submitterId) OR (winner.submitterId IS NULL AND keep.submitterId IS NULL))
          AND  winner.periodMonth = keep.periodMonth
          AND  winner.periodYear  = keep.periodYear
        ORDER BY datetime(winner.updatedAt) DESC,
                 datetime(winner.createdAt) DESC,
                 COALESCE(winner.id, 0) DESC,
                 winner.rowid DESC
        LIMIT 1
      )
    );
  `);

  await sequelize.query(`
    INSERT INTO ${reviewsTable} (
      id, periodMonth, periodYear,
      technicalCompetence, materialHandling, timeManagement, repair, accountability, troubleshooting,
      initiative, culturalFit, communicationSkills, teamwork,
      positiveAttitude, proactive, integrity,
      accountability2, problemSolving, efficiency,
      resultsOrientation, communication, continuousImprovement,
      teamwork2, collaboration, buildTrust,
      decisionMakingWithRisk, enableTheTeam, hireDevelopManage,
      positiveAttitudeComment, proactiveComment, integrityComment,
      accountability2Comment, problemSolvingComment, efficiencyComment,
      resultsOrientationComment, communicationComment, continuousImprovementComment,
      teamwork2Comment, collaborationComment, buildTrustComment,
      decisionMakingWithRiskComment, enableTheTeamComment, hireDevelopManageComment,
      bucketPeopleAvg, bucketOwnershipAvg, bucketQualityAvg, bucketPartnershipAvg, bucketLeadingAvg, overallBucketAvg,
      positionTypeSnapshot,
      comment, createdAt, updatedAt,
      submitterId, staffId
    )
    SELECT
      m.newId AS id,
      r.periodMonth, r.periodYear,
      r.technicalCompetence, r.materialHandling, r.timeManagement, r.repair, r.accountability, r.troubleshooting,
      r.initiative, r.culturalFit, r.communicationSkills, r.teamwork,
      r.positiveAttitude, r.proactive, r.integrity,
      r.accountability2, r.problemSolving, r.efficiency,
      r.resultsOrientation, r.communication, r.continuousImprovement,
      r.teamwork2, r.collaboration, r.buildTrust,
      r.decisionMakingWithRisk, r.enableTheTeam, r.hireDevelopManage,
      r.positiveAttitudeComment, r.proactiveComment, r.integrityComment,
      r.accountability2Comment, r.problemSolvingComment, r.efficiencyComment,
      r.resultsOrientationComment, r.communicationComment, r.continuousImprovementComment,
      r.teamwork2Comment, r.collaborationComment, r.buildTrustComment,
      r.decisionMakingWithRiskComment, r.enableTheTeamComment, r.hireDevelopManageComment,
      r.bucketPeopleAvg, r.bucketOwnershipAvg, r.bucketQualityAvg, r.bucketPartnershipAvg, r.bucketLeadingAvg, r.overallBucketAvg,
      r.positionTypeSnapshot,
      r.comment, r.createdAt, r.updatedAt,
      r.submitterId, r.staffId
    FROM ${reviewsOld} r
    JOIN ReviewIdMap m
      ON m.oldId = r.id
     AND ((m.staffId = r.staffId) OR (m.staffId IS NULL AND r.staffId IS NULL))
     AND ((m.submitterId = r.submitterId) OR (m.submitterId IS NULL AND r.submitterId IS NULL))
     AND m.periodMonth = r.periodMonth
     AND m.periodYear = r.periodYear
     AND m.createdAt = r.createdAt;
  `);

  if (hasChanges) {
    await sequelize.query(`
      INSERT INTO ${changesTable} (id, changeType, description, diffJson, createdAt, updatedAt, reviewId, changedById)
      SELECT
        c.id, c.changeType, c.description, c.diffJson, c.createdAt, c.updatedAt,
        (SELECT MAX(m.newId) FROM ReviewIdMap m WHERE m.oldId = c.reviewId) AS reviewId,
        c.changedById
      FROM ${changesOld} c
      WHERE c.reviewId IS NOT NULL;
    `);
  }

  if (hasLogs) {
    await sequelize.query(`
      INSERT INTO ${logsTable} (id, field, oldValue, newValue, changedAt, createdAt, updatedAt, reviewId, changedById)
      SELECT
        l.id, l.field, l.oldValue, l.newValue, l.changedAt, l.createdAt, l.updatedAt,
        (SELECT MAX(m.newId) FROM ReviewIdMap m WHERE m.oldId = l.reviewId) AS reviewId,
        l.changedById
      FROM ${logsOld} l
      WHERE l.reviewId IS NOT NULL;
    `);
  }

  if (hasLogs) await sequelize.query(`DROP TABLE ${logsOld};`);
  if (hasChanges) await sequelize.query(`DROP TABLE ${changesOld};`);
  if (hasReviews) await sequelize.query(`DROP TABLE ${reviewsOld};`);
  await sequelize.query(`DROP TABLE IF EXISTS ReviewIdMap;`);

  console.warn('DB REPAIR → Review cluster rebuild complete.');
}

/* ─────────────────────────────────────────────
 * ShiftDailyMetric safe rebuild — fix individual UNIQUE constraints
 * ───────────────────────────────────────────── */
async function rebuildShiftDailyMetricSafely() {
  const table = 'shift_daily_metrics';

  if (!(await tableExists(table))) {
    await ShiftDailyMetric.sync();
    return;
  }

  // Check if the table has a bad individual UNIQUE constraint on productFamily
  const [indexes] = await sequelize.query(`PRAGMA index_list('${table}');`);
  const hasBadIndex = indexes.some(
    (idx) => idx.unique === 1 && /productfamily/i.test(idx.name) && !/uniq_shift_daily_metric_scope/.test(idx.name)
  );
  // Also check for sqlite_autoindex_ that indicates column-level unique
  const hasBadAutoIndex = indexes.some(
    (idx) => idx.unique === 1 && /sqlite_autoindex_/.test(idx.name)
  );

  if (!hasBadIndex && !hasBadAutoIndex) return; // schema is fine

  console.warn('DB REPAIR → Rebuilding shift_daily_metrics safely (fixing UNIQUE constraints)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE ${table} RENAME TO \`${oldTable}\`;`);

  await dropIndexesByPrefix('shift_daily_metrics_');
  await dropIndexIfExists('uniq_shift_daily_metric_scope');
  await dropIndexIfExists('idx_sdm_metricDate');
  await dropIndexIfExists('idx_sdm_building_shift');
  await dropIndexIfExists('idx_sdm_area');
  await dropAllIndexesForTable(oldTable);

  await ShiftDailyMetric.sync({ force: true });

  await sequelize.query(`
    INSERT OR IGNORE INTO \`${table}\`
      (id, metricDate, building, shift, area, productFamily, testStage,
       activeTechnicians, serversCompleted, racksCompleted,
       firstTimeFixRate, repairSuccessRate, averageMttrMinutes, qualityEscapeRate,
       totalEscapes, totalRepairs, totalReruns,
       topFailureSymptomsJson, manualResetSummaryJson, notes,
       createdAt, updatedAt)
    SELECT
      id, metricDate, building, shift, area, productFamily, testStage,
      activeTechnicians, serversCompleted, racksCompleted,
      firstTimeFixRate, repairSuccessRate, averageMttrMinutes, qualityEscapeRate,
      totalEscapes, totalRepairs, totalReruns,
      topFailureSymptomsJson, manualResetSummaryJson, notes,
      createdAt, updatedAt
    FROM \`${oldTable}\`;
  `);

  await sequelize.query(`DROP TABLE \`${oldTable}\`;`);
  console.warn('DB REPAIR → shift_daily_metrics rebuild complete.');
}

/* ─────────────────────────────────────────────
 * TechnicianPresenceDaily safe rebuild — fix individual UNIQUE on userId
 * ───────────────────────────────────────────── */
async function rebuildTechnicianPresenceDailySafely() {
  const table = 'technician_presence_daily';

  if (!(await tableExists(table))) {
    await TechnicianPresenceDaily.sync();
    return;
  }

  // Check for bad sqlite_autoindex_ that indicates column-level unique on userId
  const [indexes] = await sequelize.query(`PRAGMA index_list('${table}');`);
  const hasBadAutoIndex = indexes.some(
    (idx) => idx.unique === 1 && /sqlite_autoindex_/.test(idx.name)
  );

  if (!hasBadAutoIndex) return; // schema is fine

  console.warn('DB REPAIR → Rebuilding technician_presence_daily safely (fixing UNIQUE constraints)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE \`${table}\` RENAME TO \`${oldTable}\`;`);

  await dropIndexesByPrefix('technician_presence_daily_');
  await dropIndexIfExists('uniq_technician_presence_daily');
  await dropIndexIfExists('idx_tpd_presenceDate');
  await dropIndexIfExists('idx_tpd_building_shift');
  await dropIndexIfExists('idx_tpd_wasActiveTechnician');
  await dropAllIndexesForTable(oldTable);

  await TechnicianPresenceDaily.sync({ force: true });

  await sequelize.query(`
    INSERT OR IGNORE INTO \`${table}\`
      (id, userId, employeeId, presenceDate, building, shift, area,
       wasScheduled, wasPresent, wasActiveTechnician, wasLate,
       minutesLate, esdPassed, certificationsReady,
       assignmentStatus, notes, createdAt, updatedAt)
    SELECT
      id, userId, employeeId, presenceDate, building, shift, area,
      wasScheduled, wasPresent, wasActiveTechnician, wasLate,
      minutesLate, esdPassed, certificationsReady,
      assignmentStatus, notes, createdAt, updatedAt
    FROM \`${oldTable}\`;
  `);

  await sequelize.query(`DROP TABLE \`${oldTable}\`;`);
  console.warn('DB REPAIR → technician_presence_daily rebuild complete.');
}

/* ─────────────────────────────────────────────
 * TechnicianScoreSnapshot safe rebuild — fix individual UNIQUE constraints
 * ───────────────────────────────────────────── */
async function rebuildTechnicianScoreSnapshotSafely() {
  const table = 'technician_score_snapshots';

  if (!(await tableExists(table))) {
    await TechnicianScoreSnapshot.sync();
    return;
  }

  const [indexes] = await sequelize.query(`PRAGMA index_list('${table}');`);
  const hasBadAutoIndex = indexes.some(
    (idx) => idx.unique === 1 && /sqlite_autoindex_/.test(idx.name)
  );

  if (!hasBadAutoIndex) return;

  console.warn('DB REPAIR → Rebuilding technician_score_snapshots safely (fixing UNIQUE constraints)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE \`${table}\` RENAME TO \`${oldTable}\`;`);

  await dropIndexesByPrefix('technician_score_snapshots_');
  await dropIndexIfExists('uniq_tech_score_snapshot_scope');
  await dropIndexIfExists('idx_tss_snapshotDate');
  await dropIndexIfExists('idx_tss_userId');
  await dropIndexIfExists('idx_tss_overallScore');
  await dropIndexIfExists('idx_tss_building_shift');
  await dropAllIndexesForTable(oldTable);

  await TechnicianScoreSnapshot.sync({ force: true });

  await sequelize.query(`
    INSERT OR IGNORE INTO \`${table}\`
      (id, userId, employeeId, snapshotDate, windowType,
       building, shift, area, productFamily, testStage,
       productivityScore, troubleshootingScore, qualityScore, complianceScore, developmentScore,
       overallScore, scoreBand, rawMetricsJson, scoreBreakdownJson,
       minimumSampleMet, calculationVersion, createdAt, updatedAt)
    SELECT
      id, userId, employeeId, snapshotDate, windowType,
      building, shift, area, productFamily, testStage,
      productivityScore, troubleshootingScore, qualityScore, complianceScore, developmentScore,
      overallScore, scoreBand, rawMetricsJson, scoreBreakdownJson,
      minimumSampleMet, calculationVersion, createdAt, updatedAt
    FROM \`${oldTable}\`;
  `);

  await sequelize.query(`DROP TABLE \`${oldTable}\`;`);
  console.warn('DB REPAIR → technician_score_snapshots rebuild complete.');
}

/* ─────────────────────────────────────────────
 * RackAssignmentEvents safe rebuild
 * ───────────────────────────────────────────── */
async function rebuildRackAssignmentEventsSafely() {
  const table = 'RackAssignmentEvents';

  if (!(await tableExists(table))) {
    await RackAssignmentEvent.sync();
    return;
  }

  console.warn('DB REPAIR → Rebuilding RackAssignmentEvents safely (bypassing alter)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE ${table} RENAME TO ${oldTable};`);

  await dropIndexesByPrefix('rack_assignment_events_');
  await dropIndexIfExists('uniq_staff_day_serial_type');
  await dropIndexIfExists('idx_rae_staff_day');
  await dropIndexIfExists('idx_rae_customer_model');
  await dropIndexIfExists('idx_rae_serial');

  await dropAllIndexesForTable(oldTable);
  await dropUniqueIndexByColumns(oldTable, ['type']);

  await RackAssignmentEvent.sync({ force: true });

  await sequelize.query(`
    INSERT OR IGNORE INTO ${table}
      (id, staffId, building, customer, assignmentTime, assignmentDate, assigneeAtTime, model, serialNumber, type, sourceFile, createdAt, updatedAt)
    SELECT
      id, staffId, building, customer, assignmentTime, assignmentDate, assigneeAtTime, model, serialNumber, type, sourceFile, createdAt, updatedAt
    FROM ${oldTable};
  `);

  await sequelize.query(`DROP TABLE ${oldTable};`);
  console.warn('DB REPAIR → RackAssignmentEvents rebuild complete.');
}

/* ─────────────────────────────────────────────
 * StaffDailyMetric safe rebuild — fix individual UNIQUE constraints
 * ───────────────────────────────────────────── */
async function rebuildStaffDailyMetricSafely() {
  const table = 'StaffDailyMetrics';

  if (!(await tableExists(table))) {
    await StaffDailyMetric.sync();
    return;
  }

  const [indexes] = await sequelize.query(`PRAGMA index_list('${table}');`);
  const hasBadAutoIndex = indexes.some(
    (idx) => idx.unique === 1 && /sqlite_autoindex_/.test(idx.name)
  );

  if (!hasBadAutoIndex) return;

  console.warn('DB REPAIR → Rebuilding StaffDailyMetrics safely (fixing UNIQUE constraints)...');

  const oldTable = `${table}_old_${Date.now()}`;
  await sequelize.query(`ALTER TABLE \`${table}\` RENAME TO \`${oldTable}\`;`);
  await dropAllIndexesForTable(oldTable);

  await StaffDailyMetric.sync({ force: true });

  // Copy only the latest row per (staffId, metricDate, shift)
  await sequelize.query(`
    INSERT OR IGNORE INTO \`${table}\`
    SELECT * FROM \`${oldTable}\`
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY staffId, metricDate, shift
                 ORDER BY datetime(updatedAt) DESC, id DESC
               ) AS rn
        FROM \`${oldTable}\`
      )
      WHERE rn = 1
    );
  `);

  await sequelize.query(`DROP TABLE \`${oldTable}\`;`);
  console.warn('DB REPAIR → StaffDailyMetrics rebuild complete.');
}

/* ─────────────────────────────────────────────
 * TechnicianDailyMetric dedup — remove duplicates keeping latest per (userId, metricDate)
 * ───────────────────────────────────────────── */
async function dedupTechnicianDailyMetrics() {
  if (!(await tableExists('technician_daily_metrics'))) return;

  const [dupes] = await sequelize.query(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT userId, metricDate, COUNT(*) AS n
      FROM technician_daily_metrics
      GROUP BY userId, metricDate
      HAVING n > 1
    );
  `);

  const dupCount = dupes[0]?.cnt || 0;
  if (dupCount === 0) return;

  console.warn(`DB REPAIR → Deduplicating technician_daily_metrics (${dupCount} userId+date groups have duplicates)...`);

  // Delete all but the most-recently-updated row per (userId, metricDate)
  await sequelize.query(`
    DELETE FROM technician_daily_metrics
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY userId, metricDate
                 ORDER BY datetime(updatedAt) DESC, id DESC
               ) AS rn
        FROM technician_daily_metrics
      )
      WHERE rn = 1
    );
  `);

  console.warn('DB REPAIR → technician_daily_metrics dedup complete.');
}

/* ─────────────────────────────────────────────
 * initDb
 * ───────────────────────────────────────────── */
export async function initDb() {
  console.log('DB DEBUG → using sqlite; starting per-model sync');
  await sequelize.authenticate();
  console.log('DB DEBUG → DB connected');

  await sequelize.query('PRAGMA foreign_keys = OFF;');

  try {
    await User.sync({ alter: false });
    await StaffProfile.sync({ alter: false });
    await StaffAlias.sync({ alter: false });
    await RosterEntry.sync({ alter: false });

    await rebuildManagerScopesSafely();
    await rebuildReviewClusterSafely();

    await Goal.sync({ alter: false });
    // Manual migration: add Goal.type column if missing
    try {
      await sequelize.queryInterface.addColumn('Goals', 'type', {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'DEVELOPMENT',
      });
    } catch (_) { /* column already exists */ }
    await GoalCheckIn.sync({ alter: false });
    await SkuExposure.sync({ alter: false });
    await ExposureAggregate.sync({ alter: false });
    await Meeting.sync({ alter: false });
    // Manual migration: add Meeting.focus and Meeting.tone columns if missing
    try {
      await sequelize.queryInterface.addColumn('Meetings', 'focus', {
        type: DataTypes.STRING,
        allowNull: true,
      });
    } catch (_) { /* column already exists */ }
    try {
      await sequelize.queryInterface.addColumn('Meetings', 'tone', {
        type: DataTypes.STRING,
        allowNull: true,
      });
    } catch (_) { /* column already exists */ }
    await ReviewAssignment.sync({ alter: false });
    await Incident.sync({ alter: false });
    await Training.sync({ alter: false });
    await TrainingAssignment.sync({ alter: false });
    await EsdCheck.sync({ alter: false });
    await Attendance.sync({ alter: false });
    await RackAssignment.sync({ alter: false });
    await LoginAuditLog.sync({ alter: false });
    await AuditLog.sync({ alter: false });
    await TechnicianDailyMetric.sync({ alter: false });
    await dedupTechnicianDailyMetrics();
    await rebuildTechnicianScoreSnapshotSafely();
    await rebuildShiftDailyMetricSafely();
    await TroubleshootingEvent.sync({ alter: false });
    await QualityEvent.sync({ alter: false });
    await rebuildTechnicianPresenceDailySafely();
    await rebuildStaffDailyMetricSafely();

    await rebuildRackAssignmentEventsSafely();
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON;');

    try {
      const [fkCheck] = await sequelize.query('PRAGMA foreign_key_check;');
      if (fkCheck?.length) {
        console.warn('DB WARNING → foreign_key_check found issues:', fkCheck);
      }
    } catch {
      // ignore
    }
  }

  console.log('DB DEBUG → per-model sync complete');
}

/* ─────────────────────────────────────────────
 * Exports
 * ───────────────────────────────────────────── */
export {
  sequelize,
  User,
  StaffProfile,
  MonthlyReview,
  Goal,
  GoalCheckIn,
  SkuExposure,
  Meeting,
  ReviewChange,
  ReviewAssignment,
  ReviewChangeLog,
  Incident,
  Training,
  EsdCheck,
  Attendance,
  RackAssignment,
  RosterEntry,
  StaffAlias,
  ManagerScope,
  RackAssignmentEvent,
  LoginAuditLog,
  AuditLog,
  TechnicianDailyMetric,
  TechnicianScoreSnapshot,
  ShiftDailyMetric,
  TroubleshootingEvent,
  QualityEvent,
  TechnicianPresenceDaily,
  StaffDailyMetric,
  ExposureAggregate,
  TrainingAssignment,
};