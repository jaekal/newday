// src/services/staff/staffShared.js
import multer from 'multer';

export const CANON_HEADERS = [
  'name',
  'username',
  'email',
  'role',
  'phone',
  'avatarPath',

  'employeeId',
  'positionType',
  'startDate',
  'tenureLabel',
  'dateOfBirth',

  'carMake',
  'carModel',
  'licensePlate',

  'domainName',
  'domainUsername',

  'highestEducationLevel',
  'schoolName',
  'degreeName',
  'fieldOfStudy',
  'graduationYear',
  'certificationsText',

  'rosterBuilding',
  'rosterShift',
];

export function createMemoryUpload(maxMb = 2) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024 },
  });
}

export function createDocUpload(destinationDir) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      cb(null, destinationDir);
    },
    filename(req, file, cb) {
      const ext = file.originalname.includes('.')
        ? file.originalname.slice(file.originalname.lastIndexOf('.'))
        : '';
      const base = file.originalname
        .replace(ext, '')
        .replace(/\s+/g, '_')
        .replace(/[^\w.-]/g, '');
      cb(null, `${base}_${Date.now()}${ext}`);
    },
  });

  function fileFilter(req, file, cb) {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error('Unsupported file type. Please upload PDF, DOC/DOCX, PNG, or JPG.'),
        false
      );
    }
    cb(null, true);
  }

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter,
  });
}

export const stripBom = (s) => String(s || '').replace(/^\uFEFF/, '');
export const cleanHeader = (h) => stripBom(h).trim().replace(/\s+/g, ' ');
export const normalizeKey = (k) => cleanHeader(k).toLowerCase();
export const normalizeStr = (v) => (v == null ? '' : String(v).trim());
export const normalizeEmail = (v) => normalizeStr(v).toLowerCase();
export const normalizeUsername = (v) => normalizeStr(v).toLowerCase();
export const toUpper = (v) => (v ? String(v).trim().toUpperCase() : '');
export const safeNull = (v) => (v && String(v).trim() !== '' ? String(v).trim() : null);

export const slugify = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');

export const genFallbackUsername = ({ employeeId, name }) => {
  return employeeId ? `emp.${employeeId}` : slugify(name) || 'user';
};

export const genFallbackEmail = ({ employeeId, username }) => {
  const local = employeeId ? `emp.${employeeId}` : username || 'user';
  return `${local}@local.invalid`;
};

export function normalizeRowKeys(raw) {
  const out = {};
  Object.keys(raw || {}).forEach((k) => {
    const ck = cleanHeader(k);
    out[ck] = typeof raw[k] === 'string' ? raw[k].trim() : raw[k];
  });
  return out;
}

export function makeGetVal(row) {
  const map = new Map();
  Object.keys(row || {}).forEach((k) => map.set(normalizeKey(k), k));

  return (...keys) => {
    for (const k of keys) {
      if (k in row) {
        const v = row[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }

      const found = map.get(normalizeKey(k));
      if (found) {
        const v = row[found];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return '';
  };
}

export function normalizeDomainUsername(value) {
  let v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  const slashIdx = v.lastIndexOf('\\');
  if (slashIdx !== -1) v = v.slice(slashIdx + 1);
  const atIdx = v.indexOf('@');
  if (atIdx !== -1) v = v.slice(0, atIdx);
  return v.replace(/^"+|"+$/g, '').trim();
}