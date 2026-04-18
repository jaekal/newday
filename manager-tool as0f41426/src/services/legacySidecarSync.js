// src/services/legacySidecarSync.js
// After a multi-source import, syncs the parsed attendance/ESD/MES rows
// into the legacy display models (Attendance, EsdCheck, RackAssignment)
// that power the profile calendar sections.

import { Op } from 'sequelize';
import { User, StaffProfile, Attendance, EsdCheck, RackAssignment } from '../models/index.js';

function norm(v) {
  return v == null ? '' : String(v).trim();
}

async function buildEmployeeIdMap() {
  const users = await User.findAll({
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
  const map = new Map();
  for (const u of users) {
    const empId = norm(u.StaffProfile?.employeeId);
    if (empId) map.set(empId, u);
  }
  return map;
}

/**
 * Sync attendance source rows → Attendance model (upsert by staffId + date).
 * Existing rows for the same staffId+date are deleted and replaced.
 */
async function syncAttendance(attendanceRows, empMap) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const row of attendanceRows) {
    const empId = norm(row.employeeId);
    const date = norm(row.date);
    if (!empId || !date) { skipped++; continue; }

    const user = empMap.get(empId);
    if (!user) { skipped++; issues.push(`Attendance: no user for employeeId=${empId}`); continue; }

    try {
      // Derive status
      const wasPresent = row.wasPresent == null ? null : (Number(row.wasPresent) === 1 || row.wasPresent === true || String(row.wasPresent).toUpperCase() === 'TRUE');
      const wasLate = row.wasLate == null ? null : (Number(row.wasLate) === 1 || row.wasLate === true || String(row.wasLate).toUpperCase() === 'TRUE');
      const minutesLate = row.minutesLate != null ? Number(row.minutesLate) || null : null;

      let status = 'PRESENT';
      if (wasPresent === false) status = 'ABSENT';
      else if (wasLate === true) status = 'LATE';

      let punctualityBucket = null;
      if (status === 'PRESENT') punctualityBucket = 'ON_TIME';
      else if (status === 'LATE') {
        punctualityBucket = minutesLate != null && minutesLate <= 5 ? 'UNPUNCTUAL' : 'LATE';
      }

      const payload = {
        staffId: user.id,
        employeeId: empId,
        name: norm(user.username),
        date,
        status,
        minutesLate: minutesLate || null,
        rawStatus: status,
        punctualityBucket,
      };

      const existing = await Attendance.findOne({ where: { staffId: user.id, date } });
      if (existing) {
        await existing.update(payload);
        updated++;
      } else {
        await Attendance.create(payload);
        created++;
      }
    } catch (err) {
      skipped++;
      issues.push(`Attendance sync error for empId=${empId} date=${date}: ${err.message}`);
    }
  }

  return { created, updated, skipped, issues };
}

/**
 * Sync ESD source rows → EsdCheck model (upsert by staffId + date).
 * Since EsdCheck requires a logDateTime, we use noon on the given date.
 */
async function syncEsdChecks(esdRows, empMap) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const row of esdRows) {
    const empId = norm(row.employeeId);
    const date = norm(row.date);
    if (!empId || !date) { skipped++; continue; }

    const user = empMap.get(empId);
    if (!user) { skipped++; issues.push(`ESD: no user for employeeId=${empId}`); continue; }

    try {
      const esdPassed = row.esdPassed == null ? null : (Number(row.esdPassed) === 1 || row.esdPassed === true || String(row.esdPassed).toUpperCase() === 'TRUE');
      const result = esdPassed === false ? 'FAIL' : 'PASS';

      // Use noon on the date as the log timestamp
      const logDateTime = new Date(`${date}T12:00:00.000Z`);

      const payload = {
        staffId: user.id,
        employeeId: empId,
        name: norm(user.username),
        logDateTime,
        result,
      };

      // Upsert: delete any existing EsdCheck for this staffId+date, then insert fresh
      const dateStart = new Date(`${date}T00:00:00.000Z`);
      const dateEnd = new Date(`${date}T23:59:59.999Z`);
      const existing = await EsdCheck.findOne({
        where: {
          staffId: user.id,
          logDateTime: { [Op.gte]: dateStart, [Op.lte]: dateEnd },
        },
      });

      if (existing) {
        await existing.update(payload);
        updated++;
      } else {
        await EsdCheck.create(payload);
        created++;
      }
    } catch (err) {
      skipped++;
      issues.push(`ESD sync error for empId=${empId} date=${date}: ${err.message}`);
    }
  }

  return { created, updated, skipped, issues };
}

/**
 * Sync MES source rows → RackAssignment model (upsert by staffId + date).
 * Uses racksCompleted as rackCount.
 */
async function syncRackAssignments(mesRows, empMap) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues = [];

  for (const row of mesRows) {
    const empId = norm(row.employeeId);
    const date = norm(row.date);
    if (!empId || !date) { skipped++; continue; }

    const user = empMap.get(empId);
    if (!user) { skipped++; issues.push(`RackAssignment: no user for employeeId=${empId}`); continue; }

    const rackCount = Number(row.racksCompleted) || 0;
    // Skip if no rack work for this day
    if (rackCount === 0 && !row.rackList) { skipped++; continue; }

    try {
      const payload = {
        staffId: user.id,
        employeeId: empId,
        name: norm(user.username),
        assignmentDate: date,
        rackCount,
        rackList: norm(row.rackList) || null,
        area: norm(row.area) || null,
        shift: norm(row.shift) || null,
      };

      const existing = await RackAssignment.findOne({ where: { staffId: user.id, assignmentDate: date } });
      if (existing) {
        await existing.update(payload);
        updated++;
      } else {
        await RackAssignment.create(payload);
        created++;
      }
    } catch (err) {
      skipped++;
      issues.push(`RackAssignment sync error for empId=${empId} date=${date}: ${err.message}`);
    }
  }

  return { created, updated, skipped, issues };
}

/**
 * Main entry point: sync all legacy display models from the parsed source rows.
 *
 * @param {Object} opts
 * @param {Array}  opts.attendanceRows  - from attendanceParser
 * @param {Array}  opts.esdRows         - from esdParser
 * @param {Array}  opts.mesRows         - from mesParser
 * @returns {{ attendance, esd, rackAssignments }}
 */
export async function syncLegacySidecars({ attendanceRows = [], esdRows = [], mesRows = [] }) {
  const empMap = await buildEmployeeIdMap();

  const [attendance, esd, rackAssignments] = await Promise.all([
    syncAttendance(attendanceRows, empMap),
    syncEsdChecks(esdRows, empMap),
    syncRackAssignments(mesRows, empMap),
  ]);

  return { attendance, esd, rackAssignments };
}
