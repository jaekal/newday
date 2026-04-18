//public/screwdriver/realtime.js

import { patchToolCard, updateKpiBar, updateOverduePanel } from './render.js';
import { state } from './state.js';

export function connectSocket(onUpdate, { debounceTime = 500 } = {}) {
  if (typeof window.io !== 'function') {
    console.error('Socket.IO client not found; ensure "/socket.io/socket.io.js" is included first');
    return;
  }

  const socket = window.io({ withCredentials: true });

  socket.on('connect', () => console.log(`Realtime: connected (id=${socket.id})`));

  let timer;
  const debouncedRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { onUpdate?.(); } catch (e) { console.error('Realtime update failed:', e); }
    }, debounceTime);
  };

  // ── Surgical per-tool patch (recommendation #12) ─────────────────────────
  // If the event carries the full tool payload, patch just that card in the DOM.
  // Only fall back to a full re-render if the card isn't found (e.g. filtered out).
  function handleToolEvent(payload) {
    if (!payload) { debouncedRefresh(); return; }

    // Normalise — the backend may send different shapes
    const tool = payload.tool || payload.data || payload;
    if (!tool?.serialNumber) { debouncedRefresh(); return; }

    const patched = patchToolCard(tool);
    if (patched) {
      // Card was found and updated in-place — just refresh KPI/overdue panels
      updateKpiBar();
      updateOverduePanel();
    } else {
      // Card not in current view (filtered out or new) — full refresh
      debouncedRefresh();
    }
  }

  // Per-tool events emitted by the backend on individual checkout/return
  ['toolCheckedOut', 'toolReturned', 'toolUpdated'].forEach(evt =>
    socket.on(evt, handleToolEvent)
  );

  // Bulk/broadcast events — always full refresh
  ['toolsUpdated', 'inventoryUpdated', 'inventoryAlertSent'].forEach(evt =>
    socket.on(evt, debouncedRefresh)
  );

  // On reconnect, always do a full refresh to catch anything missed offline
  socket.on('connect', () => {
    // Small delay so the server is ready
    setTimeout(() => { try { onUpdate?.(); } catch {} }, 800);
  });

  socket.on('disconnect', reason => console.warn('Realtime: disconnected:', reason));
  return socket;
}
