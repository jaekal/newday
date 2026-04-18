// src/routes/esd.js
import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';

import { User, StaffProfile, EsdCheck } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

router.get(
  '/',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  (req, res) => {
    return res.redirect('/esd/import');
  }
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

/**
 * Helper: normalize keys → case-insensitive map
 */
function normalizeRow(raw) {
  const row = {};
  Object.keys(raw).forEach((key) => {
    const k = key.trim();
    row[k] =
      typeof raw[key] === 'string' ? raw[key].trim() : raw[key];
  });
  return row;
}

/**
 * Helper: extract typed fields from row
 * Expected columns (case-insensitive-ish):
 *   LogDateTime
 *   Emp.Id
 *   Name
 *   Result
 */
function extractEsdFields(row) {
  // Support a few variants just in case
  const logDateTimeRaw =
    row['LogDateTime'] ??
    row['logDateTime'] ??
    row['LOGDATETIME'] ??
    row['Log Date Time'] ??
    row['Log Date'];

  const employeeId =
    row['Emp.Id'] ??
    row['Emp ID'] ??
    row['Employee ID'] ??
    row['employeeId'] ??
    row['EmpId'];

  const name =
    row['Name'] ??
    row['Employee Name'] ??
    row['EMPLOYEE NAME'];

  const resultRaw =
    row['Result'] ??
    row['RESULT'] ??
    row['Status'] ??
    row['ESD Result'];

  return {
    logDateTimeRaw,
    employeeId: employeeId ? String(employeeId).trim() : '',
    name: name ? String(name).trim() : '',
    result: resultRaw ? String(resultRaw).trim() : '',
  };
}

/**
 * Helper: convert LogDateTime into JS Date
 * - Handles string
 * - Handles Date
 * - Handles Excel date serial (number)
 */
function parseLogDateTime(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    // Excel date serial → assume days since 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * GET /esd/import
 * Simple upload page
 */
router.get(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  async (req, res) => {
    res.render('esd/import', {
      importSummary: null,
      importError: null,
    });
  }
);

/**
 * POST /esd/import
 * Accepts CSV / Excel with columns:
 *   LogDateTime, Emp.Id, Name, Result
 * For each row:
 *   - Resolve staff via StaffProfile.employeeId → User
 *   - Append EsdCheck
 *   - If duplicate (same staffId + logDateTime + result) → counted as duplicate
 */
router.post(
  '/import',
  ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).render('esd/import', {
        importSummary: null,
        importError: 'No file uploaded.',
      });
    }

    const originalName = req.file.originalname.toLowerCase();
    const isExcel =
      originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
    const isCsv = originalName.endsWith('.csv');

    if (!isExcel && !isCsv) {
      return res.status(400).render('esd/import', {
        importSummary: null,
        importError: 'Unsupported file type. Please upload CSV or Excel (.xlsx).',
      });
    }

    let rows = [];
    try {
      if (isExcel) {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } else if (isCsv) {
        const text = req.file.buffer.toString('utf8');
        rows = parse(text, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      }
    } catch (err) {
      console.error('ESD IMPORT → parse error:', err);
      return res.status(400).render('esd/import', {
        importSummary: null,
        importError: 'Failed to parse file. Check format and headers.',
      });
    }

    let created = 0;
    let duplicates = 0;
    let noStaffFound = 0;
    let invalidRows = 0;
    const errorDetails = [];

    for (const raw of rows) {
      const row = normalizeRow(raw);
      const {
        logDateTimeRaw,
        employeeId,
        name,
        result,
      } = extractEsdFields(row);

      if (!logDateTimeRaw || !result || (!employeeId && !name)) {
        invalidRows++;
        errorDetails.push(
          `Missing required data (LogDateTime, Result, or Emp.Id/Name). Row: employeeId="${employeeId}", name="${name}".`
        );
        continue;
      }

      const logDateTime = parseLogDateTime(logDateTimeRaw);
      if (!logDateTime) {
        invalidRows++;
        errorDetails.push(
          `Invalid LogDateTime (${logDateTimeRaw}) for employeeId="${employeeId}", name="${name}".`
        );
        continue;
      }

      try {
        let staffUser = null;

        if (employeeId) {
          const profile = await StaffProfile.findOne({
            where: { employeeId },
            include: [{ model: User, as: 'User' }],
          });
          staffUser = profile ? profile.User : null;
        }

        // Fallback: try by exact name (not ideal, but better than dropping all rows)
        if (!staffUser && name) {
          staffUser = await User.findOne({ where: { name } });
        }

        if (!staffUser) {
          noStaffFound++;
          errorDetails.push(
            `Staff not found for employeeId="${employeeId}", name="${name}".`
          );
          continue;
        }

        // Check for duplicate (same staff + timestamp + result)
        const existing = await EsdCheck.findOne({
          where: {
            staffId: staffUser.id,
            logDateTime,
            result,
          },
        });

        if (existing) {
          duplicates++;
          continue;
        }

        await EsdCheck.create({
          staffId: staffUser.id,
          employeeId: employeeId || null,
          name: name || staffUser.name || null,
          logDateTime,
          result,
        });

        created++;
      } catch (err) {
        console.error('ESD IMPORT → row error:', err);
        invalidRows++;
        errorDetails.push(
          `Error importing row for employeeId="${employeeId}", name="${name}": ${err.message}`
        );
      }
    }

    const summaryLines = [];
    summaryLines.push(`ESD IMPORT → Records created: ${created}`);
    summaryLines.push(`ESD IMPORT → Duplicates skipped: ${duplicates}`);
    summaryLines.push(`ESD IMPORT → No matching staff: ${noStaffFound}`);
    summaryLines.push(`ESD IMPORT → Invalid/errored rows: ${invalidRows}`);

    if (errorDetails.length > 0) {
      summaryLines.push('Some issues encountered:');
      errorDetails.slice(0, 5).forEach((line) => summaryLines.push(`- ${line}`));
      if (errorDetails.length > 5) {
        summaryLines.push(`...and ${errorDetails.length - 5} more`);
      }
    }

    return res.render('esd/import', {
      importSummary: summaryLines.join('\n'),
      importError: null,
    });
  }
);

export default router;
