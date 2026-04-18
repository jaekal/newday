// src/services/metricSourceParsers/parserUtils.js
// Shared utilities for all source parsers — mirrors metricImportParser.js helpers.
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

export function cleanHeader(h) {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeKey(h) {
  return cleanHeader(h)
    .toLowerCase()
    .replace(/[.\-\/()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeRowKeys(raw) {
  const out = {};
  for (const key of Object.keys(raw || {})) {
    out[normalizeKey(key)] = raw[key];
  }
  return out;
}

export function pick(row, aliases = [], fallback = '') {
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const val = row[key];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val).trim();
      }
    }
  }
  return fallback;
}

export function safeNumber(value, fallback = '') {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeBool(value) {
  if (value === '' || value == null) return '';
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(v)) return true;
  if (['0', 'false', 'no', 'n'].includes(v)) return false;
  return '';
}

export function parseFile(buffer, originalName) {
  const lower = String(originalName || '').toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');

  if (!isExcel && !isCsv) {
    throw new Error('Unsupported file type. Upload CSV or Excel.');
  }

  if (isExcel) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  const text = buffer.toString('utf8');
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}
