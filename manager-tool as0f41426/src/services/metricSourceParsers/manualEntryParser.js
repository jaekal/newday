// src/services/metricSourceParsers/manualEntryParser.js
// Parses Supervisor Manual Entry CSV uploads.
// Feeds: Development (knowledge sharing, CI participation, leadership support).
import { parseFile, normalizeRowKeys, pick, safeNumber } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'event date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id']),

    knowledgeSharingEvents: safeNumber(pick(row, ['knowledgesharingevents', 'knowledge sharing events', 'knowledge sharing', 'mentoring'])),
    ciParticipationEvents: safeNumber(pick(row, ['ciparticipationevents', 'ci participation events', 'ci participation', 'kaizen'])),
    leadershipSupportEvents: safeNumber(pick(row, ['leadershipsupportevents', 'leadership support events', 'leadership support', 'leadership'])),
    notes: pick(row, ['notes', 'comment', 'comments', 'description']),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`Manual row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`Manual row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseManualEntryFile(buffer, originalName) {
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

  return { source: 'manual', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
