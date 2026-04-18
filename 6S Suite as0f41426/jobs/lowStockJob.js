// jobs/lowStockJob.js
// Unified low-stock alert runner + scheduler.
// - One-shot runner:   runLowStockCheck(io)
// - Cron scheduler:    scheduleLowStockCron(io)
// Reads env knobs and uses utils/notifier.js (with graceful fallbacks).
//
// Compatible with server.js which imports { runLowStockCheck } from this file.

import cron from 'node-cron';
import * as notifier from '../utils/notifier.js';
import {
  getLowStockItems,
  markEmailNoticeSent,
} from '../services/inventoryService.js';

/* ──────────────────────────────────────────────────────────────
   Config (env)
─────────────────────────────────────────────────────────────── */
const envBool = (v, d = true) => {
  if (v == null) return d;
  const s = String(v).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
};

const ENABLED          = envBool(process.env.LOW_STOCK_ALERTS, true);
const CRON_EXPR        = process.env.LOW_STOCK_CRON || '0 9 * * *';     // default 09:00 daily
const TIMEZONE         = process.env.CRON_TZ || process.env.LOW_STOCK_TZ || undefined;
const RUN_ON_START     = envBool(process.env.LOW_STOCK_RUN_ON_START, false);
const LOG_PREFIX       = '[lowStock]';
const SAFE_SOCKET_EMIT = (io, event, payload) => {
  try { io?.emit?.(event, payload); } catch (e) { console.warn(`${LOG_PREFIX} socket emit failed:`, e?.message || e); }
};

/* ──────────────────────────────────────────────────────────────
   Notifier shim (utils/notifier.js is canonical; fallbacks)
─────────────────────────────────────────────────────────────── */
async function sendDigest(lowItems) {
  // Prefer unified API if present
  if (typeof notifier.sendLowInventoryDigest === 'function') {
    return notifier.sendLowInventoryDigest(lowItems);
  }
  if (typeof notifier.notifyLowInventory === 'function') {
    return notifier.notifyLowInventory(lowItems);
  }
  // Optional legacy services/notifier.js (best-effort)
  try {
    const mod = await import('../services/notifier.js');
    if (typeof mod.notifyLowStock === 'function') {
      return mod.notifyLowStock(lowItems);
    }
    if (typeof mod.sendLowInventoryAlert === 'function') {
      return mod.sendLowInventoryAlert(lowItems);
    }
  } catch {/* ignore */}
  // Last resort: log
  const subject = `Low Inventory (${lowItems.length})`;

  // Group by building for clearer output
  const byBuilding = {};
  lowItems.forEach(i => {
    const bldg = i.Building || 'Bldg-350';
    if (!byBuilding[bldg]) byBuilding[bldg] = [];
    byBuilding[bldg].push(i);
  });

  const lines = Object.entries(byBuilding).flatMap(([bldg, items]) => [
    `\n── ${bldg} ──`,
    ...items.map(i =>
      `  ${i.ItemCode} — ${i.Description || ''} | OnHand: ${i.OnHandQty} | Safety: ${i.SafetyLevelQty}`
    ),
  ]).join('\n');
  console.warn(`${LOG_PREFIX} no notifier available, printing digest:\n${subject}\n${lines}`);
  return { ok: false, simulated: true };
}

/* ──────────────────────────────────────────────────────────────
   One-shot runner with singleflight guard
─────────────────────────────────────────────────────────────── */
let _running = false;
let _lastRunAt = null;

/**
 * Run a single low-stock check, send notifications (batched),
 * mark items as "notified", and broadcast via socket.
 * Safe to call multiple times; overlapping runs are skipped.
 *
 * @param {import('socket.io').Server} [io]
 */
export async function runLowStockCheck(io) {
  if (_running) {
    console.warn(`${LOG_PREFIX} skip: previous run still in progress`);
    return;
  }
  _running = true;
  const started = Date.now();

  try {
    const low = await getLowStockItems();
    if (!low?.length) {
      console.log(`${LOG_PREFIX} no low-inventory items to notify`);
      _lastRunAt = new Date();
      return;
    }

    await sendDigest(low);

    // Mark as notified to avoid spamming future runs
    const codes = low.map(i => i.ItemCode);
    await markEmailNoticeSent(codes);

    // Group by building for richer socket payload
    const byBuilding = {};
    low.forEach(i => {
      const bldg = i.Building || 'Bldg-350';
      if (!byBuilding[bldg]) byBuilding[bldg] = [];
      byBuilding[bldg].push(i.ItemCode);
    });

    // Live update to clients
    SAFE_SOCKET_EMIT(io, 'inventoryUpdated', { resource: 'inventory', reason: 'lowStockNotified', codes });
    SAFE_SOCKET_EMIT(io, 'inventoryAlertSent', { count: codes.length, codes, byBuilding });

    console.log(`${LOG_PREFIX} notified ${codes.length} item(s)`);
    _lastRunAt = new Date();
  } catch (err) {
    console.error(`${LOG_PREFIX} run failed:`, err);
  } finally {
    _running = false;
    console.log(`${LOG_PREFIX} finished in ${Date.now() - started}ms`);
  }
}

/* ──────────────────────────────────────────────────────────────
   Cron scheduler (single source of truth)
─────────────────────────────────────────────────────────────── */
/**
 * Schedule recurring low-stock checks.
 * Respects:
 *   - LOW_STOCK_ALERTS=true|false
 *   - LOW_STOCK_CRON="0 9 * * *"
 *   - CRON_TZ / LOW_STOCK_TZ
 *   - LOW_STOCK_RUN_ON_START=1
 *
 * @param {import('socket.io').Server} [io]
 * @returns {{ stop: () => void, runNow: () => Promise<void>, info: () => object }}
 */
export function scheduleLowStockCron(io) {
  if (!ENABLED) {
    console.log(`${LOG_PREFIX} scheduling disabled via LOW_STOCK_ALERTS=false`);
    if (RUN_ON_START) {
      console.log(`${LOG_PREFIX} LOW_STOCK_RUN_ON_START=1 → running initial check…`);
      runLowStockCheck(io);
    }
    return {
      stop: () => {},
      runNow: () => runLowStockCheck(io),
      info: () => ({ enabled: false, lastRunAt: _lastRunAt }),
    };
  }

  const task = cron.schedule(CRON_EXPR, () => runLowStockCheck(io), TIMEZONE ? { timezone: TIMEZONE } : undefined);
  console.log(`${LOG_PREFIX} scheduled @ "${CRON_EXPR}"${TIMEZONE ? ` (${TIMEZONE})` : ''}`);

  if (RUN_ON_START) {
    setTimeout(() => {
      console.log(`${LOG_PREFIX} LOW_STOCK_RUN_ON_START=1 → running initial check…`);
      runLowStockCheck(io);
    }, 30_000);
  }

  return {
    stop: () => {
      try { task.stop(); } catch {}
      console.log(`${LOG_PREFIX} scheduler stopped`);
    },
    runNow: () => runLowStockCheck(io),
    info: () => ({
      enabled: true,
      cron: CRON_EXPR,
      timezone: TIMEZONE || null,
      lastRunAt: _lastRunAt,
      running: _running,
    }),
  };
}

/* ──────────────────────────────────────────────────────────────
   Default export for convenience (kept compatible)
─────────────────────────────────────────────────────────────── */
export default scheduleLowStockCron;