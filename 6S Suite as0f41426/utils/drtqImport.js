import { createHash } from 'crypto';

function decodeHexChar(_match, hex) {
  return String.fromCharCode(Number.parseInt(hex, 16));
}

function normalizeWhitespace(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function rtfToPlainText(rtf = '') {
  let text = String(rtf || '');
  text = text
    .replace(/\\par[d]?/gi, '\n')
    .replace(/\\line/gi, '\n')
    .replace(/\\tab/gi, '\t')
    .replace(/\\u(-?\d+)\??/g, (_match, code) => {
      const value = Number.parseInt(code, 10);
      if (!Number.isFinite(value)) return '';
      return String.fromCharCode(value < 0 ? value + 65536 : value);
    })
    .replace(/\\'([0-9a-fA-F]{2})/g, decodeHexChar)
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '');

  return normalizeWhitespace(text);
}

function matchLine(text, pattern) {
  return text.match(pattern)?.[1]?.trim() || '';
}

function parseNumber(raw = '') {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseValueWithUnit(raw = '') {
  const text = String(raw || '').trim();
  const match = text.match(/(-?\d+(?:\.\d+)?)(?:\s+(.+))?$/);
  if (!match) return { value: null, unit: '', raw: text };
  return {
    value: parseNumber(match[1]),
    unit: String(match[2] || '').trim(),
    raw: text,
  };
}

function parseIntegerLine(text, label) {
  const pattern = new RegExp(`${label}:\\s*([0-9]+)`, 'i');
  const value = parseNumber(matchLine(text, pattern));
  return Number.isFinite(value) ? value : 0;
}

function parseReadingLines(text) {
  const readings = [];
  const lines = String(text || '').split('\n');
  let readingSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^Reading\s*#\s+Peak/i.test(line)) {
      readingSection = true;
      continue;
    }
    if (!readingSection) continue;

    const match = line.match(/^(\d+)\s+(-?\d+(?:\.\d+)?)/);
    if (!match) continue;
    readings.push({
      index: Number.parseInt(match[1], 10),
      peak: parseNumber(match[2]),
    });
  }

  return readings.filter((item) => Number.isFinite(item.index) && Number.isFinite(item.peak));
}

function deriveStatus(summary = {}, readings = []) {
  const min = summary.minimumTorqueLimit?.value;
  const max = summary.maximumTorqueLimit?.value;
  const outside = readings.filter((reading) => (
    (min != null && reading.peak < min) ||
    (max != null && reading.peak > max)
  ));
  const importedAbove = Number(summary.readingsAboveMaximum || 0);
  const importedBelow = Number(summary.readingsBelowMinimum || 0);
  const notOkPercent = summary.percentageNotOk;
  const allInSpec = readings.length > 0 &&
    importedAbove === 0 &&
    importedBelow === 0 &&
    outside.length === 0 &&
    (notOkPercent == null || notOkPercent === 0);

  return {
    readingCount: readings.length,
    outsideCount: outside.length,
    allInSpec,
    outsideReadings: outside.slice(0, 25),
  };
}

export function parseDrtqExport(content = '', fileName = '') {
  const plainText = rtfToPlainText(content);
  const warnings = [];
  const measurementDirection = matchLine(plainText, /Measurement direction:\s*(.+)/i);
  const job = matchLine(plainText, /Job:\s*(.+)/i);
  const date = matchLine(plainText, /Date:\s*([0-9/.-]+)/i);
  const time = matchLine(plainText, /Time:\s*([0-9:]+)/i);
  const unitSerialNumber = matchLine(plainText, /Unit S\/N:\s*([^\n]+)/i).split(/\s{2,}/)[0].trim();
  const transducer = matchLine(plainText, /Transducer:\s*([^\n]+)/i);
  const maximumTorqueLimit = parseValueWithUnit(matchLine(plainText, /Maximum Torque Limit:\s*([^\n]+)/i));
  const minimumTorqueLimit = parseValueWithUnit(matchLine(plainText, /Minimum Torque Limit:\s*([^\n]+)/i));
  const thresholdTorqueLimit = parseValueWithUnit(matchLine(plainText, /Threshold Torque Limit:\s*([^\n]+)/i));
  const peakTimeSeconds = parseValueWithUnit(matchLine(plainText, /Peak Time:\s*([^\n]+)/i)).value;
  const maximumRecorded = parseValueWithUnit(matchLine(plainText, /Maximum recorded:\s*([^\n]+)/i));
  const minimumRecorded = parseValueWithUnit(matchLine(plainText, /Minimum recorded:\s*([^\n]+)/i));
  const sigma = parseNumber(matchLine(plainText, /Sigma:\s*([^\n]+)/i));
  const cp = parseNumber(matchLine(plainText, /Cp:\s*([^\n]+)/i));
  const cpk = parseNumber(matchLine(plainText, /Cpk:\s*([^\n]+)/i));
  const percentageNotOk = parseNumber(matchLine(plainText, /Percentage not OK:\s*([0-9.]+)/i));
  const readingsAboveMaximum = parseIntegerLine(plainText, 'Readings above maximum');
  const readingsBelowMinimum = parseIntegerLine(plainText, 'Readings below minimum');
  const readings = parseReadingLines(plainText);

  if (!readings.length) warnings.push('No torque readings were found in the DRTQ export.');
  if (maximumTorqueLimit.value == null) warnings.push('Maximum torque limit was not found.');
  if (minimumTorqueLimit.value == null) warnings.push('Minimum torque limit was not found.');

  const derived = deriveStatus({
    maximumTorqueLimit,
    minimumTorqueLimit,
    percentageNotOk,
    readingsAboveMaximum,
    readingsBelowMinimum,
  }, readings);

  return {
    type: 'torque-import',
    label: 'Torque Import',
    fileName: String(fileName || '').trim(),
    sourceHash: createHash('sha1').update(String(content || ''), 'utf8').digest('hex'),
    plainTextPreview: plainText.slice(0, 4000),
    importedAt: new Date().toISOString(),
    warnings,
    summary: {
      date,
      time,
      job,
      unitSerialNumber,
      transducer,
      measurementDirection,
      maximumTorqueLimit,
      minimumTorqueLimit,
      thresholdTorqueLimit,
      peakTimeSeconds,
      maximumRecorded,
      minimumRecorded,
      sigma,
      cp,
      cpk,
      percentageNotOk,
      readingsAboveMaximum,
      readingsBelowMinimum,
    },
    readings,
    ...derived,
  };
}
