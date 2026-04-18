// config/path.js
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Resolve current directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow moving data dir out of OneDrive (Windows lock issues):
// Prefer SIXS_DATA_DIR, fallback to DATA_DIR, otherwise default to repo ./data
const ENV_DATA = process.env.SIXS_DATA_DIR || process.env.DATA_DIR || null;
const DATA_DIR = ENV_DATA ? path.resolve(ENV_DATA) : path.join(__dirname, '../data');

// Ensure data dir exists early
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }

// UNC default (override with SHARED_DIR when deploying elsewhere)
const SHARED_FOLDER =
  process.env.SHARED_DIR ||
  path.resolve('\\\\ztgroup.com\\filevault\\Productionshared\\Test\\Screwdriver Log');

export const PATHS = {
  SHARED_FOLDER,
  DATA_DIR,

  // Core JSON stores
  EMPLOYEE_PATH:    path.join(DATA_DIR, 'employees.json'),
  TOOL_PATH:        path.join(DATA_DIR, 'tools.json'),
  CALIBRATION_PATH: path.join(DATA_DIR, 'calibration.json'),
  USER_PATH:        path.join(DATA_DIR, 'users.json'),
  EMPLOYEE_ID_ALIASES_PATH: path.join(DATA_DIR, 'employee-id-aliases.json'),

  // New: JSON files used by upcoming modules
  PROJECTS_PATH:    path.join(DATA_DIR, 'projects.json'),
  AUDITS_PATH:      path.join(DATA_DIR, 'audits.json'),

  // Asset & inventory back-compat exports
  LOG_JSON_PATH:    path.join(SHARED_FOLDER, 'log.json'),
  AUDIT_LOG_PATH:   path.join(SHARED_FOLDER, 'admin_audit_log.json'),
  ACTIVITY_LOG_PATH: path.join(DATA_DIR, 'activity-log.json'),
  EXCEL_PATH:       path.join(SHARED_FOLDER, 'log.xlsx'),

  // New: JSON backup of Sequelize Asset table
  ASSETS_BACKUP_PATH: path.join(DATA_DIR, 'assets.json'),

  // Building transfers log
  TRANSFERS_PATH: path.join(DATA_DIR, 'transfers.json'),
  REORDER_QUEUE_PATH: path.join(DATA_DIR, 'reorder_queue.json'),

  // Images / uploads are already under data/ in your repo; keep using route handlers
};
