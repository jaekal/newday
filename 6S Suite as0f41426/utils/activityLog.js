import { randomUUID } from 'crypto';
import { loadJSON, saveJSON } from './fileUtils.js';
import { s, lc } from './text.js';

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;
const RETAIN_MAX = Number(process.env.ACTIVITY_LOG_MAX || 10000);

function normalizeEntry(entry = {}) {
  return {
    id: s(entry.id) || randomUUID(),
    time: s(entry.time) || new Date().toISOString(),
    type: s(entry.type) || 'activity',
    module: s(entry.module) || 'system',
    action: s(entry.action) || 'update',
    summary: s(entry.summary),
    status: s(entry.status) || 'success',
    statusCode: Number(entry.statusCode || 0) || 0,
    method: s(entry.method),
    path: s(entry.path),
    route: s(entry.route),
    actorId: s(entry.actorId),
    actorName: s(entry.actorName),
    actorRole: s(entry.actorRole),
    actorType: s(entry.actorType) || 'user',
    requestId: s(entry.requestId),
    target: entry.target || null,
    details: entry.details || {},
    durationMs: Number(entry.durationMs || 0) || 0,
    ip: s(entry.ip),
    userAgent: s(entry.userAgent),
    building: s(entry.building),
  };
}

function parseDateValue(value, endOfDay = false) {
  const raw = s(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function resolveDateWindow(range = '', from = '', to = '') {
  const now = Date.now();
  const rangeKey = lc(range);
  let start = null;
  let end = null;

  if (rangeKey === 'today') {
    start = new Date();
    start.setHours(0, 0, 0, 0);
    end = new Date();
  } else if (rangeKey === '7d') {
    start = new Date(now - 7 * 24 * 60 * 60 * 1000);
  } else if (rangeKey === '30d') {
    start = new Date(now - 30 * 24 * 60 * 60 * 1000);
  } else if (rangeKey === '90d') {
    start = new Date(now - 90 * 24 * 60 * 60 * 1000);
  } else if (rangeKey === 'custom') {
    start = parseDateValue(from, false);
    end = parseDateValue(to, true);
  }

  if (!start && from) start = parseDateValue(from, false);
  if (!end && to) end = parseDateValue(to, true);

  return { start, end };
}

export async function appendActivity({ path, entry, maxEntries = RETAIN_MAX } = {}) {
  if (!path) throw new Error('appendActivity requires a path');
  const log = await loadJSON(path, []);
  log.push(normalizeEntry(entry));
  const retained = maxEntries > 0 && log.length > maxEntries ? log.slice(-maxEntries) : log;
  await saveJSON(path, retained);
  return retained[retained.length - 1];
}

export async function readActivity(path) {
  const items = await loadJSON(path, []);
  return Array.isArray(items) ? items.map(normalizeEntry) : [];
}

export async function queryActivity(path, filters = {}) {
  const {
    module = '',
    actor = '',
    q = '',
    status = '',
    range = '',
    from = '',
    to = '',
    limit = DEFAULT_LIMIT,
  } = filters;

  const wantsAll = lc(limit) === 'all';
  const safeLimit = wantsAll ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const qNeedle = lc(q);
  const actorNeedle = lc(actor);
  const moduleNeedle = lc(module);
  const statusNeedle = lc(status);
  const { start, end } = resolveDateWindow(range, from, to);

  const items = await readActivity(path);
  return items
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .filter((item) => {
      const itemTime = parseDateValue(item.time, false);
      if (start && itemTime && itemTime < start) return false;
      if (end && itemTime && itemTime > end) return false;
      if (moduleNeedle && lc(item.module) !== moduleNeedle) return false;
      if (statusNeedle) {
        if (statusNeedle === 'page_view') {
          if (lc(item.action) !== 'page_view') return false;
        } else if (statusNeedle === 'write') {
          if (lc(item.action) === 'page_view') return false;
        } else if (lc(item.status) !== statusNeedle) {
          return false;
        }
      }
      if (actorNeedle) {
        const hay = `${lc(item.actorId)} ${lc(item.actorName)} ${lc(item.actorRole)}`;
        if (!hay.includes(actorNeedle)) return false;
      }
      if (qNeedle) {
        const hay = [
          item.summary,
          item.action,
          item.module,
          item.path,
          item.method,
          item.actorId,
          item.actorName,
          item.actorRole,
          item.building,
          item.target?.id,
          item.target?.label,
          item.target?.type,
          JSON.stringify(item.details || {}),
        ]
          .map((value) => lc(value))
          .join(' ');
        if (!hay.includes(qNeedle)) return false;
      }
      return true;
    })
    .slice(0, safeLimit);
}
