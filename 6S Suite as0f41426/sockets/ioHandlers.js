// sockets/ioHandlers.js
import { randomUUID } from 'crypto';

/**
 * Lightweight per-socket rate limiter.
 * Keeps N events per windowMs per event name to avoid abuse.
 */
function makeLimiter({ windowMs = 10_000, max = 40 } = {}) {
  const buckets = new Map(); // event -> { count, resetAt }
  return function withinLimit(eventName) {
    const now = Date.now();
    const b = buckets.get(eventName);
    if (!b || now >= b.resetAt) {
      buckets.set(eventName, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (b.count < max) { b.count += 1; return true; }
    return false;
  };
}

const TRUE = (v) => /^(1|true|yes)$/i.test(String(v ?? ''));
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const safeAck = (ack, payload) => { if (typeof ack === 'function') { try { ack(payload); } catch {} } };

// Room names clients are allowed to subscribe to. Everything else is rejected,
// so a malicious page can't pivot into arbitrary broadcast rooms.
const ALLOWED_ROOMS = new Set([
  'all',
  'inventory',
  'tools',
  'employees',
  'assets',
  'audit',
  'projects',
  'esdCarts',
  'kiosk',
]);

export default function registerSocketHandlers(io) {
  // SOCKET_AUTH_BYPASS is a dev-only shim; ignored in production.
  const IS_PROD = process.env.NODE_ENV === 'production';
  const BYPASS = TRUE(process.env.SOCKET_AUTH_BYPASS) && !IS_PROD;

  // ✅ single socket auth gate; relies on server applying session middleware to io.engine
  io.use((socket, next) => {
    if (BYPASS) return next();
    const sessUser = socket.request?.session?.user;
    if (!sessUser) return next(new Error('unauthorized'));
    socket.user = {
      id: String(sessUser.id || '').trim(),
      role: String(sessUser.role || 'user').toLowerCase(),
    };
    next();
  });

  io.on('connection', (socket) => {
    const limiter = makeLimiter();
    const sid = socket.id;
    const user = socket.user || { id: 'anonymous', role: 'user' };

    // sensible default rooms
    socket.join('all');
    if (user.id)   socket.join(`user:${user.id}`);
    if (user.role) socket.join(`role:${user.role}`);

    socket.on('ping', (data, ack) => {
      if (!limiter('ping')) return safeAck(ack, { ok: false, error: 'rate_limited' });
      safeAck(ack, { ok: true, t: Date.now(), echo: data ?? null });
    });

    // when client emits with only an ack fn, it becomes the first arg — this handler matches that
    socket.on('whoami', (ack) => {
      if (!limiter('whoami')) return safeAck(ack, { ok: false, error: 'rate_limited' });
      safeAck(ack, { ok: true, user });
    });

    socket.on('subscribe', (room, ack) => {
      if (!limiter('subscribe')) return safeAck(ack, { ok: false, error: 'rate_limited' });
      if (!isNonEmptyString(room)) return safeAck(ack, { ok: false, error: 'invalid_room' });
      const r = room.trim();
      if (!ALLOWED_ROOMS.has(r)) return safeAck(ack, { ok: false, error: 'forbidden_room' });
      socket.join(r);
      safeAck(ack, { ok: true, room: r });
    });

    socket.on('unsubscribe', (room, ack) => {
      if (!limiter('unsubscribe')) return safeAck(ack, { ok: false, error: 'rate_limited' });
      if (!isNonEmptyString(room)) return safeAck(ack, { ok: false, error: 'invalid_room' });
      const r = room.trim();
      socket.leave(r);
      safeAck(ack, { ok: true, room: r });
    });

    socket.on('refresh', (what, ack) => {
      if (!limiter('refresh')) return safeAck(ack, { ok: false, error: 'rate_limited' });
      const allowed = new Set(['inventory', 'tools', 'employees', 'assets', 'audit', 'projects']);
      const key = isNonEmptyString(what) ? what.trim() : '';
      if (!allowed.has(key)) return safeAck(ack, { ok: false, error: 'invalid_target' });
      io.to(key).emit(`${key}Updated`, { resource: key, reason: 'client_refresh', at: Date.now() });
      safeAck(ack, { ok: true, resource: key });
    });

    try {
      socket.emit('hello', { ok: true, sid, cid: randomUUID(), user, ts: Date.now() });
    } catch {}
    socket.on('disconnect', () => {});
  });

  // ── publishing helpers (merge, don't overwrite) ────────────────────────
  io.publish = io.publish || {};
  io.publish.inventoryUpdated = io.publish.inventoryUpdated || ((payload = {}) =>
    io.to('inventory').emit('inventoryUpdated', { resource: 'inventory', ...payload }));
  io.publish.toolsUpdated = io.publish.toolsUpdated || ((payload = {}) =>
    io.to('tools').emit('toolsUpdated', { resource: 'tools', ...payload }));
  io.publish.employeesUpdated = io.publish.employeesUpdated || ((payload = {}) =>
    io.to('employees').emit('employeesUpdated', { resource: 'employees', ...payload }));
  io.publish.assetsUpdated = io.publish.assetsUpdated || ((payload = {}) =>
    io.to('assets').emit('assetsUpdated', { resource: 'assets', ...payload }));
  io.publish.auditUpdated = io.publish.auditUpdated || ((payload = {}) =>
    io.to('audit').emit('auditUpdated', { resource: 'audit', ...payload }));
  io.publish.projectsUpdated = io.publish.projectsUpdated || ((payload = {}) =>
    io.to('projects').emit('projectsUpdated', { resource: 'projects', ...payload }));
}
