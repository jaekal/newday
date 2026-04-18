// src/services/metricSourceParsers/testDashParser.js
// Parses MongoDB Testing Dashboard CSV exports.
// Feeds: Troubleshooting (100%), Quality (100%) metrics.
import { parseFile, normalizeRowKeys, pick, safeNumber } from './parserUtils.js';

function normalizeRow(raw) {
  const row = normalizeRowKeys(raw);
  return {
    date: pick(row, ['date', 'work date', 'test date', 'metric date']),
    employeeId: pick(row, ['employeeid', 'employee id', 'emp id', 'badge id', 'technician id']),
    testStage: pick(row, ['teststage', 'test stage', 'stage', 'test phase']),

    unitsPassedFirstRerun: safeNumber(pick(row, ['unitspassedfirstrerun', 'units passed first rerun', 'first time fix units', 'ftf units'])),
    unitsEventuallyPassed: safeNumber(pick(row, ['unitseventuallypassed', 'units eventually passed'])),
    successfulReruns: safeNumber(pick(row, ['successfulreruns', 'successful reruns', 'reruns passed'])),
    totalReruns: safeNumber(pick(row, ['totalreruns', 'total reruns', 'rerun attempts'])),
    escalatedUnits: safeNumber(pick(row, ['escalatedunits', 'escalated units', 'escalations'])),
    totalFailedUnitsWorked: safeNumber(pick(row, ['totalfailedunitsworked', 'total failed units worked', 'failures handled'])),

    totalAttemptsToPass: safeNumber(pick(row, ['totalattemptstopass', 'total attempts to pass', 'attempts sum'])),
    passedRepairUnitCount: safeNumber(pick(row, ['passedrepairunitcount', 'passed repair unit count', 'units passing repair'])),
    mttrMinutesTotal: safeNumber(pick(row, ['mttrminutestotal', 'mttr minutes total', 'total repair time', 'repair time minutes'])),
    mttrSampleCount: safeNumber(pick(row, ['mttrsamplecount', 'mttr sample count', 'mttr samples'])),

    postTestEscapes: safeNumber(pick(row, ['posttestescapes', 'post test escapes', 'escapes'])),
    repeatFailures: safeNumber(pick(row, ['repeatfailures', 'repeat failures', 'repeat fails'])),
    repairedUnitsForRepeatCheck: safeNumber(pick(row, ['repairedunitsforrepeatcheck', 'repaired units for repeat check'])),
    inspectionIssuesCaught: safeNumber(pick(row, ['inspectionissuescaught', 'inspection issues caught'])),
    totalIssuesFound: safeNumber(pick(row, ['totalissuesfound', 'total issues found'])),
    incorrectRepairActions: safeNumber(pick(row, ['incorrectrepairactions', 'incorrect repair actions', 'wrong repairs'])),
    totalRepairActions: safeNumber(pick(row, ['totalrepairactions', 'total repair actions'])),
    technicianAttributedDefects: safeNumber(pick(row, ['technicianattributeddefects', 'technician attributed defects', 'tech defects'])),
  };
}

function validate(row, rowNum) {
  const issues = [];
  if (!row.date) issues.push(`TestDash row ${rowNum}: missing date.`);
  if (!row.employeeId) issues.push(`TestDash row ${rowNum}: missing employeeId.`);
  return issues;
}

export function parseTestDashFile(buffer, originalName) {
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

  return { source: 'testDash', rows, issues, totalRows: rawRows.length, acceptedRows: rows.length };
}
