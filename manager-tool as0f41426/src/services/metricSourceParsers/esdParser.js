// src/services/metricSourceParsers/esdParser.js
// Parses ESD Badge System CSV exports.
// Feeds: Compliance (ESD portion) metrics + TechnicianPresenceDaily.esdPassed.
import { parseFile, normalizeRowKeys, pick, safeNumber, safeBool } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'test date', 'check date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id']),

    // Metric fields (running counts)
    daysWithSuccessfulEsd: safeNumber(pick(row, ['dayswithsuccessfulesd', 'days with successful esd', 'successful esd days'])),
    esdFirstPassDays: safeNumber(pick(row, ['esdfirstpassdays', 'esd first pass days', 'first pass days'])),
    totalEsdDays: safeNumber(pick(row, ['totalesddays', 'total esd days', 'total esd tested'])),

    // Presence field (daily boolean)
    esdPassed: safeBool(pick(row, ['esdpassed', 'esd passed', 'passed', 'result'])),
    esdFirstPass: safeBool(pick(row, ['esdfirstpass', 'esd first pass', 'first pass', 'first try'])),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`ESD row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`ESD row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseEsdFile(buffer, originalName) {
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

  return { source: 'esd', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
