// src/services/metricSourceParsers/attendanceParser.js
// Parses HR/Attendance system CSV exports.
// Feeds: Compliance (attendance + policy) metrics + TechnicianPresenceDaily rows.
import { parseFile, normalizeRowKeys, pick, safeNumber, safeBool } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'work date', 'attendance date', 'shift date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id']),
    building: pick(row, ['building', 'facility', 'site']),
    shift: pick(row, ['shift']),
    area: pick(row, ['area', 'department']),

    // Metric fields (rolled-up counts for the period/day)
    scheduledShifts: safeNumber(pick(row, ['scheduledshifts', 'scheduled shifts', 'total scheduled'])),
    shiftsAttendedOnTime: safeNumber(pick(row, ['shiftsattendedontime', 'shifts attended on time', 'on time'])),
    daysWorked: safeNumber(pick(row, ['daysworked', 'days worked'])),
    infractionPoints: safeNumber(pick(row, ['infractionpoints', 'infraction points', 'infractions'])),

    // Presence fields (daily booleans)
    wasScheduled: safeBool(pick(row, ['wasscheduled', 'was scheduled', 'scheduled'])),
    wasPresent: safeBool(pick(row, ['waspresent', 'was present', 'present'])),
    wasActiveTechnician: safeBool(pick(row, ['wasactivetechnician', 'was active technician', 'active tech'])),
    wasLate: safeBool(pick(row, ['waslate', 'was late', 'late'])),
    minutesLate: safeNumber(pick(row, ['minuteslate', 'minutes late'])),
    assignmentStatus: pick(row, ['assignmentstatus', 'assignment status']),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`Attendance row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`Attendance row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseAttendanceFile(buffer, originalName) {
  const rawRows = parseFile(buffer, originalName);
  const rows = [];
  const issues = [];

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    const normalized = normalizeRow(raw);
    const rowIssues = validate(normalized, rowNum);
    if (rowIssues.length) {
      issues.push(...rowIssues);
      return;
    }
    rows.push(normalized);
  });

  return { source: 'attendance', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
