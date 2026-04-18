// utils/emailUtils.js
//
// DEPRECATED: Low-inventory alerts are now handled by utils/notifier.js,
// which supports rate-limiting and multi-channel delivery (email, Slack, Teams).
//
// This file is kept as a thin wrapper for older code that still calls
// sendLowInventoryAlert(lowItems). New code should preferentially use:
//
//   import { sendLowInventoryDigest, notifyLowInventory } from './notifier.js';
//

import { notifyLowInventory } from './notifier.js';

/**
 * Legacy name. Delegates to notifier's low-inventory helper.
 * @param {Array} lowItems - Array of inventory items below safety level
 */
export async function sendLowInventoryAlert(lowItems) {
  return notifyLowInventory(lowItems);
}
