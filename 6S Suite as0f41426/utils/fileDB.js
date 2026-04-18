// utils/fileDB.js
// Deprecated shim around fileUtils. Prefer using loadJSON/saveJSON/readModifyWriteJSON directly.
//
// This keeps the old "DATA_DIR + filename" convention but routes all I/O
// through the atomic, queued helpers in fileUtils.

import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDirExists,
  loadJSON,
  saveJSON,
  readModifyWriteJSON
} from './fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const DATA_DIR = path.join(__dirname, '..', 'data');

function resolvePath(filename) {
  return path.join(DATA_DIR, filename);
}

/**
 * Async replacement for the old sync readJSON.
 * @param {string} filename
 * @param {any} [fallback=[]]
 */
export async function readJSON(filename, fallback = []) {
  const p = resolvePath(filename);
  await ensureDirExists(DATA_DIR);
  return loadJSON(p, fallback);
}

/**
 * Async replacement for the old sync writeJSON.
 * @param {string} filename
 * @param {any} data
 */
export async function writeJSON(filename, data) {
  const p = resolvePath(filename);
  await ensureDirExists(DATA_DIR);
  await saveJSON(p, data);
}

/**
 * Append an item to a JSON array file in a safe, queued way.
 * @param {string} filename
 * @param {any} item
 */
export async function pushJSON(filename, item) {
  const p = resolvePath(filename);
  await ensureDirExists(DATA_DIR);

  await readModifyWriteJSON(
    p,
    (current = []) => {
      const arr = Array.isArray(current) ? current.slice() : [];
      arr.push(item);
      return arr;
    },
    // Optional validation hook – keep it lax for now
    (next) => {
      if (!Array.isArray(next)) {
        return 'Expected JSON file to contain an array.';
      }
    },
    [] // fallback
  );

  return item;
}
