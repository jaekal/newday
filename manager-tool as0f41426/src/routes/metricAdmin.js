// src/routes/metricAdmin.js
import express from 'express';
import {
  rebuildShiftDailyMetricsForDate,
  rebuildTechnicianScoreSnapshotsForDate,
  rebuildDailyDashboardArtifacts,
  processDailyMetricsPipeline,
} from '../services/metricAggregationService.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
function norm(v) {
  return String(v ?? '').trim();
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function toDateOnly(value) {
  const raw = norm(value);
  if (isDateOnly(raw)) return raw;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return d.toISOString().slice(0, 10);
}

function enumerateDates(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date range.');
  }
  if (end < start) {
    throw new Error('End date must be on or after start date.');
  }

  const dates = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildDefaultPageModel(extra = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    pageTitle: 'Metric Administration',
    today,
    summary: null,
    error: null,
    ...extra,
  };
}

/* ─────────────────────────────────────────────
 * GET /metrics/admin
 * ───────────────────────────────────────────── */
router.get('/admin', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  return res.render('metrics/admin', buildDefaultPageModel());
});

/* ─────────────────────────────────────────────
 * POST /metrics/admin/rebuild-day
 * Rebuild shift metrics + score snapshots for one date
 * ───────────────────────────────────────────── */
router.post('/admin/rebuild-day', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  try {
    const date = toDateOnly(req.body.date);

    const result = await rebuildDailyDashboardArtifacts(date, {
      calculationVersion: norm(req.body.calculationVersion || 'v1'),
    });

    const summaryLines = [
      `Daily dashboard rebuild complete for ${date}`,
      '',
      `Shift rows source: ${result.shiftSummary.sourceRows}`,
      `Shift grouped rows: ${result.shiftSummary.groupedRows}`,
      `Shift created: ${result.shiftSummary.created}`,
      `Shift updated: ${result.shiftSummary.updated}`,
      '',
      `Score source rows: ${result.scoreSummary.sourceRows}`,
      `Score created: ${result.scoreSummary.created}`,
      `Score updated: ${result.scoreSummary.updated}`,
      `Score skipped: ${result.scoreSummary.skipped}`,
    ];

    if (Array.isArray(result.scoreSummary.issues) && result.scoreSummary.issues.length) {
      summaryLines.push('', 'Top score issues:');
      result.scoreSummary.issues.slice(0, 8).forEach((x) => summaryLines.push(`- ${x}`));
      if (result.scoreSummary.issues.length > 8) {
        summaryLines.push(`...and ${result.scoreSummary.issues.length - 8} more`);
      }
    }

    return res.render(
      'metrics/admin',
      buildDefaultPageModel({
        summary: summaryLines.join('\n'),
      })
    );
  } catch (err) {
    return res.status(400).render(
      'metrics/admin',
      buildDefaultPageModel({
        error: `Rebuild failed: ${err.message}`,
      })
    );
  }
});

/* ─────────────────────────────────────────────
 * POST /metrics/admin/rebuild-range
 * Rebuild multiple dates
 * ───────────────────────────────────────────── */
router.post('/admin/rebuild-range', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  try {
    const startDate = toDateOnly(req.body.startDate);
    const endDate = toDateOnly(req.body.endDate);
    const dates = enumerateDates(startDate, endDate);

    let totalShiftCreated = 0;
    let totalShiftUpdated = 0;
    let totalScoreCreated = 0;
    let totalScoreUpdated = 0;
    let totalScoreSkipped = 0;
    const issues = [];

    for (const date of dates) {
      const result = await rebuildDailyDashboardArtifacts(date, {
        calculationVersion: norm(req.body.calculationVersion || 'v1'),
      });

      totalShiftCreated += result.shiftSummary.created;
      totalShiftUpdated += result.shiftSummary.updated;
      totalScoreCreated += result.scoreSummary.created;
      totalScoreUpdated += result.scoreSummary.updated;
      totalScoreSkipped += result.scoreSummary.skipped;

      if (Array.isArray(result.scoreSummary.issues) && result.scoreSummary.issues.length) {
        result.scoreSummary.issues.forEach((issue) => {
          issues.push(`[${date}] ${issue}`);
        });
      }
    }

    const summaryLines = [
      `Range rebuild complete: ${startDate} → ${endDate}`,
      `Dates processed: ${dates.length}`,
      '',
      `Shift created: ${totalShiftCreated}`,
      `Shift updated: ${totalShiftUpdated}`,
      '',
      `Score created: ${totalScoreCreated}`,
      `Score updated: ${totalScoreUpdated}`,
      `Score skipped: ${totalScoreSkipped}`,
    ];

    if (issues.length) {
      summaryLines.push('', 'Top issues:');
      issues.slice(0, 10).forEach((x) => summaryLines.push(`- ${x}`));
      if (issues.length > 10) {
        summaryLines.push(`...and ${issues.length - 10} more`);
      }
    }

    return res.render(
      'metrics/admin',
      buildDefaultPageModel({
        summary: summaryLines.join('\n'),
      })
    );
  } catch (err) {
    return res.status(400).render(
      'metrics/admin',
      buildDefaultPageModel({
        error: `Range rebuild failed: ${err.message}`,
      })
    );
  }
});

/* ─────────────────────────────────────────────
 * POST /metrics/admin/process-day
 * Accepts JSON payload text pasted into a textarea
 * for technicianMetricRows + presenceRows
 * Useful before a full import UI exists
 * ───────────────────────────────────────────── */
router.post('/admin/process-day', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  try {
    const date = toDateOnly(req.body.date);

    const technicianMetricRows = safeJsonParse(req.body.technicianMetricRowsJson, []);
    const presenceRows = safeJsonParse(req.body.presenceRowsJson, []);

    if (!Array.isArray(technicianMetricRows)) {
      throw new Error('technicianMetricRowsJson must parse to an array.');
    }
    if (!Array.isArray(presenceRows)) {
      throw new Error('presenceRowsJson must parse to an array.');
    }

    const result = await processDailyMetricsPipeline({
      date,
      technicianMetricRows,
      presenceRows,
      scoreOptions: {
        calculationVersion: norm(req.body.calculationVersion || 'v1'),
      },
    });

    const summaryLines = [
      `Daily processing pipeline complete for ${date}`,
      '',
      `Metric rows created: ${result.metricUpsert.created}`,
      `Metric rows updated: ${result.metricUpsert.updated}`,
      `Metric rows skipped: ${result.metricUpsert.skipped}`,
      '',
      `Presence rows created: ${result.presenceUpsert.created}`,
      `Presence rows updated: ${result.presenceUpsert.updated}`,
      `Presence rows skipped: ${result.presenceUpsert.skipped}`,
      '',
      `Shift created: ${result.rebuildSummary.shiftSummary.created}`,
      `Shift updated: ${result.rebuildSummary.shiftSummary.updated}`,
      '',
      `Score created: ${result.rebuildSummary.scoreSummary.created}`,
      `Score updated: ${result.rebuildSummary.scoreSummary.updated}`,
      `Score skipped: ${result.rebuildSummary.scoreSummary.skipped}`,
    ];

    const allIssues = [
      ...(result.metricUpsert.issues || []),
      ...(result.presenceUpsert.issues || []),
      ...(result.rebuildSummary.scoreSummary.issues || []),
    ];

    if (allIssues.length) {
      summaryLines.push('', 'Top issues:');
      allIssues.slice(0, 10).forEach((x) => summaryLines.push(`- ${x}`));
      if (allIssues.length > 10) {
        summaryLines.push(`...and ${allIssues.length - 10} more`);
      }
    }

    return res.render(
      'metrics/admin',
      buildDefaultPageModel({
        summary: summaryLines.join('\n'),
      })
    );
  } catch (err) {
    return res.status(400).render(
      'metrics/admin',
      buildDefaultPageModel({
        error: `Daily processing failed: ${err.message}`,
      })
    );
  }
});

/* ─────────────────────────────────────────────
 * POST /metrics/admin/rebuild-shift-only
 * ───────────────────────────────────────────── */
router.post('/admin/rebuild-shift-only', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  try {
    const date = toDateOnly(req.body.date);

    const result = await rebuildShiftDailyMetricsForDate(date);

    const summaryLines = [
      `Shift metric rebuild complete for ${date}`,
      `Source rows: ${result.sourceRows}`,
      `Grouped rows: ${result.groupedRows}`,
      `Created: ${result.created}`,
      `Updated: ${result.updated}`,
    ];

    return res.render(
      'metrics/admin',
      buildDefaultPageModel({
        summary: summaryLines.join('\n'),
      })
    );
  } catch (err) {
    return res.status(400).render(
      'metrics/admin',
      buildDefaultPageModel({
        error: `Shift rebuild failed: ${err.message}`,
      })
    );
  }
});

/* ─────────────────────────────────────────────
 * POST /metrics/admin/rebuild-score-only
 * ───────────────────────────────────────────── */
router.post('/admin/rebuild-score-only', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER']), async (req, res) => {
  try {
    const date = toDateOnly(req.body.date);

    const result = await rebuildTechnicianScoreSnapshotsForDate(date, {
      calculationVersion: norm(req.body.calculationVersion || 'v1'),
    });

    const summaryLines = [
      `Score snapshot rebuild complete for ${date}`,
      `Source rows: ${result.sourceRows}`,
      `Created: ${result.created}`,
      `Updated: ${result.updated}`,
      `Skipped: ${result.skipped}`,
    ];

    if (Array.isArray(result.issues) && result.issues.length) {
      summaryLines.push('', 'Top issues:');
      result.issues.slice(0, 10).forEach((x) => summaryLines.push(`- ${x}`));
      if (result.issues.length > 10) {
        summaryLines.push(`...and ${result.issues.length - 10} more`);
      }
    }

    return res.render(
      'metrics/admin',
      buildDefaultPageModel({
        summary: summaryLines.join('\n'),
      })
    );
  } catch (err) {
    return res.status(400).render(
      'metrics/admin',
      buildDefaultPageModel({
        error: `Score rebuild failed: ${err.message}`,
      })
    );
  }
});

export default router;