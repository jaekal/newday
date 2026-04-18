import { PATHS } from '../config/path.js';
import { loadJSON, saveJSON } from './fileUtils.js';

const EMPLOYEE_ID_ALIASES_PATH = PATHS.EMPLOYEE_ID_ALIASES_PATH;

const s = (value) => (value == null ? '' : String(value).trim());
const lc = (value) => s(value).toLowerCase();

function normalizeRecord(record = {}) {
  return {
    aliasId: lc(record.aliasId),
    currentId: lc(record.currentId),
    employeeName: s(record.employeeName),
    changedAt: s(record.changedAt) || new Date().toISOString(),
    changedBy: s(record.changedBy) || 'system',
  };
}

export async function loadEmployeeIdAliases() {
  const raw = await loadJSON(EMPLOYEE_ID_ALIASES_PATH, []);
  return Array.isArray(raw)
    ? raw.map(normalizeRecord).filter((record) => record.aliasId && record.currentId)
    : [];
}

export async function saveEmployeeIdAliases(records) {
  await saveJSON(EMPLOYEE_ID_ALIASES_PATH, records.map(normalizeRecord));
}

export async function recordEmployeeIdAlias({ aliasId, currentId, employeeName = '', changedAt, changedBy }) {
  const normalized = normalizeRecord({ aliasId, currentId, employeeName, changedAt, changedBy });
  if (!normalized.aliasId || !normalized.currentId || normalized.aliasId === normalized.currentId) {
    return null;
  }

  const existing = await loadEmployeeIdAliases();
  const idx = existing.findIndex(
    (record) => record.aliasId === normalized.aliasId && record.currentId === normalized.currentId
  );

  if (idx >= 0) {
    existing[idx] = {
      ...existing[idx],
      employeeName: normalized.employeeName || existing[idx].employeeName,
      changedAt: normalized.changedAt,
      changedBy: normalized.changedBy,
    };
  } else {
    existing.push(normalized);
  }

  await saveEmployeeIdAliases(existing);
  return normalized;
}

export async function resolveEmployeeIdSet(seedIds = []) {
  const seeds = [...new Set(seedIds.map(lc).filter(Boolean))];
  if (!seeds.length) return new Set();

  const aliases = await loadEmployeeIdAliases();
  const graph = new Map();

  const addEdge = (left, right) => {
    if (!left || !right) return;
    if (!graph.has(left)) graph.set(left, new Set());
    if (!graph.has(right)) graph.set(right, new Set());
    graph.get(left).add(right);
    graph.get(right).add(left);
  };

  aliases.forEach((record) => addEdge(record.aliasId, record.currentId));

  const visited = new Set(seeds);
  const queue = [...seeds];

  while (queue.length) {
    const id = queue.shift();
    const neighbors = graph.get(id);
    if (!neighbors) continue;
    neighbors.forEach((neighbor) => {
      if (visited.has(neighbor)) return;
      visited.add(neighbor);
      queue.push(neighbor);
    });
  }

  return visited;
}

export async function resolveEmployeeAliases(seedId) {
  const ids = await resolveEmployeeIdSet([seedId]);
  const target = lc(seedId);
  return [...ids].filter((id) => id !== target).sort();
}
