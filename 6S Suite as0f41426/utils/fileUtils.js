// utils/fileUtils.js

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import XLSX from 'xlsx';
import { withQueue } from './writeQueue.js';
import { Calibration } from '../models/index.js';

// Allowed image extensions (kept from your original export)
export const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// Env toggles
const JSON_BACKUP = String(process.env.JSON_BACKUP || '0') === '1';

/* ──────────────────────────────────────────────────────────────
   Internal helpers
────────────────────────────────────────────────────────────── */

/** Ensure a directory exists. */
export async function ensureDirExists(dirPath) {
  await fs.mkdir(path.resolve(dirPath), { recursive: true });
}

/** Pads YYYY-MM-DD HH:mm:ss for backup names. */
function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Optionally create a timestamped backup alongside a file. */
async function backupIfEnabled(filePath) {
  if (!JSON_BACKUP) return;
  try {
    if (!fsSync.existsSync(filePath)) return;
    const bak = `${filePath}.bak-${ts()}`;
    await fs.copyFile(filePath, bak);
  } catch (e) {
    // non-fatal
    console.warn(`⚠️ Failed to create JSON backup for ${filePath}:`, e?.message || e);
  }
}

async function writeFileDirect(target, data) {
  // Open with 'w' to truncate or create
  const fh = await fs.open(target, 'w');
  try {
    await fh.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
    try { await fh.sync(); } catch {}
  } finally {
    try { await fh.close(); } catch {}
  }
}

// utils/fileUtils.js  — replace ONLY writeFileAtomic with the block below
async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  await ensureDirExists(dir);

  // configurable retries for Windows/OneDrive
  const MAX_RETRIES = Number(process.env.JSON_RENAME_RETRIES || 8);
  const RETRY_DELAY_MS = Number(process.env.JSON_RENAME_RETRY_DELAY || 120);

  const tmp = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  let fh;
  try {
    fh = await fs.open(tmp, 'w');
    await fh.writeFile(data, typeof data === 'string' ? 'utf8' : undefined);
    await fh.sync();
    await fh.close();

    // Optional backup
    await backupIfEnabled(filePath);


    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await fs.rename(tmp, filePath);
        // fsync dir to persist rename
        try {
          const dh = await fs.open(dir, 'r');
          await dh.sync();
          await dh.close();
        } catch { /* best effort */ }
        return; // success
      } catch (e) {
        lastErr = e;
        const code = String(e && e.code || '').toUpperCase();

        // If it looks like a classic Windows lock, wait and retry
        const retriable =
          code === 'EPERM' ||
          code === 'EBUSY' ||
          code === 'EACCES' ||
          (String(e.message || '').toLowerCase().includes('being used') ||
           String(e.message || '').toLowerCase().includes('access is denied') ||
           String(e.message || '').toLowerCase().includes('locked'));

        if (retriable && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        // Final fallback on Windows/OneDrive: non-atomic replace
        if (retriable) {
          try {
            // Try unlink target first (ignore errors)
            try { await fs.unlink(filePath); } catch {}
            // Copy tmp to final
            await fs.copyFile(tmp, filePath);
            // Ensure flushed best-effort by reopening and syncing
            try {
              const fh2 = await fs.open(filePath, 'r');
              await fh2.sync();
              await fh2.close();
            } catch {}
            // Remove temp file
            try { await fs.unlink(tmp); } catch {}
            return;
          } catch (copyErr) {
            // fall-through to throw below with original + copy errors
            lastErr = copyErr;
          }
        }
        // Non-retriable: break and throw
        break;
      }
    }

    // If we got here, all attempts failed
    throw lastErr || new Error('rename failed');
  } catch (e) {
    // Clean up temp
    try { await fs.unlink(tmp); } catch {}
    throw e;
  }

  // Cleanup tmp if we reached here successfully
  try { await fs.unlink(tmp); } catch {}

  // Best-effort dir fsync
  try {
    const dh = await fs.open(dir, 'r');
    try { await dh.sync(); } finally { await dh.close(); }
  } catch { /* ignore */ }
}

/* ──────────────────────────────────────────────────────────────
   JSON helpers
────────────────────────────────────────────────────────────── */

/**
 * Read JSON safely. If missing, create with fallback.
 * If corrupt, back up the bad file and return the fallback.
 * @template T
 * @param {string} filePath
 * @param {T} [fallback=[]]
 * @returns {Promise<T>}
 */
export async function loadJSON(filePath, fallback = []) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    // Include a trimmed stack so we can trace which caller lost its path —
    // this almost always means an app.get('xxxPath') lookup resolved to
    // undefined because initData failed to register the key.
    const stack = (new Error().stack || '').split('\n').slice(2, 5).join('\n');
    console.warn(`⚠️ loadJSON called without a file path; returning fallback.\n${stack}`);
    return fallback;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Create missing file with fallback
      await ensureDirExists(path.dirname(filePath));
      await writeFileAtomic(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    } else {
      // Backup corrupt file for later inspection
      try {
        if (fsSync.existsSync(filePath)) {
          const bak = `${filePath}.corrupt-${Date.now()}.bak`;
          await fs.copyFile(filePath, bak);
          console.warn(`⚠️ Backed up corrupt JSON to ${bak}`);
        }
      } catch { /* ignore */ }
      console.error(`❌ Failed to read JSON from ${filePath}:`, err?.message || err);
      return fallback;
    }
  }
}

/**
 * Save JSON with per-file queue + durable atomic write.
 * @param {string} filePath
 * @param {any} data
 */
export async function saveJSON(filePath, data) {
  const serialized = JSON.stringify(data, null, 2);
  await withQueue(filePath, async () => {
    await writeFileAtomic(filePath, serialized);
  });
}

/**
 * Read, modify, validate, and conditionally write JSON — all serialized
 * via the file queue so concurrent writers don’t corrupt the file.
 *
 * @template T
 * @param {string} filePath
 * @param {(current: T) => Promise<T>|T} updater  - return the new value (or the same to skip write)
 * @param {(newValue: T) => void | string} [validate] - throw/return error message to reject
 * @param {T} [fallback] - used if file missing/corrupt
 * @returns {Promise<{ changed: boolean, value: T }>}
 */
export async function readModifyWriteJSON(filePath, updater, validate, fallback = []) {
  let result = { changed: false, value: fallback };
  await withQueue(filePath, async () => {
    const current = await loadJSON(filePath, fallback);
    const next = await Promise.resolve(updater(current));
    if (next === current) {
      result = { changed: false, value: current };
      return;
    }
    if (typeof validate === 'function') {
      const maybeErr = validate(next);
      if (typeof maybeErr === 'string') {
        const e = new Error(maybeErr);
        // @ts-ignore
        e.code = 'VALIDATION_FAILED';
        throw e;
      }
    }
    await writeFileAtomic(filePath, JSON.stringify(next, null, 2));
    result = { changed: true, value: next };
  });
  return result;
}

/* ──────────────────────────────────────────────────────────────
   Domain-specific helpers (tools, data loading, excel)
────────────────────────────────────────────────────────────── */

function s(v) { return (v == null ? '' : String(v)).trim(); }

/**
 * Saves tools back to file in their original format.
 */
export async function saveToolsToOriginalFormat(filePath, tools) {
  const formatted = tools.map(t => ({
    SerialNumber:        t.serialNumber || '',
    Slot:                t.slot || '',
    Torque:              t.torque || '',
    Classification:      t.classification || '',
    Description:         t.description || '',
    Model:               t.model || '',
    CalibrationStatus:   t.calibrationStatus || '',
    Status:              t.status || '',
    LastCalibrationDate: t.calibrationDate || '',
    NextCalibrationDue:  t.nextCalibrationDue || '',
    OperatorId:          t.operatorId || '',
    Timestamp:           t.timestamp || ''
  }));
  await saveJSON(filePath, formatted);
}

/**
 * Loads and normalizes all data into memory.
 * Tolerates both legacy (PascalCase) and new (camelCase) shapes.
 * Removes the noisy "No valid tools…" warning by accepting either key.
 */
export async function loadData({ employeePath, toolDataPath, calibrationPath, logFilePath }) {
  await Promise.all(
    [employeePath, toolDataPath, logFilePath].map(p =>
      ensureDirExists(path.dirname(p))
    )
  );

  const [rawEmp, rawTools, entries] = await Promise.all([
    loadJSON(employeePath, []),
    loadJSON(toolDataPath, []),
    loadJSON(logFilePath, [])
  ]);

  // Read calibration from SQLite; fall back to the JSON file if the table is
  // empty (pre-migration) or if the import fails.
  let calibrationData = [];
  try {
    const rows = await Calibration.findAll({ raw: true });
    if (rows.length > 0) {
      // Remap DB column names to the legacy PascalCase shape expected by the
      // merge loop below so no downstream code needs to change.
      calibrationData = rows.map(r => ({
        SerialNumber:       r.serialNumber,
        Slot:               r.slot,
        Torque:             r.torque,
        Category:           r.category,
        Description:        r.description,
        Model:              r.model,
        LastCalibrationDate: r.lastCalibrationDate,
        NextCalibrationDue:  r.nextCalibrationDue,
        CalibrationStatus:   r.calibrationStatus,
      }));
    } else {
      // Table empty — fall back to JSON so the screwdriver page keeps working
      // before the migration script has been run.
      calibrationData = await loadJSON(calibrationPath, []);
    }
  } catch (e) {
    console.warn('[loadData] Calibration DB read failed, falling back to JSON:', e?.message || e);
    calibrationData = await loadJSON(calibrationPath, []);
  }

  const employees = rawEmp.map(e => ({
    id:       s(e.id ?? e['Employee ID']).toLowerCase(),
    name:     s(e.name ?? e['Name']),
    role:     s(e.role ?? e['Role']),
    building: s(e.building ?? e['Building']),
    shift:    Number(e.shift ?? e['Shift'] ?? 1)
  }));

  const tools = rawTools
    .map(item => {
      const serialNumber = s(item.SerialNumber ?? item.serialNumber);
      if (!serialNumber) return null;
      return {
        serialNumber,
        slot:               s(item.Slot ?? item.slot),
        torque:             s(item.Torque ?? item.torque),
        classification:     s(item.Classification ?? item.classification),
        description:        s(item.Description ?? item.description),
        model:              s(item.Model ?? item.model),
        calibrationStatus:  s(item.CalibrationStatus ?? item.calibrationStatus),
        status:             s(item.Status ?? item.status ?? 'in inventory').toLowerCase() === 'being used' ? 'being used' : 'in inventory',
        calibrationDate:    s(item.LastCalibrationDate ?? item.calibrationDate),
        nextCalibrationDue: s(item.NextCalibrationDue ?? item.nextCalibrationDue),
        operatorId:         s(item.OperatorId ?? item.operatorId).toLowerCase(),
        timestamp:          s(item.Timestamp ?? item.timestamp)
      };
    })
    .filter(Boolean);

  // Merge calibration overlay from either shape
  calibrationData.forEach(c => {
    const cSerial = s(c.SerialNumber ?? c.serialNumber);
    if (!cSerial) return;
    const tool = tools.find(t => t.serialNumber === cSerial);
    if (tool) {
      tool.calibrationDate    = s(c['Calibration Date'] ?? c.calibrationDate ?? tool.calibrationDate);
      tool.nextCalibrationDue = s(c.NextCalibrationDue   ?? c.nextCalibrationDue ?? tool.nextCalibrationDue);
      tool.calibrationStatus  = s(c.CalibrationStatus    ?? c.calibrationStatus  ?? tool.calibrationStatus);
    }
  });

  return { employees, tools, calibrationData, entries };
}

/**
 * Update JSON and Excel logs with retries, guarded by per-file queues for BOTH JSON and XLSX writes.
 */
export async function updateLogAndExcel(
  { logFilePath, excelFilePath },
  entries,
  maxAttempts = 3,
  delay = 300
) {
  // Queue the JSON write
  await withQueue(logFilePath, async () => {
    await writeFileAtomic(logFilePath, JSON.stringify(entries, null, 2));
  });

  // Queue the Excel write (separate key so JSON + XLSX can be independent)
  await withQueue(excelFilePath, async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await ensureDirExists(path.dirname(excelFilePath));
        const sheet = XLSX.utils.json_to_sheet(entries);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, sheet, 'Log');

        // Use sync write wrapped in a queued task to reduce EBUSY contention on Windows
        XLSX.writeFile(wb, excelFilePath);
        return;
      } catch (err) {
        if ((err.code === 'EBUSY' || isLockedError(err)) && attempt < maxAttempts) {
          await new Promise(res => setTimeout(res, delay));
        } else {
          console.error('❌ Excel write failed:', err);
          throw err;
        }
      }
    }
  });
}

// Best-effort detection for locked file errors
function isLockedError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('busy') || msg.includes('being used') || msg.includes('locked');
}

/** Check whether a file exists. */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Delete a file if it exists. */
export async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
