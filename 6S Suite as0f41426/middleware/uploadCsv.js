// middleware/uploadCsv.js
import multer from 'multer';
import path from 'path';

/**
 * Environment knobs (all optional)
 * CSV_MAX_UPLOAD_MB     — max upload size in MiB (default 5)
 * CSV_MAX_ROWS          — max row count (default 100000)
 * CSV_SNIFF_BYTES       — bytes to sniff for "textiness" (default 512 KiB)
 * CSV_ALLOW_SEMICOLON   — treat ';' as a valid delimiter (default true)
 */
const MAX_UPLOAD_MB   = Number(process.env.CSV_MAX_UPLOAD_MB || 5);
const MAX_BYTES       = Math.max(1, MAX_UPLOAD_MB) * 1024 * 1024;

const MAX_ROWS        = Number.isFinite(Number(process.env.CSV_MAX_ROWS))
  ? Math.max(1, Number(process.env.CSV_MAX_ROWS))
  : 100_000;

const SNIFF_BYTES     = Number.isFinite(Number(process.env.CSV_SNIFF_BYTES))
  ? Math.max(4_096, Number(process.env.CSV_SNIFF_BYTES))
  : 512 * 1024;

const ALLOW_SEMICOLON = String(process.env.CSV_ALLOW_SEMICOLON ?? 'true').toLowerCase() !== 'false';

const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel', // common for legacy exporters
  'application/octet-stream', // some browsers fall back to this
]);

/**
 * Multer filter: only allow CSV-like uploads by ext or MIME.
 * We still sniff after upload to block disguised binaries.
 */
function fileFilter(_req, file, cb) {
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  if (ext === '.csv' || ALLOWED_MIME.has(file.mimetype)) return cb(null, true);

  const err = new Error('INVALID_FILE_TYPE');
  err.code = 'LIMIT_FILE_TYPES';
  cb(err);
}

// Base multer instance (memory storage so we can sniff the buffer)
export const uploadCsvMulter = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter,
});

/**
 * Simple binary/sniffing heuristic:
 * - Rejects if too many non-text bytes in the first SNIFF_BYTES
 * - Rejects if row count exceeds MAX_ROWS
 * - Light delimiter sanity ("," or ";" optionally)
 */
function sniffCsv(req, _res, next) {
  if (!req.file || !req.file.buffer) {
    const err = new Error('No file uploaded');
    err.status = 400;
    err.code = 'CSV_MISSING';
    return next(err);
  }

  const buf = req.file.buffer;
  const len = Math.min(buf.length, SNIFF_BYTES);

  // Allow printable ASCII, tab, CR, LF, quote, comma/semicolon, BOM
  let suspicious = 0;
  let printable = 0;
  let hasNul = false;

  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b === 0) { hasNul = true; suspicious++; continue; }              // NUL almost always means binary
    if (b === 0xef && i + 2 < len && buf[i + 1] === 0xbb && buf[i + 2] === 0xbf) { // UTF-8 BOM
      i += 2; continue;
    }
    if (
      b === 9  || // \t
      b === 10 || // \n
      b === 13 || // \r
      b === 34 || // "
      b === 44 || // ,
      (ALLOW_SEMICOLON && b === 59) || // ;
      (b >= 32 && b <= 126)            // printable ASCII
    ) {
      printable++;
    } else {
      // allow some UTF-8 multibyte starts (best-effort)
      if (b >= 0xC2 && b <= 0xF4) { printable++; continue; }
      suspicious++;
    }
  }

  // If more than 2% of bytes look binary-ish (or any NULs), reject
  if (hasNul || suspicious > len * 0.02) {
    const err = new Error('The uploaded file does not look like a text CSV.');
    err.code = 'CSV_NOT_TEXTY';
    err.status = 400;
    return next(err);
  }

  // Count lines quickly; cap by MAX_ROWS
  // We look at the full buffer to avoid "row bombs" after first SNIFF_BYTES
  let rows = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) rows++; // '\n'
    if (rows > MAX_ROWS) {
      const err = new Error(`CSV contains too many rows (>${MAX_ROWS}).`);
      err.code = 'CSV_TOO_MANY_ROWS';
      err.status = 400;
      return next(err);
    }
  }

  // Naive delimiter sanity: file should contain a comma or semicolon
  const head = buf.subarray(0, Math.min(buf.length, 8 * 1024)).toString('utf8');
  const hasComma = head.indexOf(',') !== -1;
  const hasSemi  = head.indexOf(';') !== -1;
  if (!hasComma && !(ALLOW_SEMICOLON && hasSemi)) {
    // Tolerate 1-column CSV, but warn by attaching a hint
    req.file._csvMaybeSingleColumn = true;
  }

  // Attach quick header guess for callers that want it
  const firstLine = head.split(/\r?\n/, 1)[0] || '';
  req.file._csvHeader = firstLine;

  return next();
}

/**
 * Backwards-compatible export (drop-in for existing code):
 *   router.post('/import', uploadCsv, handler)
 *
 * This runs multer's .single('file') and then sniffs the buffer.
 */
export const uploadCsv = (req, res, next) => {
  uploadCsvMulter.single('file')(req, res, (err) => {
    if (err) return next(err);
    return sniffCsv(req, res, next);
  });
};

/**
 * If you prefer explicit composition in routes:
 *   router.post('/import', uploadCsvMulter.single('file'), ensureCsvReadable, handler)
 */
export const ensureCsvReadable = sniffCsv;

/**
 * Convenience array middleware:
 *   router.post('/import', uploadCsvStrict, handler)
 */
export const uploadCsvStrict = [uploadCsvMulter.single('file'), sniffCsv];
