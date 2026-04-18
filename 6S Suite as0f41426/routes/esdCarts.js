// routes/esdCarts.js
import express from 'express';
import Joi from 'joi';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import * as esdCarts from '../services/esdCarts.js';

const idSchema = Joi.object({
  cartId: Joi.string().trim().required()
});

/**
 * Kiosk and some clients send `operatorId` as a number; Joi.string() rejects that and yields 400.
 * Normalize to strings before applying business rules.
 */
function parseActorBody(raw) {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let operatorId = b.operatorId;
  if (operatorId != null && operatorId !== '') operatorId = String(operatorId).trim();
  else operatorId = '';
  let comment = b.comment;
  if (comment != null && comment !== '') comment = String(comment).trim().slice(0, 2000);
  else comment = '';
  return { operatorId, comment };
}

function profileOperatorId(req) {
  const u = req.session?.user || req.user || {};
  return String(
    u.techId || u.employeeId || u.id || u.username || ''
  ).trim();
}

function resolveOperatorAndOverride(req, body) {
  const profileOp = profileOperatorId(req);
  const bodyOp = String(body?.operatorId ?? '').trim();
  const effective = bodyOp || profileOp;
  const operatorOverride = !!(profileOp && bodyOp && bodyOp !== profileOp);
  return { profileOp, bodyOp, effective, operatorOverride };
}

const updateSchema = Joi.object({
  id: Joi.string().trim().required(),
  status: Joi.string().valid('available', 'checked_out').required(),
  holder: Joi.string().allow('', null).optional(),
  building: Joi.string().allow('').optional()
});

export default function esdCartsRouter(io) {
  const router = express.Router();

  // GET /esd-carts — list all carts
  router.get('/', requireAuth, async (_req, res, next) => {
    try {
      res.json({ carts: await esdCarts.getAll({ building: _req.query?.building || '' }) });
    } catch (e) {
      next(e);
    }
  });

  // GET /esd-carts/audit — last 500 audit entries
  router.get('/audit', requireAuth, async (_req, res, next) => {
    try {
      res.json(await esdCarts.getAuditLog(500));
    } catch (e) {
      next(e);
    }
  });

  // GET /esd-carts/admin/capabilities
  router.get('/admin/capabilities', requireAuth, async (req, res) => {
    const role = String(req.user?.role || req.session?.user?.role || '').toLowerCase();
    const canManage = role === 'admin' || role === 'lead';
    res.json({ canManage });
  });

  // POST /esd-carts/:cartId/checkout
  router.post('/:cartId/checkout', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const { error: e1 } = idSchema.validate(req.params);
      if (e1) return res.status(400).json({ message: 'Invalid cart id' });

      const value = parseActorBody(req.body);
      const cartId = req.params.cartId.trim();
      const { effective, operatorOverride, profileOp } = resolveOperatorAndOverride(req, value);
      if (!effective) {
        return res.status(400).json({
          message: 'Operator ID is required. Your profile has no tech ID — use Override to enter one, or ask an admin to set your technician ID.',
        });
      }

      const comment = value.comment;
      const cart = await esdCarts.checkout(cartId, effective, {
        comment,
        operatorOverride,
        profileOperatorId: profileOp,
      });

      io?.emit?.('kiosk:cart.checkout', { cartId, operatorId: effective, at: cart.updatedAt });
      io?.emit?.('esdCarts:checkout', { cartId, operatorId: effective, cart, at: cart.updatedAt });

      return res.status(200).json({ message: 'Cart checked out', cart });
    } catch (e) {
      if (e.message?.includes('already checked out')) {
        return res.status(409).json({ message: e.message });
      }
      next(e);
    }
  });

  // POST /esd-carts/:cartId/checkin
  router.post('/:cartId/checkin', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const { error: e1 } = idSchema.validate(req.params);
      if (e1) return res.status(400).json({ message: 'Invalid cart id' });

      const value = parseActorBody(req.body);
      const cartId = req.params.cartId.trim();
      const { effective, operatorOverride, profileOp } = resolveOperatorAndOverride(req, value);
      if (!effective) {
        return res.status(400).json({
          message: 'Operator ID is required. Your profile has no tech ID — use Override to enter one, or ask an admin to set your technician ID.',
        });
      }

      const comment = value.comment;
      const cart = await esdCarts.checkin(cartId, effective, {
        comment,
        operatorOverride,
        profileOperatorId: profileOp,
      });

      io?.emit?.('kiosk:cart.return', { cartId, operatorId: effective, at: cart.updatedAt });
      io?.emit?.('esdCarts:return', { cartId, operatorId: effective, cart, at: cart.updatedAt });

      return res.status(200).json({ message: 'Cart returned', cart });
    } catch (e) {
      next(e);
    }
  });

  // POST /esd-carts/admin/add   body: { cartId }
  router.post('/admin/add', requireAuth, requireRole('admin', 'lead'), async (req, res, next) => {
    try {
      const cartId = String(req.body?.cartId || '').trim();
      if (!cartId) return res.status(400).json({ message: 'cartId required' });

      const building = String(req.body?.building || '').trim();
      const existing = await esdCarts.get(cartId);
      if (existing) {
        return res.status(409).json({ message: 'Cart already exists' });
      }

      const cart = await esdCarts.upsert({
        id: cartId,
        status: 'available',
        holder: null,
        building
      });

      io?.emit?.('esdCarts:updated', { cartId, cart });
      res.status(201).json({ message: 'Cart added', cart });
    } catch (e) {
      next(e);
    }
  });

  // PUT /esd-carts/admin/:id
  router.put('/admin/:id', requireAuth, requireRole('admin', 'lead'), async (req, res, next) => {
    try {
      const originalId = String(req.params.id || '').trim();
      if (!originalId) return res.status(400).json({ message: 'Original cart id is required' });

      const { error, value } = updateSchema.validate(req.body || {});
      if (error) return res.status(400).json({ message: 'Invalid input' });

      const nextCartId = String(value.id || '').trim();
      const nextStatus = String(value.status || '').trim();
      const nextHolder = nextStatus === 'checked_out'
        ? String(value.holder || '').trim()
        : '';

      if (nextStatus === 'checked_out' && !nextHolder) {
        return res.status(400).json({ message: 'Holder is required when status is checked out' });
      }

      const updated = await esdCarts.updateCart(originalId, {
        id: nextCartId,
        status: nextStatus,
        holder: nextHolder || null,
        building: String(value.building || '').trim()
      });

      io?.emit?.('esdCarts:updated', {
        originalId,
        cartId: updated.id,
        cart: updated,
        at: updated.updatedAt
      });

      res.json({ message: 'Cart updated', cart: updated });
    } catch (e) {
      if (e.message === 'Cart not found') {
        return res.status(404).json({ message: e.message });
      }
      if (e.message === 'Target cart id already exists') {
        return res.status(409).json({ message: e.message });
      }
      next(e);
    }
  });

  // DELETE /esd-carts/admin/:id
  router.delete('/admin/:id', requireAuth, requireRole('admin', 'lead'), async (req, res, next) => {
    try {
      const cartId = String(req.params.id || '').trim();
      const removed = await esdCarts.remove(cartId);

      io?.emit?.('esdCarts:removed', { cartId: removed.id, at: new Date().toISOString() });
      res.json({ message: 'Cart removed', cartId: removed.id });
    } catch (e) {
      if (e.message === 'Cart not found') {
        return res.status(404).json({ message: e.message });
      }
      if (e.message === 'Cannot remove a checked-out cart') {
        return res.status(409).json({ message: e.message });
      }
      next(e);
    }
  });

  return router;
}
