/**
 * routes/reorderQueue.js
 * ───────────────────────
 * Lightweight inventory reorder approval queue.
 *
 * Adds these endpoints:
 *   GET    /inventory/reorder-queue          → list pending reorders (admin/lead)
 *   POST   /inventory/reorder-queue          → submit a reorder request (any auth)
 *   PATCH  /inventory/reorder-queue/:id      → approve / reject / update qty (admin/lead)
 *   DELETE /inventory/reorder-queue/:id      → remove entry (admin/lead)
 *   GET    /inventory/reorder-queue/export.csv → download current queue as CSV
 *
 * Status lifecycle:
 *   requested → approved → ordered → received
 *                        → rejected  (terminal)
 *
 * Wire in server.js alongside the existing inventoryRouter:
 *   import reorderQueueRouter from './routes/reorderQueue.js';
 *   app.use('/inventory', requireAuth, reorderQueueRouter);
 *
 * Storage: JSON file at data/reorder_queue.json (no extra DB required).
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const QUEUE_PATH = PATHS?.REORDER_QUEUE_PATH
  || path.join(__dirname, '../data/reorder_queue.json');

const STATUSES = new Set(['requested', 'approved', 'ordered', 'received', 'rejected']);
const TERMINAL = new Set(['received', 'rejected']);

const s   = v => (v == null ? '' : String(v)).trim();
const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const now = () => new Date().toISOString();

const router = express.Router();

/* ─── Persistence ─────────────────────────────────────────────────── */
async function loadQueue() {
  const raw = await loadJSON(QUEUE_PATH, []);
  return Array.isArray(raw) ? raw : [];
}
async function saveQueue(q) { await saveJSON(QUEUE_PATH, q); }

/* ─── Role helpers ────────────────────────────────────────────────── */
const canApprove = (req) => {
  const role = (req.session?.user?.role || '').toLowerCase();
  return ['admin', 'lead', 'management'].includes(role);
};

/* ─── GET /inventory/reorder-queue ───────────────────────────────── */
router.get('/reorder-queue', requireAuth, async (req, res, next) => {
  try {
    const q        = await loadQueue();
    const status   = s(req.query.status);
    const building = s(req.query.building);
    let items = q;
    if (status)   items = items.filter(i => i.status === status);
    if (building && building !== 'all') items = items.filter(i => (i.building || 'Bldg-350') === building);
    res.json({ items, total: items.length });
  } catch (e) { next(e); }
});

/* ─── POST /inventory/reorder-queue ─────────────────────────────── */
router.post('/reorder-queue', requireAuth, async (req, res, next) => {
  try {
    const { ItemCode, description, requestedQty, vendor, notes, unitPrice, building } = req.body || {};
    if (!s(ItemCode)) return res.status(400).json({ message: 'ItemCode is required' });

    const q     = await loadQueue();
    // Prevent duplicate pending requests for same item
    const dupe  = q.find(i => i.ItemCode === s(ItemCode) && !TERMINAL.has(i.status));
    if (dupe) return res.status(409).json({ message: 'A pending reorder for this item already exists', existing: dupe });

    const entry = {
      id:            randomUUID(),
      ItemCode:      s(ItemCode),
      description:   s(description),
      requestedQty:  num(requestedQty) || 1,
      approvedQty:   null,
      vendor:        s(vendor),
      unitPrice:     num(unitPrice),
      notes:         s(notes),
      building:      s(building) || 'Bldg-350',
      status:        'requested',
      requestedBy:   s(req.session?.user?.username || req.session?.user?.id || 'system'),
      approvedBy:    null,
      requestedAt:   now(),
      updatedAt:     now(),
      statusHistory: [{ status: 'requested', at: now(), by: s(req.session?.user?.username || '') }],
    };

    q.unshift(entry);
    await saveQueue(q);
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

/* ─── PATCH /inventory/reorder-queue/:id ─────────────────────────── */
router.patch('/reorder-queue/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canApprove(req)) return res.status(403).json({ message: 'admin/lead/management role required' });

    const q   = await loadQueue();
    const idx = q.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Not found' });

    const item   = q[idx];
    const { status, approvedQty, notes, vendor, unitPrice } = req.body || {};

    if (status) {
      if (!STATUSES.has(status)) return res.status(400).json({ message: `Invalid status. Valid: ${[...STATUSES].join(', ')}` });
      if (TERMINAL.has(item.status)) return res.status(409).json({ message: `Item is already in terminal status: ${item.status}` });
      item.status    = status;
      item.approvedBy = s(req.session?.user?.username || req.session?.user?.id || '');
      item.statusHistory.push({ status, at: now(), by: item.approvedBy });
    }
    if (approvedQty != null) item.approvedQty = num(approvedQty);
    if (notes   != null) item.notes     = s(notes);
    if (vendor  != null) item.vendor    = s(vendor);
    if (unitPrice != null) item.unitPrice = num(unitPrice);
    item.updatedAt = now();

    q[idx] = item;
    await saveQueue(q);
    res.json(item);
  } catch (e) { next(e); }
});

/* ─── DELETE /inventory/reorder-queue/:id ────────────────────────── */
router.delete('/reorder-queue/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canApprove(req)) return res.status(403).json({ message: 'admin/lead/management role required' });

    const q   = await loadQueue();
    const idx = q.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ message: 'Not found' });
    const [removed] = q.splice(idx, 1);
    await saveQueue(q);
    res.json({ ok: true, removed });
  } catch (e) { next(e); }
});

/* ─── GET /inventory/reorder-queue/export.csv ─────────────────────── */
router.get('/reorder-queue/export.csv', requireAuth, async (req, res, next) => {
  try {
    if (!canApprove(req)) return res.status(403).json({ message: 'admin/lead/management role required' });
    const q = await loadQueue();
    const headers = ['id','ItemCode','description','building','requestedQty','approvedQty','vendor','unitPrice','status','requestedBy','approvedBy','requestedAt','updatedAt','notes'];
    const csv = [
      headers.join(','),
      ...q.map(i =>
        headers.map(h => {
          const v = s(i[h] ?? '');
          return `"${v.replace(/"/g, '""')}"`;
        }).join(',')
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reorder_queue.csv"');
    res.send(csv);
  } catch (e) { next(e); }
});

export default router;
