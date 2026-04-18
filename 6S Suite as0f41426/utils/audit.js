// utils/audit.js
import { loadJSON, saveJSON } from './fileUtils.js';

/**
 * Append an audit entry to the given JSON log file, ensuring a consistent shape.
 * @param {Object} options
 * @param {string} options.path - absolute path to audit JSON file
 * @param {Object} options.entry - audit payload; will be augmented with { time }
 */
export async function appendAudit({ path, entry }) {
  const log = await loadJSON(path, []);
  log.push({
    time: entry.time || new Date().toISOString(),
    ...entry,
  });
  await saveJSON(path, log);
  return entry;
}
