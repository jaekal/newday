// routes/management.js  (fixed)
// ─────────────────────────────────────────────────────────────────────────────
// Merges the original portal.js response shape (unchanged) with the new home
// page stats fields added in home-update.zip.
//
// Root cause of the TypeError: the home-update version returned flat fields
// (totalTools, available, checkedOut, buckets) instead of the nested objects
// that portal.js expects (m.tools.available, m.projects.byBucket, m.audits.open,
// m.trend.labels / m.trend.series, m.delayedTickets, m.suggestions).
//
// This version keeps BOTH: the original nested structure portal.js reads, plus
// the flat convenience fields the home page stats bar reads.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import fs      from 'fs';
import fsp     from 'fs/promises';
import path    from 'path';
import { fileURLToPath } from 'url';
import { PATHS } from '../config/path.js';
import { loadJSON } from '../utils/fileUtils.js';
import { queryActivity } from '../utils/activityLog.js';
import taskService from '../services/taskService.js';
import { DEFAULT_BUILDING, normalizeBuilding } from '../utils/buildings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router  = express.Router();
const todayISO = () => new Date().toISOString().slice(0, 10);
const lc       = v  => (v == null ? '' : String(v)).toLowerCase();

function endOfDayUtcTs(ymd) {
  return Date.parse(`${ymd}T23:59:59.999Z`);
}

/** Kiosk suggestion box entries (JSONL) — not project tasks. */
async function readRecentKioskSuggestions(limit = 50) {
  const p = path.join(__dirname, '../data/kiosk/suggestions.jsonl');
  try {
    if (!fs.existsSync(p)) return [];
    const txt = await fsp.readFile(p, 'utf8');
    const lines = txt.trim() ? txt.trim().split('\n').filter(Boolean) : [];
    const rows = lines.map((l) => JSON.parse(l));
    return rows
      .slice(-limit)
      .reverse()
      .map((rec) => {
        const text = String(rec.text || '').trim();
        let title;
        if (rec.category) {
          const snippet = text.slice(0, 100);
          title = `${rec.category}: ${snippet}${text.length > 100 ? '…' : ''}`;
        } else {
          title = text ? `${text.slice(0, 140)}${text.length > 140 ? '…' : ''}` : '(empty)';
        }
        return {
          id: rec.id,
          title,
          bucket: rec.status || 'received',
        };
      });
  } catch {
    return [];
  }
}

// ── Reorder queue helper ──────────────────────────────────────────────────────
async function getPendingReorderCount() {
  try {
    const p = PATHS.REORDER_QUEUE_PATH;
    if (!p || !fs.existsSync(p)) return 0;
    const queue = await loadJSON(p, []);
    const items = Array.isArray(queue) ? queue : (queue?.items || []);
    return items.filter(i => lc(i.status || '') === 'requested').length;
  } catch {
    return 0;
  }
}

// ── Metrics endpoint ──────────────────────────────────────────────────────────
router.get('/api/metrics', async (_req, res, next) => {
  try {
    const selectedBuilding = normalizeBuilding(_req.query?.building, { allowBlank: true });
    const [tools, tasks, pendingReorders] = await Promise.all([
      loadJSON(PATHS.TOOL_PATH, []),
      taskService.getAll(),
      getPendingReorderCount(),
    ]);
    const scopedTools = selectedBuilding
      ? tools.filter((t) => normalizeBuilding(t.building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === selectedBuilding)
      : tools;
    const scopedTasks = selectedBuilding
      ? tasks.filter((t) => normalizeBuilding(t.building || t.meta?.building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === selectedBuilding)
      : tasks;

    // ── Tools ─────────────────────────────────────────────────────────────
    const totalTools = scopedTools.length;
    const checkedOut = scopedTools.filter(
      t => lc(t.status || t.Status) === 'being used'
    ).length;
    const available  = totalTools - checkedOut;

    // ── Task sets ─────────────────────────────────────────────────────────
    const today        = todayISO();
    const proj         = scopedTasks.filter(t => lc(t.domain) === 'project');
    const auditTasks   = scopedTasks.filter(t => lc(t.domain) === 'audit' && !t.meta?.template);

    // ── Bucket breakdown (projects) ───────────────────────────────────────
    const buckets = { todo: 0, doing: 0, blocked: 0, done: 0 };
    for (const t of proj) if (buckets[t.bucket] != null) buckets[t.bucket]++;

    // ── Audits ────────────────────────────────────────────────────────────
    const openAudits    = auditTasks.filter(t => t.bucket !== 'done').length;
    const overdueAudits = auditTasks.filter(
      t => t.bucket !== 'done' && t.dueDate && t.dueDate < today
    ).length;

    // ── Delayed tickets (portal table) ────────────────────────────────────
    const delayedTickets = proj
      .filter(t => t.bucket !== 'done' && t.dueDate && t.dueDate < today)
      .slice(0, 50)
      .map(t => ({ id: t.id, title: t.title, bucket: t.bucket, dueDate: t.dueDate, source: t.source }));

    // ── Suggestions (portal table) — kiosk JSONL only, not Projects ─────────
    const suggestions = await readRecentKioskSuggestions(50);

    // ── 14-day trend chart (portal.js builds a Chart.js stacked bar) ──────
    const labels = [];
    const trend  = { todo: [], doing: [], blocked: [], done: [] };

    const today14 = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today14);
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      labels.push(k.slice(5)); // "MM-DD"

      const cutoffTs   = endOfDayUtcTs(k);
      const onOrBefore = proj.filter(t => {
        const ts = Date.parse(t.updatedAt || t.createdAt || t.dueDate || '') || 0;
        return ts <= cutoffTs;
      });

      const counts = { todo: 0, doing: 0, blocked: 0, done: 0 };
      for (const t of onOrBefore) if (counts[t.bucket] != null) counts[t.bucket]++;

      trend.todo.push(counts.todo     || 0);
      trend.doing.push(counts.doing   || 0);
      trend.blocked.push(counts.blocked || 0);
      trend.done.push(counts.done     || 0);
    }

    // ── Home-page extras ──────────────────────────────────────────────────
    const blockedTasks    = [...proj, ...auditTasks].filter(t => lc(t.bucket) === 'blocked').length;
    const overdueProjects = proj.filter(t =>
      t.dueDate && t.dueDate < today && lc(t.bucket) !== 'done'
    ).length;

    let calibrationOverdue = 0;
    try {
      const { default: expSvc } = await import('../services/expirationService.js');
      const expItems = await expSvc.getUpcoming({ days: 365 });
      calibrationOverdue = expItems.filter(x => x.status === 'overdue').length;
    } catch {}

    // ── Building-split inventory stats ────────────────────────────────────
    let inventoryByBuilding = {};
    try {
      const { default: invRepo } = await import('../services/inventoryRepo.js');
      const allInv = await invRepo.getInventory();
      const buildings = ['Bldg-350', 'Bldg-4050'];
      for (const bldg of buildings) {
        const items = allInv.filter(i => normalizeBuilding(i.Building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === bldg);
        inventoryByBuilding[bldg] = {
          total:    items.length,
          lowStock: items.filter(i => i.OrderStatus === 'Low Stock').length,
          outOfStock: items.filter(i => i.OrderStatus === 'Out of Stock').length,
        };
      }
    } catch {}

    // ── Building-split tool stats ─────────────────────────────────────────
    let toolsByBuilding = {};
    try {
      const buildings = ['Bldg-350', 'Bldg-4050'];
      for (const bldg of buildings) {
        const bldgTools = tools.filter(t => normalizeBuilding(t.building, { allowBlank: false, fallback: DEFAULT_BUILDING }) === bldg);
        toolsByBuilding[bldg] = {
          total:      bldgTools.length,
          checkedOut: bldgTools.filter(t => lc(t.status || '') === 'being used').length,
        };
      }
    } catch {}

    res.json({
      // ── Nested shape — portal.js reads these ─────────────────────────────
      tools:         { total: totalTools, available, checkedOut },
      projects:      { byBucket: buckets },
      audits:        { open: openAudits, overdue: overdueAudits },
      delayedTickets,
      suggestions,
      trend:         { labels, series: trend },
      generatedAt:   new Date().toISOString(),

      // ── Flat fields — home page stats bar reads these ─────────────────────
      // (also kept as top-level for backwards compatibility with any consumers)
      totalTools,
      checkedOut,
      available,
      buckets,
      blockedTasks,
      openAudits,
      overdueProjects,
      pendingReorders,
      calibrationOverdue,
      inventoryByBuilding,
      toolsByBuilding,
      selectedBuilding: selectedBuilding || '',

      // ── Aliases — notification bell + socket handlers ─────────────────────
      toolsCheckedOut: checkedOut,
      auditTodo:       openAudits,
    });
  } catch (e) { next(e); }
});

// ── Command Floor: activity preview + 14-day trend (suite audit log) ────────────
router.get('/api/command-insights', async (_req, res, next) => {
  try {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 13);
    const fromYmd = start.toISOString().slice(0, 10);
    const toYmd = end.toISOString().slice(0, 10);

    const [recent, windowItems] = await Promise.all([
      queryActivity(PATHS.ACTIVITY_LOG_PATH, { range: '7d', limit: 40 }),
      queryActivity(PATHS.ACTIVITY_LOG_PATH, {
        range: 'custom',
        from: fromYmd,
        to: toYmd,
        limit: 'all',
      }),
    ]);

    const dayKeys = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const countsByDay = new Map(dayKeys.map((k) => [k, 0]));
    for (const item of windowItems) {
      if (lc(item.action) === 'page_view') continue;
      const day = String(item.time || '').slice(0, 10);
      if (countsByDay.has(day)) countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
    }

    const activityTrend = {
      labels: dayKeys.map((k) => k.slice(5)),
      counts: dayKeys.map((k) => countsByDay.get(k) || 0),
    };

    const preview = recent.slice(0, 22).map((item) => ({
      time: item.time,
      summary: item.summary || '',
      action: item.action || '',
      module: item.module || '',
      actorName: item.actorName || '',
      actorId: item.actorId || '',
      path: item.path || '',
      status: item.status || '',
    }));

    res.json({
      preview,
      activityTrend,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    next(e);
  }
});

// ── Portal page route ─────────────────────────────────────────────────────────
router.get('/portal.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'management', 'portal.html'));
});

export default router;
