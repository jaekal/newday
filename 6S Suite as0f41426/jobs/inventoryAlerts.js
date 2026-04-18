// jobs/inventoryAlerts.js
// Thin compatibility layer that delegates to the unified scheduler.
// Keep this file if some parts of the app still import it.
// Otherwise you can remove it and import from './lowStockJob.js' directly.

import { scheduleLowStockCron, runLowStockCheck } from './lowStockJob.js';

/**
 * Schedule daily (or cron-based) low-stock alerts.
 * Delegates to the unified implementation in lowStockJob.js
 *
 * @param {import('socket.io').Server} io
 * @returns {{ stop: () => void, runNow: () => Promise<void>, info: () => object }}
 */
export default function scheduleInventoryAlerts(io) {
  // Optional console hint to surface that this is a shim
  if (process.env.NODE_ENV !== 'production') {
    console.log('[inventoryAlerts] Delegating to lowStockJob scheduler (shim).');
  }
  return scheduleLowStockCron(io);
}

// Re-export the one-shot runner for callers that used it here before.
export { runLowStockCheck };
