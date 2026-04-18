// models/index.js — PATCH INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════════
// Add the following lines inside safeMigrate(), immediately after the existing
// "assets indexes" block:
//
//   // assets indexes (existing lines, leave unchanged)
//   await ensureIndex('assets', ['category'], { name: 'assets_category' });
//   await ensureIndex('assets', ['location'],  { name: 'assets_location' });
//   await ensureIndex('assets', ['status'],    { name: 'assets_status' });
//
// ADD AFTER the three lines above:
//
//   // ── assets: new columns for itemType + equipment support ──────────────
//   await addIfMissing('assets', 'itemType', {
//     type: DataTypes.STRING(16), allowNull: false, defaultValue: 'fleet'
//   });
//   await addIfMissing('assets', 'serialNumber', {
//     type: DataTypes.STRING(128), allowNull: true
//   });
//   await addIfMissing('assets', 'lastCalibrationDate', {
//     type: DataTypes.STRING(32), allowNull: true
//   });
//   await addIfMissing('assets', 'nextCalibrationDue', {
//     type: DataTypes.STRING(32), allowNull: true
//   });
//   await addIfMissing('assets', 'calibrationIntervalDays', {
//     type: DataTypes.INTEGER, allowNull: true
//   });
//   await addIfMissing('assets', 'checkedOutBy', {
//     type: DataTypes.STRING(128), allowNull: true
//   });
//   await addIfMissing('assets', 'checkedOutAt', {
//     type: DataTypes.STRING(32), allowNull: true
//   });
//   await ensureIndex('assets', ['itemType'],           { name: 'assets_item_type' });
//   await ensureIndex('assets', ['nextCalibrationDue'], { name: 'assets_cal_due' });
//
// ═══════════════════════════════════════════════════════════════════════════════
// That is the only change needed in models/index.js.
// The safeMigrate() function is additive-only — it never drops or alters
// existing columns, so existing fleet assets are unaffected.
// ═══════════════════════════════════════════════════════════════════════════════
