// src/routes/attendance.js
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { Op } from 'sequelize';

import { User, StaffProfile, Attendance } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

/**
 * Multer for in-memory uploads (CSV / Excel)
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

/* ──────────────────────────────────────────────
   Helpers: viewer + scoping
   ────────────────────────────────────────────── */

async function getViewer(req) {
  if (!req.session || !req.session.userId) return null;
  return User.findByPk(req.session.userId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
}

function scopeStaffByBuildingShift(staffArray, viewer) {
  if (!viewer || viewer.role === 'ADMIN') return staffArray;

  const profile = viewer.StaffProfile || null;
  const viewerBuilding = (profile?.building || '').trim();
  const viewerShift = (profile?.shift || '').trim();

  // If viewer has no building/shift set, don't restrict further.
  if (!viewerBuilding && !viewerShift) return staffArray;

  return staffArray.filter((s) => {
    const p = s.StaffProfile;
    if (!p) return false;

    const b = (p.building || '').trim();
    const sh = (p.shift || '').trim();

    if (viewerBuilding && b && b !== viewerBuilding) return false;
    if (viewerShift && sh && sh !== viewerShift) return false;

    return true;
  });
}

/* ──────────────────────────────────────────────
   Helpers: date/time, shift, lateness
   ────────────────────────────────────────────── */

function normalizeDateCell(value) {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  const s = String(value).trim();
  if (!s) return null;

  // Try direct parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  // Try Excel serial date
  const num = Number(s);
  if (!Number.isNaN(num)) {
    const base = new Date(1899, 11, 30); // Excel base (1900 system)
    base.setDate(base.getDate() + num);
    if (!Number.isNaN(base.getTime())) {
      return base.toISOString().slice(0, 10);
    }
  }

  return null;
}

function parseTimeToMinutesSinceMidnight(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;

  // Accept HH:MM or HH:MM:SS
  if (s.includes(':')) {
    const parts = s.split(':');
    const hh = parseInt(parts[0], 10);
    const mm = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 60 + mm;
  }

  // Excel time fraction in a day (e.g., 0.5 = noon)
  const num = Number(s);
  if (!Number.isNaN(num) && num >= 0 && num < 1) {
    return Math.round(num * 24 * 60);
  }

  return null;
}

function getShiftInfo(profile) {
  const raw = (profile?.shift ? String(profile.shift) : '').toLowerCase();

  let shiftType = '1ST';
  let shiftLabel = '1st Shift (07:00–15:45)';
  let startMinutes = 7 * 60;

  if (raw.includes('wknd') || raw.includes('weekend')) {
    shiftType = 'WKND';
    shiftLabel = 'Weekend Shift (07:00–19:00)';
    startMinutes = 7 * 60;
  } else if (raw.includes('3') || raw.includes('third')) {
    shiftType = '3RD';
    shiftLabel = '3rd Shift (23:00–07:45)';
    startMinutes = 23 * 60;
  } else if (raw.includes('2') || raw.includes('second')) {
    shiftType = '2ND';
    shiftLabel = '2nd Shift (15:00–23:45)';
    startMinutes = 15 * 60;
  }

  return { shiftType, shiftLabel, startMinutes };
}

function computeLateness(entryMinutes, shiftStartMinutes) {
  if (entryMinutes == null || shiftStartMinutes == null) {
    return { minutesLate: null, status: 'PRESENT', punctualityBucket: null };
  }

  const delta = entryMinutes - shiftStartMinutes;

  if (delta <= 0) {
    return { minutesLate: 0, status: 'PRESENT', punctualityBucket: 'ON_TIME' };
  }

  if (delta >= 1 && delta <= 7) {
    return { minutesLate: delta, status: 'LATE', punctualityBucket: 'UNPUNCTUAL' };
  }

  return { minutesLate: delta, status: 'LATE', punctualityBucket: 'LATE' };
}

/* ──────────────────────────────────────────────
   GET /attendance/import
   ────────────────────────────────────────────── */

router.get('/import', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']), async (req, res) => {
  return res.render('attendance/import', {
    trainingSummary: null,
    trainingError: null,
    esdSummary: null,
    esdError: null,
    attendanceSummary: null,
    attendanceError: null,
    rackSummary: null,
    rackError: null,
  });
});

/* ──────────────────────────────────────────────
   POST /attendance/import
   Supports BOTH:
   - Old headers: "Employee ID", "Name", "Date", "Entry Time"
   - New template headers: date, employeeId/domainUsername/staffId, minutesLate/status/etc.
   ────────────────────────────────────────────── */

router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  upload.single('file'),
  async (req, res) => {
    try {
      const viewer = await getViewer(req);
      if (!viewer) return res.redirect('/login');

      if (!req.file) {
        return res.status(400).render('attendance/import', {
          trainingSummary: null,
          trainingError: null,
          esdSummary: null,
          esdError: null,
          attendanceSummary: null,
          attendanceError: 'No file uploaded.',
          rackSummary: null,
          rackError: null,
        });
      }

      const originalName = req.file.originalname.toLowerCase();
      const isExcel = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
      const isCsv = originalName.endsWith('.csv');

      if (!isExcel && !isCsv) {
        return res.status(400).render('attendance/import', {
          trainingSummary: null,
          trainingError: null,
          esdSummary: null,
          esdError: null,
          attendanceSummary: null,
          attendanceError: 'Unsupported file type. Please upload CSV or Excel (.xlsx).',
          rackSummary: null,
          rackError: null,
        });
      }

      // Parse rows
      let rawRows = [];
      try {
        if (isExcel) {
          const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
          const sheetName = wb.SheetNames[0];
          const sheet = wb.Sheets[sheetName];
          rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        } else {
          const text = req.file.buffer.toString('utf8');
          rawRows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
        }
      } catch (err) {
        console.error('ATTENDANCE IMPORT → parse error:', err);
        return res.status(400).render('attendance/import', {
          trainingSummary: null,
          trainingError: null,
          esdSummary: null,
          esdError: null,
          attendanceSummary: null,
          attendanceError: 'Failed to parse file. Please verify headers and format.',
          rackSummary: null,
          rackError: null,
        });
      }

      if (!rawRows.length) {
        return res.status(400).render('attendance/import', {
          trainingSummary: null,
          trainingError: null,
          esdSummary: null,
          esdError: null,
          attendanceSummary: null,
          attendanceError: 'File contained no rows.',
          rackSummary: null,
          rackError: null,
        });
      }

      // Normalize header keys (trim whitespace)
      const rows = rawRows.map((raw) => {
        const obj = {};
        Object.keys(raw).forEach((k) => {
          obj[String(k).trim()] = raw[k];
        });
        return obj;
      });

      // Load all staff (scope later)
      const baseStaff = await User.findAll({
        where: {
          role: { [Op.in]: ['STAFF', 'LEAD', 'SUPERVISOR'] },
        },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });
      const scopedStaff = scopeStaffByBuildingShift(baseStaff, viewer);

      // Build maps for matching
      const staffByEmployeeId = new Map();
      const staffByUserId = new Map();
      const staffByDomainUsername = new Map();

      for (const s of scopedStaff) {
        staffByUserId.set(String(s.id), s);

        const p = s.StaffProfile;
        if (p?.employeeId) staffByEmployeeId.set(String(p.employeeId).trim(), s);
        if (p?.domainUsername) staffByDomainUsername.set(String(p.domainUsername).toLowerCase().trim(), s);
        if (s.username) staffByDomainUsername.set(String(s.username).toLowerCase().trim(), s);
      }

      // Track which dates exist in import and which emp-date pairs exist
      const datesSet = new Set();
      const empDateKeySet = new Set();

      let created = 0;
      let updated = 0;
      let absentCreated = 0;
      let parseErrors = 0;
      let errors = 0;
      const errorDetails = [];

      // 1) Create/update from rows
      for (const r of rows) {
        // Support both formats:
        // New template:
        //   date, employeeId OR staffId OR domainUsername, status, minutesLate, rawStatus, punctualityBucket
        // Old format:
        //   "Employee ID", "Name", "Date", "Entry Time"
        const dateRaw = r.date ?? r.Date ?? r['Date'] ?? '';
        const date = normalizeDateCell(dateRaw);
        if (!date) {
          parseErrors++;
          continue;
        }

        const employeeId = (r.employeeId ?? r['Employee ID'] ?? r.EmpId ?? r.EmpID ?? '').toString().trim();
        const staffIdRaw = (r.staffId ?? r.staffID ?? '').toString().trim();
        const domainUsernameRaw = (r.domainUsername ?? r.DomainUsername ?? r.username ?? r.Username ?? '').toString().trim();
        const name = (r.name ?? r.Name ?? r['Name'] ?? '').toString().trim();

        // Determine staff user
        let staffUser = null;
        if (staffIdRaw) staffUser = staffByUserId.get(staffIdRaw) || null;
        if (!staffUser && employeeId) staffUser = staffByEmployeeId.get(employeeId) || null;
        if (!staffUser && domainUsernameRaw) staffUser = staffByDomainUsername.get(domainUsernameRaw.toLowerCase()) || null;

        if (!staffUser) {
          errors++;
          errorDetails.push(`No scoped staff match for row date=${date} (employeeId="${employeeId}", staffId="${staffIdRaw}", domainUsername="${domainUsernameRaw}").`);
          continue;
        }

        const profile = staffUser.StaffProfile || null;
        const { shiftType, startMinutes } = getShiftInfo(profile);

        // If template provides status/minutesLate use them; else compute from Entry Time
        let status = (r.status ?? r.Status ?? '').toString().trim().toUpperCase();
        let minutesLate = r.minutesLate ?? r.MinutesLate ?? '';

        const entryTimeRaw = (r['Entry Time'] ?? r.entryTime ?? r.EntryTime ?? r.Time ?? '').toString().trim();

        if (!status) {
          // fallback to legacy compute
          const entryMinutes = parseTimeToMinutesSinceMidnight(entryTimeRaw);
          const lateness = computeLateness(entryMinutes, startMinutes);
          status = lateness.status;
          minutesLate = lateness.minutesLate;
        } else {
          // sanitize minutesLate
          const m = Number(minutesLate);
          minutesLate = Number.isFinite(m) ? m : null;
          if (!['PRESENT', 'LATE', 'ABSENT'].includes(status)) status = 'PRESENT';
        }

        const punctualityBucketRaw = (r.punctualityBucket ?? r.PunctualityBucket ?? '').toString().trim().toUpperCase();
        const punctualityBucket = punctualityBucketRaw || null;

        const rawStatus = (r.rawStatus ?? r.RawStatus ?? '').toString().trim() ||
          `AUTO_IMPORT|${shiftType}|${entryTimeRaw || ''}`;

        const empKey =
          employeeId ||
          (profile?.employeeId ? String(profile.employeeId).trim() : '') ||
          '';

        if (empKey) {
          datesSet.add(date);
          empDateKeySet.add(`${empKey}|${date}`);
        }

        try {
          const [record, wasCreated] = await Attendance.findOrCreate({
            where: { staffId: staffUser.id, date },
            defaults: {
              staffId: staffUser.id,
              employeeId: empKey || null,
              name: name || staffUser.name || null,
              date,
              status,
              minutesLate: minutesLate === '' ? null : minutesLate,
              rawStatus,
              punctualityBucket,
            },
          });

          if (!wasCreated) {
            await record.update({
              employeeId: empKey || record.employeeId,
              name: name || record.name || staffUser.name || null,
              status,
              minutesLate: minutesLate === '' ? null : minutesLate,
              rawStatus,
              punctualityBucket,
            });
            updated++;
          } else {
            created++;
          }
        } catch (err) {
          console.error('ATTENDANCE IMPORT → create/update error:', err);
          errors++;
          errorDetails.push(`Error saving attendance for staff="${staffUser.name}" date="${date}": ${err.message}`);
        }
      }

      // 2) Auto-create ABSENT for dates in import, for staff missing a record
      const dates = Array.from(datesSet);
      for (const date of dates) {
        for (const staffUser of scopedStaff) {
          const profile = staffUser.StaffProfile;
          const empId = profile?.employeeId ? String(profile.employeeId).trim() : '';
          if (!empId) continue;

          const key = `${empId}|${date}`;
          if (empDateKeySet.has(key)) continue;

          try {
            const [record, wasCreated] = await Attendance.findOrCreate({
              where: { staffId: staffUser.id, date },
              defaults: {
                staffId: staffUser.id,
                employeeId: empId,
                name: staffUser.name || null,
                date,
                status: 'ABSENT',
                minutesLate: null,
                rawStatus: 'ABSENT_AUTO',
                punctualityBucket: null,
              },
            });

            if (wasCreated) absentCreated++;
            // Do NOT overwrite existing present/late
          } catch (err) {
            console.error('ATTENDANCE IMPORT → absent creation error:', err);
            errors++;
            errorDetails.push(`Error creating ABSENT for "${staffUser.name}" date="${date}": ${err.message}`);
          }
        }
      }

      const summaryLines = [];
      summaryLines.push(`ATTENDANCE IMPORT → Records created: ${created}`);
      summaryLines.push(`ATTENDANCE IMPORT → Records updated: ${updated}`);
      summaryLines.push(`ATTENDANCE IMPORT → ABSENT records created: ${absentCreated}`);
      summaryLines.push(`ATTENDANCE IMPORT → Parse errors (skipped rows): ${parseErrors}`);
      summaryLines.push(`ATTENDANCE IMPORT → Other errors: ${errors}`);

      if (errorDetails.length > 0) {
        summaryLines.push('Some errors:');
        errorDetails.slice(0, 5).forEach((line) => summaryLines.push(`- ${line}`));
        if (errorDetails.length > 5) summaryLines.push(`...and ${errorDetails.length - 5} more`);
      }

      return res.render('attendance/import', {
        trainingSummary: null,
        trainingError: null,
        esdSummary: null,
        esdError: null,
        attendanceSummary: summaryLines.join('\n'),
        attendanceError: null,
        rackSummary: null,
        rackError: null,
      });
    } catch (err) {
      console.error('ATTENDANCE IMPORT → fatal error:', err);
      return res.status(500).render('attendance/import', {
        trainingSummary: null,
        trainingError: null,
        esdSummary: null,
        esdError: null,
        attendanceSummary: null,
        attendanceError: 'Unexpected error during attendance import.',
        rackSummary: null,
        rackError: null,
      });
    }
  }
);

export default router;
