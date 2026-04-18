// src/services/metricSourceParsers/trainingParser.js
// Parses Training/LMS platform CSV exports.
// Feeds: Development (cross-training) metrics + TechnicianPresenceDaily.certificationsReady.
import { parseFile, normalizeRowKeys, pick, safeNumber, safeBool } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'report date', 'as of date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id']),

    // Metric fields
    plannedCrossTrainingModules: safeNumber(pick(row, ['plannedcrosstrainingmodules', 'planned cross training modules', 'assigned modules', 'planned modules'])),
    completedCrossTrainingModules: safeNumber(pick(row, ['completedcrosstrainingmodules', 'completed cross training modules', 'completed modules'])),

    // Presence field
    certificationsReady: safeBool(pick(row, ['certificationsready', 'certifications ready', 'certs current', 'all certs current'])),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`Training row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`Training row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseTrainingFile(buffer, originalName) {
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

  return { source: 'training', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
