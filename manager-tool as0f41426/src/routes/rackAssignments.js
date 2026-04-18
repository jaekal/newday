// src/routes/rackAssignments.js
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { Op } from 'sequelize';

import { User, StaffProfile, RosterEntry, RackAssignmentEvent, ExposureAggregate, sequelize } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────
// Helpers: normalization + header access
// ─────────────────────────────────────────────────────────────
const stripBom = (s) => String(s || '').replace(/^\uFEFF/, '');
const cleanHeader = (h) => stripBom(h).trim().replace(/\s+/g, ' ');
const norm = (v) => String(v ?? '').trim();
const normLower = (v) => norm(v).toLowerCase();
const normUpper = (v) => norm(v).toUpperCase();

function normalizeRow(raw) {
  const row = {};
  Object.keys(raw || {}).forEach((key) => {
    const k = cleanHeader(key);
    row[k] = typeof raw[key] === 'string' ? raw[key].trim() : raw[key];
  });
  return row;
}

function makeGetVal(row) {
  const map = new Map();
  Object.keys(row || {}).forEach((k) => map.set(cleanHeader(k).toLowerCase(), k));

  return (...keys) => {
    for (const key of keys) {
      // direct match
      if (key in row) {
        const v = row[key];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
      // case-insensitive match
      const found = map.get(cleanHeader(key).toLowerCase());
      if (found) {
        const v = row[found];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  };
}

/**
 * Normalize domain identifiers into a consistent domain username key:
 *  - "EXAMPLE\\example.example" -> "example.example"
 *  - "example.example@company.com" -> "example.example"
 *  - "\"example.example\"" -> "example.example"
 */
function normalizeDomainUsername(value) {
  let v = normLower(value);
  if (!v) return '';

  // domain\user
  const slashIdx = v.lastIndexOf('\\');
  if (slashIdx !== -1) v = v.slice(slashIdx + 1);

  // user@company.com -> user
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(0, atIdx);

  // strip quotes
  v = v.replace(/^"+|"+$/g, '').trim();

  return v;
}

// ─────────────────────────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────────────────────────
function parseDateTime(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }

  // Excel date serial
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toISODateOnly(dateObj) {
  if (!dateObj) return null;
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// Extract Event Stream fields (matches your import.ejs contract)
// Expected (case-insensitive):
// building, customer, assignmentTime, assigneeAtTime, model, serialNumber, type
// ─────────────────────────────────────────────────────────────
function extractEventStreamFields(row) {
  const getVal = makeGetVal(row);

  const building = getVal('building', 'Building');
  const customer = getVal('customer', 'Customer');
  const assignmentTimeRaw = getVal('assignmentTime', 'AssignmentTime', 'Assignment Time');
  const assigneeAtTimeRaw = getVal('assigneeAtTime', 'AssigneeAtTime', 'Assignee At Time');
  const model = getVal('model', 'Model');
  const serialNumber = getVal('serialNumber', 'SerialNumber', 'Serial Number');
  const type = getVal('type', 'Type');

  return {
    building: norm(building),
    customer: norm(customer),
    assignmentTimeRaw,
    assigneeAtTimeRaw,
    model: norm(model),
    serialNumber: norm(serialNumber),
    type: norm(type),
  };
}

function normalizeType(value) {
  const t = normUpper(value);
  if (t === 'RACK' || t === 'SERVER') return t;
  return '';
}

// ─────────────────────────────────────────────────────────────
// Resolve staff strictly by roster domain username -> employeeId -> StaffProfile -> User
// ─────────────────────────────────────────────────────────────
async function resolveStaffUserFromAssigneeAtTime(assigneeAtTimeRaw) {
  const domainKey = normalizeDomainUsername(assigneeAtTimeRaw);
  if (!domainKey) return { staffUser: null, domainKey: '' };

  const roster = await RosterEntry.findOne({
    where: { domainUsername: domainKey },
  });

  if (!roster) return { staffUser: null, domainKey };

  if (!roster.employeeId) return { staffUser: null, domainKey };

  const profile = await StaffProfile.findOne({
    where: { employeeId: String(roster.employeeId).trim() },
    include: [{ model: User, as: 'User' }],
  });

  if (!profile?.User) return { staffUser: null, domainKey };

  return { staffUser: profile.User, domainKey };
}

// ─────────────────────────────────────────────────────────────
// GET /rack-assignments/import
// ─────────────────────────────────────────────────────────────
router.get(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    return res.render('rackAssignments/import', {
      importSummary: null,
      importError: null,
    });
  }
);

// ─────────────────────────────────────────────────────────────
// POST /rack-assignments/import  (Event Stream -> RackAssignmentEvents)
// ─────────────────────────────────────────────────────────────
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).render('rackAssignments/import', {
        importSummary: null,
        importError: 'No file uploaded.',
      });
    }

    const originalName = req.file.originalname.toLowerCase();
    const isExcel = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
    const isCsv = originalName.endsWith('.csv');

    if (!isExcel && !isCsv) {
      return res.status(400).render('rackAssignments/import', {
        importSummary: null,
        importError: 'Unsupported file type. Please upload CSV or Excel (.xlsx/.xls).',
      });
    }

    let rows = [];
    try {
      if (isExcel) {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } else {
        const text = req.file.buffer.toString('utf8');
        rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
      }
    } catch (err) {
      console.error('RACK ASSIGNMENT EVENT IMPORT → parse error:', err);
      return res.status(400).render('rackAssignments/import', {
        importSummary: null,
        importError: 'Failed to parse file. Check format and headers.',
      });
    }

    // Counters
    let created = 0;
    let updated = 0; // only if we choose to update existing records
    let duplicatesIgnored = 0;

    let rosterMisses = 0;
    let staffProfileMisses = 0;
    let invalidRows = 0;

    const errorDetails = [];

    for (const raw of rows) {
      const row = normalizeRow(raw);
      const r = extractEventStreamFields(row);

      const assignmentTime = parseDateTime(r.assignmentTimeRaw);
      const assignmentDate = assignmentTime ? toISODateOnly(assignmentTime) : null;

      const serialNumber = r.serialNumber;
      const type = normalizeType(r.type);
      const assigneeAtTimeRaw = r.assigneeAtTimeRaw;

      // Required fields for event stream
      if (!assignmentTime || !assignmentDate || !serialNumber || !type || !assigneeAtTimeRaw) {
        invalidRows++;
        errorDetails.push(
          `Missing required fields. Need assignmentTime, assigneeAtTime, serialNumber, type. Got assignmentTime="${r.assignmentTimeRaw}", assigneeAtTime="${assigneeAtTimeRaw}", serialNumber="${serialNumber}", type="${r.type}".`
        );
        continue;
      }

      try {
        const { staffUser, domainKey } = await resolveStaffUserFromAssigneeAtTime(assigneeAtTimeRaw);

        if (!domainKey) {
          rosterMisses++;
          errorDetails.push(`assigneeAtTime "${assigneeAtTimeRaw}" did not normalize to a domain username.`);
          continue;
        }

        if (!staffUser) {
          // differentiate roster missing vs profile missing
          const roster = await RosterEntry.findOne({ where: { domainUsername: domainKey } });
          if (!roster) {
            rosterMisses++;
            errorDetails.push(`Roster not found for domainUsername="${domainKey}" (assigneeAtTime="${assigneeAtTimeRaw}").`);
          } else {
            staffProfileMisses++;
            errorDetails.push(
              `No StaffProfile/User found for roster employeeId="${roster.employeeId}" (domainUsername="${domainKey}").`
            );
          }
          continue;
        }

        // Dedupe key enforced by DB unique index:
        // staffId + assignmentDate + serialNumber + type
        const whereKey = {
          staffId: staffUser.id,
          assignmentDate,
          serialNumber,
          type,
        };

        const defaults = {
          staffId: staffUser.id,
          building: r.building || null,
          customer: r.customer || null,
          assignmentTime,            // DATE
          assignmentDate,            // DATEONLY (YYYY-MM-DD)
          assigneeAtTime: domainKey, // store normalized domain username for consistency
          model: r.model || null,
          serialNumber,
          type,
          sourceFile: req.file.originalname || null,
        };

        const [record, createdFlag] = await RackAssignmentEvent.findOrCreate({
          where: whereKey,
          defaults,
        });

        if (createdFlag) {
          created++;
        } else {
          // Choose behavior:
          // Option A) Strict "ignore duplicates":
          duplicatesIgnored++;

          // Option B) "Update enrichment fields" if blank:
          // Uncomment if you want updates when the duplicate arrives with more info.
          /*
          const payload = {};
          if (!record.building && defaults.building) payload.building = defaults.building;
          if (!record.customer && defaults.customer) payload.customer = defaults.customer;
          if (!record.model && defaults.model) payload.model = defaults.model;
          if (!record.sourceFile && defaults.sourceFile) payload.sourceFile = defaults.sourceFile;
          if (!record.assigneeAtTime && defaults.assigneeAtTime) payload.assigneeAtTime = defaults.assigneeAtTime;

          if (Object.keys(payload).length > 0) {
            await record.update(payload);
            updated++;
          } else {
            duplicatesIgnored++;
          }
          */
        }
      } catch (err) {
        // If we hit unique constraint race or duplicates via create, treat as ignored
        if (err?.name === 'SequelizeUniqueConstraintError') {
          duplicatesIgnored++;
          continue;
        }

        console.error('RACK ASSIGNMENT EVENT IMPORT → row error:', err);
        invalidRows++;
        errorDetails.push(`Error importing serial="${serialNumber}" assigneeAtTime="${assigneeAtTimeRaw}": ${err.message}`);
      }
    }

    // Rebuild ExposureAggregate for all staff affected by this import
    if (created > 0) {
      try {
        const affectedStaffIds = [...new Set(
          (await RackAssignmentEvent.findAll({ attributes: ['staffId'], group: ['staffId'] }))
            .map(r => r.staffId)
        )];

        for (const staffId of affectedStaffIds) {
          const events = await RackAssignmentEvent.findAll({ where: { staffId } });
          const byCustomerModel = {};
          for (const ev of events) {
            const key = `${ev.customer}|||${ev.model}`;
            if (!byCustomerModel[key]) {
              byCustomerModel[key] = {
                staffId,
                building: ev.building,
                customer: ev.customer,
                model: ev.model,
                rackCount: new Set(),
                serverCount: new Set(),
                firstWorkedAt: ev.assignmentDate,
                lastWorkedAt: ev.assignmentDate,
              };
            }
            const agg = byCustomerModel[key];
            if (ev.type === 'RACK') agg.rackCount.add(ev.serialNumber);
            else agg.serverCount.add(ev.serialNumber);
            if (ev.assignmentDate < agg.firstWorkedAt) agg.firstWorkedAt = ev.assignmentDate;
            if (ev.assignmentDate > agg.lastWorkedAt) agg.lastWorkedAt = ev.assignmentDate;
          }

          for (const agg of Object.values(byCustomerModel)) {
            const rackDistinctCount = agg.rackCount.size;
            const serverDistinctCount = agg.serverCount.size;
            await ExposureAggregate.upsert({
              staffId: agg.staffId,
              building: agg.building,
              customer: agg.customer,
              model: agg.model,
              rackDistinctCount,
              serverDistinctCount,
              totalDistinctCount: rackDistinctCount + serverDistinctCount,
              firstWorkedAt: agg.firstWorkedAt,
              lastWorkedAt: agg.lastWorkedAt,
            });
          }
        }
      } catch (aggErr) {
        console.error('RACK ASSIGNMENT EVENT IMPORT → ExposureAggregate rebuild error:', aggErr);
      }
    }

    const summaryLines = [];
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Created: ${created}`);
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Updated: ${updated}`);
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Duplicates ignored: ${duplicatesIgnored}`);
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Roster misses: ${rosterMisses}`);
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Staff profile misses: ${staffProfileMisses}`);
    summaryLines.push(`RACK ASSIGNMENT EVENT IMPORT → Invalid/errored rows: ${invalidRows}`);

    if (errorDetails.length > 0) {
      summaryLines.push('');
      summaryLines.push('Some issues encountered:');
      errorDetails.slice(0, 10).forEach((line) => summaryLines.push(`- ${line}`));
      if (errorDetails.length > 10) summaryLines.push(`...and ${errorDetails.length - 10} more`);
    }

    return res.render('rackAssignments/import', {
      importSummary: summaryLines.join('\n'),
      importError: null,
    });
  }
);

export default router;
