#!/usr/bin/env node
// scripts/migrate-calibration.mjs
//
// One-time migration: imports all records from data/calibration.json
// into the SQLite `calibration` table.
//
// Usage:
//   node scripts/migrate-calibration.mjs              — import all records
//   node scripts/migrate-calibration.mjs --dry-run    — preview only, no writes
//   node scripts/migrate-calibration.mjs --clear      — wipe table first, then import
//
// Duplicate handling: the JSON file has one known duplicate serial (MFG000842).
// This script keeps the record with the LATER nextCalibrationDue date and drops
// the other, then adds a UNIQUE index on serialNumber after the load is clean.
//
// Safe to re-run — skips serials already present (unless --clear is passed).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAR   = process.argv.includes('--clear');

const CAL_FILE = path.join(ROOT, 'data', 'calibration.json');

// ── Bootstrap models ─────────────────────────────────────────────────────────
const { Calibration, sequelize } = await import('../models/index.js');

// ── Helpers ──────────────────────────────────────────────────────────────────
const s = (v) => (v == null ? '' : String(v)).trim();

/** Normalise a raw JSON record into the DB column shape. */
function normalise(raw) {
  return {
    serialNumber:        s(raw.serialNumber    || raw.SerialNumber    || ''),
    slot:                s(raw.Slot            || raw.slot            || ''),
    torque:              s(raw.Torque          || raw.torque          || ''),
    category:            s(raw.Category        || raw.category        || ''),
    description:         s(raw.Description     || raw.description     || ''),
    model:               s(raw.Model           || raw.model           || ''),
    lastCalibrationDate: s(raw.LastCalibrationDate || raw.lastCalibrationDate ||
                            raw['Calibration Date'] || raw.calibrationDate || ''),
    nextCalibrationDue:  s(raw.NextCalibrationDue  || raw.nextCalibrationDue  || ''),
    calibrationStatus:   s(raw.CalibrationStatus   || raw.calibrationStatus   || ''),
  };
}

/**
 * De-duplicate: for each serialNumber keep the record whose nextCalibrationDue
 * is lexicographically latest (ISO date strings sort correctly as strings).
 */
function dedup(records) {
  const map = new Map();
  for (const r of records) {
    const sn = r.serialNumber;
    if (!sn) continue;
    const existing = map.get(sn);
    if (!existing || r.nextCalibrationDue > existing.nextCalibrationDue) {
      map.set(sn, r);
    }
  }
  return Array.from(map.values());
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  if (!fs.existsSync(CAL_FILE)) {
    console.error(`File not found: ${CAL_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(CAL_FILE, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log('calibration.json is empty — nothing to migrate.');
    return;
  }

  const normalised = raw.map(normalise).filter(r => r.serialNumber);
  const deduped    = dedup(normalised);

  console.log(`Raw records:       ${raw.length}`);
  console.log(`After normalise:   ${normalised.length}`);
  console.log(`After dedup:       ${deduped.length}`);

  if (normalised.length !== deduped.length) {
    const lost = normalised.filter(r => !deduped.find(d => d.serialNumber === r.serialNumber));
    // The kept record may differ from lost — show which serial was deduped
    const dupSerials = [...new Set(normalised.map(r => r.serialNumber))]
      .filter(sn => normalised.filter(r => r.serialNumber === sn).length > 1);
    console.log(`Duplicate serials resolved: ${dupSerials.join(', ')}`);
    dupSerials.forEach(sn => {
      const kept    = deduped.find(d => d.serialNumber === sn);
      const dropped = normalised.filter(r => r.serialNumber === sn && r !== kept);
      dropped.forEach(d =>
        console.log(`  Dropped: ${sn} due=${d.nextCalibrationDue} (kept due=${kept.nextCalibrationDue})`)
      );
    });
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] No writes performed. First normalised record:');
    console.log(deduped[0]);
    return;
  }

  if (CLEAR) {
    await Calibration.destroy({ where: {}, truncate: true });
    console.log('Cleared calibration table.');
  }

  // Find serials already in DB to skip
  const existingRows = await Calibration.findAll({ attributes: ['serialNumber'], raw: true });
  const existingSet  = new Set(existingRows.map(r => r.serialNumber));
  console.log(`Already in DB: ${existingSet.size} records`);

  const toInsert = deduped.filter(r => !existingSet.has(r.serialNumber));
  if (!toInsert.length) {
    console.log('All records already migrated. Nothing to do.');
  } else {
    await Calibration.bulkCreate(toInsert, { validate: true, ignoreDuplicates: true });
    console.log(`Inserted: ${toInsert.length} records`);
  }

  // Final count
  const total = await Calibration.count();
  console.log(`Total rows in calibration: ${total}`);

  // Now that data is clean (no duplicate serials), add the UNIQUE index.
  // We do this here rather than in the model definition so that a schema
  // sync before migration doesn't fail on the duplicate in the JSON file.
  const qi = sequelize.getQueryInterface();
  try {
    const indexes = await qi.showIndex('calibration');
    const uniqueName = 'calibration_serial_unique';
    if (!indexes.some(i => i.name === uniqueName)) {
      await qi.addIndex('calibration', ['serialNumber'], {
        name: uniqueName,
        unique: true,
      });
      console.log('Added UNIQUE index on calibration.serialNumber');
    } else {
      console.log('UNIQUE index on serialNumber already exists');
    }
  } catch (e) {
    console.warn('Could not add UNIQUE index (non-fatal):', e?.message);
  }

  console.log('\nDone. calibration.json can be kept as a backup but is no longer read by the app.');
}

run()
  .then(() => sequelize.close())
  .catch(err => {
    console.error('Migration failed:', err);
    sequelize.close().finally(() => process.exit(1));
  });
