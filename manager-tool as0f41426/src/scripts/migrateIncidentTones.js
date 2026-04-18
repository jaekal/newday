// src/scripts/migrateIncidentTones.js
//
// One-time migration script for Incidents:
// - backfills severity if missing/blank
// - normalizes old tone values to the new tone taxonomy
// - nudges invalid type/tone combos into valid ones
//
// Usage examples:
//   node src/scripts/migrateIncidentTones.js
//   node --env-file=.env src/scripts/migrateIncidentTones.js
//
// Run this once after updating the Incident model/routes/views.

import { sequelize, Incident } from '../models/index.js';

function upper(value, fallback = '') {
  const v = String(value || '').trim().replace(/\s+/g, '_').toUpperCase();
  return v || fallback;
}

const VALID_TYPES = new Set(['POSITIVE', 'COACHING', 'FORMAL', 'INFO']);
const VALID_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

const VALID_TONES_BY_TYPE = {
  POSITIVE: new Set([
    'RECOGNITION',
    'ACHIEVEMENT',
    'ENCOURAGEMENT',
    'PROFESSIONAL_COMMENDATION',
  ]),
  COACHING: new Set([
    'NEEDS_IMPROVEMENT',
    'GUIDANCE',
    'REDIRECTION',
    'ACCOUNTABILITY_REMINDER',
  ]),
  FORMAL: new Set([
    'PERFORMANCE_CONCERN',
    'POLICY_VIOLATION',
    'CONDUCT_CONCERN',
    'ESCALATED_DOCUMENTATION',
  ]),
  INFO: new Set([
    'NEUTRAL_RECORD',
    'ATTENDANCE_NOTE',
    'OPERATIONAL_NOTE',
    'ADMINISTRATIVE_UPDATE',
  ]),
};

const DEFAULT_TONE_BY_TYPE = {
  POSITIVE: 'RECOGNITION',
  COACHING: 'NEEDS_IMPROVEMENT',
  FORMAL: 'PERFORMANCE_CONCERN',
  INFO: 'NEUTRAL_RECORD',
};

function normalizeType(rawType) {
  const type = upper(rawType, 'COACHING');
  return VALID_TYPES.has(type) ? type : 'COACHING';
}

function normalizeSeverity(rawSeverity, type) {
  const sev = upper(rawSeverity);
  if (VALID_SEVERITIES.has(sev)) return sev;
  return type === 'FORMAL' ? 'MEDIUM' : 'LOW';
}

function normalizeToneByType(rawTone, type) {
  const tone = upper(rawTone);
  const valid = VALID_TONES_BY_TYPE[type];

  if (valid.has(tone)) return tone;

  // Legacy mappings
  if (tone === 'RECOGNITION') {
    return type === 'POSITIVE' ? 'RECOGNITION' : DEFAULT_TONE_BY_TYPE[type];
  }

  if (tone === 'NEEDS_IMPROVEMENT') {
    if (type === 'COACHING') return 'NEEDS_IMPROVEMENT';
    if (type === 'FORMAL') return 'PERFORMANCE_CONCERN';
    return DEFAULT_TONE_BY_TYPE[type];
  }

  if (tone === 'NEUTRAL') {
    if (type === 'INFO') return 'NEUTRAL_RECORD';
    return DEFAULT_TONE_BY_TYPE[type];
  }

  // Fallback by type
  return DEFAULT_TONE_BY_TYPE[type];
}

function normalizeFollowUp(record, type) {
  const requiresFollowUp =
    type === 'FORMAL'
      ? true
      : !!record.requiresFollowUp;

  let followUpStatus = upper(record.followUpStatus, requiresFollowUp ? 'OPEN' : 'NO_ACTION');

  if (!requiresFollowUp) {
    followUpStatus = 'NO_ACTION';
  } else if (followUpStatus === 'NO_ACTION') {
    followUpStatus = 'OPEN';
  }

  return {
    requiresFollowUp,
    followUpStatus,
  };
}

async function ensureSeverityColumn() {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable('Incidents');

  if (!table.severity) {
    console.log('[migrate] adding severity column to Incidents');
    await qi.addColumn('Incidents', 'severity', {
      type: sequelize.Sequelize.STRING,
      allowNull: false,
      defaultValue: 'LOW',
    });
  } else {
    console.log('[migrate] severity column already exists');
  }
}

async function run() {
  try {
    await sequelize.authenticate();
    console.log('[migrate] connected');

    await ensureSeverityColumn();

    const incidents = await Incident.findAll({
      order: [['id', 'ASC']],
    });

    console.log(`[migrate] found ${incidents.length} incident(s)`);

    let changedCount = 0;

    for (const inc of incidents) {
      const original = {
        type: inc.type,
        tone: inc.tone,
        severity: inc.severity,
        requiresFollowUp: inc.requiresFollowUp,
        followUpStatus: inc.followUpStatus,
      };

      const type = normalizeType(inc.type);
      const tone = normalizeToneByType(inc.tone, type);
      const severity = normalizeSeverity(inc.severity, type);
      const followUp = normalizeFollowUp(inc, type);

      const patch = {};
      if (original.type !== type) patch.type = type;
      if (original.tone !== tone) patch.tone = tone;
      if (original.severity !== severity) patch.severity = severity;
      if (original.requiresFollowUp !== followUp.requiresFollowUp) {
        patch.requiresFollowUp = followUp.requiresFollowUp;
      }
      if (original.followUpStatus !== followUp.followUpStatus) {
        patch.followUpStatus = followUp.followUpStatus;
      }

      if (Object.keys(patch).length) {
        await inc.update(patch);
        changedCount++;
        console.log(`[migrate] updated incident #${inc.id}`, patch);
      }
    }

    console.log(`[migrate] done. Updated ${changedCount} incident(s).`);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('[migrate] failed:', err);
    try {
      await sequelize.close();
    } catch {}
    process.exit(1);
  }
}

run();