#!/usr/bin/env node
// scripts/migrate-tools-audit.mjs
//
// One-time migration: imports all records from data/tools_audit.json
// into the SQLite tool_audit_logs table.
//
// Usage:
//   node scripts/migrate-tools-audit.mjs
//   node scripts/migrate-tools-audit.mjs --dry-run   (count only, no writes)
//   node scripts/migrate-tools-audit.mjs --clear     (wipe table first, then import)
//
// Safe to run multiple times — skips records whose (serialNumber + time) pair
// already exists in the database.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAR   = process.argv.includes('--clear');
const BATCH   = 200; // rows per INSERT batch

const AUDIT_FILE = path.join(ROOT, 'data', 'tools_audit.json');

// ── Bootstrap Sequelize (reuse app models) ───────────────────────────────────
const { ToolAuditLog, sequelize } = await import('../models/index.js');

async function run() {
  if (!fs.existsSync(AUDIT_FILE)) {
    console.error(`File not found: ${AUDIT_FILE}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.log('tools_audit.json is empty — nothing to migrate.');
    return;
  }

  console.log(`Found ${raw.length} records in tools_audit.json`);

  if (DRY_RUN) {
    console.log('[dry-run] No writes performed.');
    return;
  }

  if (CLEAR) {
    await ToolAuditLog.destroy({ where: {}, truncate: true });
    console.log('Cleared tool_audit_logs table.');
  }

  // Build a set of existing (serialNumber|time) pairs to skip duplicates
  const existing = await ToolAuditLog.findAll({
    attributes: ['serialNumber', 'time'],
    raw: true,
  });
  const seen = new Set(existing.map(r => `${r.serialNumber}|${r.time}`));
  console.log(`${seen.size} records already in DB — will skip duplicates.`);

  const toInsert = raw
    .filter(r => {
      const key = `${r.serialNumber || ''}|${r.time || ''}`;
      return !seen.has(key);
    })
    .map(r => ({
      serialNumber: String(r.serialNumber || r.targetId || '').trim(),
      action:       String(r.action || 'unknown').trim(),
      actor:        r.actor  ? String(r.actor).trim()  : null,
      operatorId:   null, // not stored in old format; extractable from changes if needed
      changes:      Array.isArray(r.changes) ? r.changes : [],
      time:         r.time || new Date().toISOString(),
    }))
    // strip any records with blank serialNumber or action (junk rows)
    .filter(r => r.serialNumber && r.action);

  if (toInsert.length === 0) {
    console.log('All records already migrated. Nothing to do.');
    return;
  }

  console.log(`Inserting ${toInsert.length} new records in batches of ${BATCH}…`);

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await ToolAuditLog.bulkCreate(batch, {
      validate: false, // already normalized above; skip per-row validation for speed
      ignoreDuplicates: true,
    });
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${toInsert.length}`);
  }

  console.log(`\nDone. Inserted ${inserted} records into tool_audit_logs.`);

  // Final count
  const total = await ToolAuditLog.count();
  console.log(`Total rows in tool_audit_logs: ${total}`);
}

run()
  .then(() => sequelize.close())
  .catch(err => {
    console.error('Migration failed:', err);
    sequelize.close().finally(() => process.exit(1));
  });
