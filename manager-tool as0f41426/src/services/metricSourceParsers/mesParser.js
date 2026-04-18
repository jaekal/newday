// src/services/metricSourceParsers/mesParser.js
// Parses MES (Manufacturing Execution System) CSV exports.
// Feeds: Productivity metrics, partial Quality/Troubleshooting context fields.
import { parseFile, normalizeRowKeys, pick, safeNumber } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'work date', 'workdate', 'metric date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id', 'badge']),
    building: pick(row, ['building', 'facility', 'site']),
    shift: pick(row, ['shift']),
    area: pick(row, ['area', 'zone', 'department', 'line']),
    productFamily: pick(row, ['productfamily', 'product family', 'product', 'product line']),

    serversAssigned: safeNumber(pick(row, ['serversassigned', 'servers assigned', 'units assigned'])),
    serversCompleted: safeNumber(pick(row, ['serverscompleted', 'servers completed', 'units completed'])),
    racksAssigned: safeNumber(pick(row, ['racksassigned', 'racks assigned'])),
    racksCompleted: safeNumber(pick(row, ['rackscompleted', 'racks completed'])),
    expectedCheckActions: safeNumber(pick(row, ['expectedcheckactions', 'expected check actions', 'required checks'])),
    validCheckActions: safeNumber(pick(row, ['validcheckactions', 'valid check actions', 'checks performed'])),
    inspectionsExpected: safeNumber(pick(row, ['inspectionsexpected', 'inspections expected', 'required inspections'])),
    inspectionsCompleted: safeNumber(pick(row, ['inspectionscompleted', 'inspections completed', 'inspections done'])),
    unitsRepaired: safeNumber(pick(row, ['unitsrepaired', 'units repaired', 'repairs performed'])),
    unitsHandled: safeNumber(pick(row, ['unitshandled', 'units handled', 'units touched'])),
    unitsPassed: safeNumber(pick(row, ['unitspassed', 'units passed'])),

    excludedSystemDelayMinutes: safeNumber(pick(row, ['excludedsystemdelayminutes', 'excluded system delay minutes', 'system delay', 'system downtime'])),
    excludedPartWaitMinutes: safeNumber(pick(row, ['excludedpartwaitminutes', 'excluded part wait minutes', 'part wait', 'parts wait time'])),
    excludedInfraMinutes: safeNumber(pick(row, ['excludedinframinutes', 'excluded infra minutes', 'infra downtime'])),
    complexityMultiplier: safeNumber(pick(row, ['complexitymultiplier', 'complexity multiplier', 'complexity factor']), 1),
    sourceBatchId: pick(row, ['sourcebatchid', 'source batch id', 'batch id', 'lot id']),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`MES row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`MES row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseMesFile(buffer, originalName) {
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

  return { source: 'mes', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
