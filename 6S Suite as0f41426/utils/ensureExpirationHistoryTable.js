// src/utils/ensureExpirationHistoryTable.js
import { ExpirationHistory } from '../models/index.js';

export async function ensureExpirationHistoryTable() {
  try {
    await ExpirationHistory.sync();
    console.log('[db] ExpirationHistory table ready');
  } catch (err) {
    console.error('[db] Failed to ensure ExpirationHistory table:', err?.message || err);
    throw err;
  }
}