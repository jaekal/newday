// src/utils/importFile.js
import multer from 'multer';
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

export function createMemoryUpload(maxMb = 3) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
  });
}

export function normalizeImportRow(raw) {
  const row = {};
  for (const key of Object.keys(raw || {})) {
    row[String(key || '').trim()] = raw[key];
  }
  return row;
}

export function parseUploadedRows(file, options = {}) {
  if (!file?.buffer) {
    throw new Error('No file provided.');
  }

  const {
    cellDates = false,
    raw = false,
    trim = true,
    skipEmptyLines = true,
  } = options;

  const lower = String(file.originalname || '').toLowerCase();
  const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls');
  const isCsv = lower.endsWith('.csv');

  if (!isExcel && !isCsv) {
    throw new Error('Unsupported file type. Upload CSV or Excel.');
  }

  if (isExcel) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw });
  }

  const text = file.buffer.toString('utf8');
  return parse(text, {
    columns: true,
    skip_empty_lines: skipEmptyLines,
    trim,
  });
}
