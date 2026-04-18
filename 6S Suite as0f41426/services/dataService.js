// services/dataService.js
import path from 'path';
import {
  ensureDirExists,
  loadData,
  saveToolsToOriginalFormat,
  updateLogAndExcel,
} from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';

// Probe the corporate file share at startup. When the workstation is offline
// from the domain (common on dev boxes / VPN drops) the mkdir fails with
// errno -4094 (UNKNOWN) and any later loadJSON call targeting a SHARED_FOLDER
// path would silently go through `app.get(...)` as `undefined` because
// initData threw before the `app.set(...)` block could run. That cascaded into
// a flood of `⚠️ loadJSON called without a file path; returning fallback.`
// warnings and left admin / audit endpoints unusable. Falling back to the
// local DATA_DIR keeps the suite functional; the only feature that actually
// needs the UNC share is the cross-site Screwdriver log aggregation.
async function resolveSharedFolder() {
  try {
    await ensureDirExists(PATHS.SHARED_FOLDER);
    return { ok: true, folder: PATHS.SHARED_FOLDER };
  } catch (e) {
    return {
      ok: false,
      folder: PATHS.DATA_DIR,
      reason: e?.code || e?.message || 'unknown',
    };
  }
}

export const initData = async (app) => {
  const shared = await resolveSharedFolder();

  const LOG_JSON_PATH  = shared.ok ? PATHS.LOG_JSON_PATH  : path.join(PATHS.DATA_DIR, 'log.json');
  const AUDIT_LOG_PATH = shared.ok ? PATHS.AUDIT_LOG_PATH : path.join(PATHS.DATA_DIR, 'admin_audit_log.json');
  const EXCEL_PATH     = shared.ok ? PATHS.EXCEL_PATH     : path.join(PATHS.DATA_DIR, 'log.xlsx');

  // Register paths BEFORE any I/O that could throw. Downstream modules
  // (routes/admin.js, middleware/activityLogger.js, socket handlers, …) look
  // these up via app.get('auditLogPath') etc.; if initData aborts partway
  // through, those lookups return undefined and every subsequent loadJSON
  // logs the "called without a file path" warning.
  app.set('employeePath',     PATHS.EMPLOYEE_PATH);
  app.set('toolPath',         PATHS.TOOL_PATH);
  app.set('userPath',         PATHS.USER_PATH);
  app.set('auditLogPath',     AUDIT_LOG_PATH);
  app.set('activityLogPath',  PATHS.ACTIVITY_LOG_PATH);
  app.set('calibrationPath',  PATHS.CALIBRATION_PATH);
  app.set('logFilePath',      LOG_JSON_PATH);
  app.set('excelFilePath',    EXCEL_PATH);
  app.set('sharedFolder',     shared.folder);
  app.set('sharedFolderOnline', shared.ok);
  app.set('projectsPath',     PATHS.PROJECTS_PATH);
  app.set('auditsPath',       PATHS.AUDITS_PATH);

  // Pre-populate locals so admin/UI code can rely on them even if the data
  // load below fails (e.g. corrupt JSON on disk).
  app.locals.employees       = app.locals.employees       || [];
  app.locals.tools           = app.locals.tools           || [];
  app.locals.calibrationData = app.locals.calibrationData || [];
  app.locals.entries         = app.locals.entries         || [];

  if (!shared.ok) {
    console.warn(
      `[initData] SHARED_FOLDER ${PATHS.SHARED_FOLDER} unreachable (${shared.reason}); ` +
      `falling back to ${PATHS.DATA_DIR} for log/audit/xlsx files.`
    );
  }

  const { employees, tools, calibrationData, entries } = await loadData({
    employeePath:    PATHS.EMPLOYEE_PATH,
    toolDataPath:    PATHS.TOOL_PATH,
    calibrationPath: PATHS.CALIBRATION_PATH,
    logFilePath:     LOG_JSON_PATH,
  });

  app.locals.employees       = employees;
  app.locals.tools           = tools;
  app.locals.calibrationData = calibrationData;
  app.locals.entries         = entries;
};

export const refreshAll = async (app, io) => {
  await saveToolsToOriginalFormat(app.get('toolPath'), app.locals.tools);
  await updateLogAndExcel(
    { logFilePath: app.get('logFilePath'), excelFilePath: app.get('excelFilePath') },
    app.locals.entries
  );

  io.publish?.toolsUpdated?.({ reason: 'refreshAll' });
  io.publish?.employeesUpdated?.({ reason: 'refreshAll' });
  io.publish?.auditUpdated?.({ reason: 'refreshAll' });
};
