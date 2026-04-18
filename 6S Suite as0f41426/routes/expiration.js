// routes/expiration.js
import express from 'express';
import expirationService from '../services/expirationService.js';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimit.js';

function getActor(req) {
  return (
    req.user?.name ||
    req.user?.username ||
    req.session?.user?.name ||
    req.session?.user?.username ||
    'system'
  );
}

function getCurrentUserForOwnerFilter(req) {
  return (
    req.user?.name ||
    req.user?.username ||
    req.session?.user?.name ||
    req.session?.user?.username ||
    ''
  );
}

export default (io) => {
  const router = express.Router();

  router.get('/', requireAuth, (_req, res) => {
    res.sendFile('expiration/index.html', { root: 'public' });
  });

  router.get('/api', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const rawDays = Number(req.query.days);
      const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 120));

      const data = await expirationService.getUpcoming({
        days,
        type: String(req.query.type || '').trim(),
        status: String(req.query.status || '').trim(),
        search: String(req.query.search || '').trim(),
        location: String(req.query.location || '').trim(),
        owner: String(req.query.owner || '').trim(),
        onlyMine: ['1', 'true', 'yes'].includes(String(req.query.onlyMine || '').toLowerCase()),
        currentUser: getCurrentUserForOwnerFilter(req),
        sort: String(req.query.sort || 'due-asc').trim(),
      });

      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/calendar', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const raw = Number(req.query.months);
      const months = Math.max(1, Math.min(24, Number.isFinite(raw) ? raw : 6));

      const data = await expirationService.getCalendar({
        months,
        type: String(req.query.type || '').trim(),
        search: String(req.query.search || '').trim(),
        location: String(req.query.location || '').trim(),
        owner: String(req.query.owner || '').trim(),
        onlyMine: ['1', 'true', 'yes'].includes(String(req.query.onlyMine || '').toLowerCase()),
        currentUser: getCurrentUserForOwnerFilter(req),
      });

      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/:type/:id/history', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const { type, id } = req.params;
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
      const history = await expirationService.getHistory(type, id, limit);
      res.json({ history });
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/:type/:id', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const { type, id } = req.params;
      const item = await expirationService.getItem(type, id);
      res.json(item);
    } catch (e) {
      next(e);
    }
  });

  router.patch('/api/:type/:id', requireAuth, apiLimiter, express.json(), async (req, res, next) => {
    try {
      const { type, id } = req.params;
      const actor = getActor(req);
      const item = await expirationService.updateItem(type, id, req.body || {}, actor);

      try {
        io?.publish?.auditUpdated?.({ reason: 'expiration_item_updated', type, id, actor });
      } catch {}

      res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/:type/:id/mark-complete', requireAuth, apiLimiter, express.json(), async (req, res, next) => {
    try {
      const { type, id } = req.params;
      const actor = getActor(req);
      const item = await expirationService.markComplete(type, id, req.body || {}, actor);

      try {
        io?.publish?.auditUpdated?.({ reason: 'expiration_item_completed', type, id, actor });
      } catch {}

      res.json({ ok: true, item });
    } catch (e) {
      next(e);
    }
  });

  router.post('/api/bulk-update', requireAuth, apiLimiter, express.json(), async (req, res, next) => {
    try {
      const actor = getActor(req);
      const result = await expirationService.bulkUpdate({
        ...(req.body || {}),
        actor,
      });

      try {
        io?.publish?.auditUpdated?.({ reason: 'expiration_bulk_updated', actor, count: result.count });
      } catch {}

      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post('/refresh', requireAuth, apiLimiter, (_req, res) => {
    try {
      io?.publish?.auditUpdated?.({ reason: 'expiration_refresh' });
    } catch {}
    res.json({ ok: true });
  });

  return router;
};