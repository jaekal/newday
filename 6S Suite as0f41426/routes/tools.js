// routes/tools.js
import express from 'express';
import Joi from 'joi';

import idempotency from '../middleware/idempotency.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { requireAnyTool } from '../middleware/roleCheck.js';

// Tool service (CRUD/checkout/return for tools dataset)
import toolService from '../services/toolService.js';
import {
  createPartBorrow,
  listOpenGoldenSampleBorrows,
  returnPartBorrow,
} from '../services/partBorrows.js';

// Inventory adapter (JSON or Sequelize) used by /tools/return convenience endpoint
import inventoryRepo from '../services/inventoryRepo.js';
import { s } from '../utils/text.js';

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ───────── validation ───────── */
const serialParam = Joi.object({
  serialNumber: Joi.string().trim().required(),
});

const checkoutToolSchema = Joi.object({
  params: serialParam,
  body: Joi.object({ operatorId: Joi.string().trim().required() }),
  query: Joi.object({}),
});

const returnToolSchema = Joi.object({
  params: serialParam,
  body: Joi.object({}).unknown(true),
  query: Joi.object({}),
});

const bulkCheckoutSchema = Joi.object({
  body: Joi.object({
    serialNumbers: Joi.array().items(Joi.string().trim()).min(1).required(),
    operatorId: Joi.string().trim().required(),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const bulkReturnSchema = Joi.object({
  body: Joi.object({
    serialNumbers: Joi.array().items(Joi.string().trim()).min(1).required(),
  }),
  params: Joi.object({}),
  query: Joi.object({}),
});

const singleInvReturnSchema = Joi.object({
  code: Joi.string().trim().required(),           // inventory ItemCode
  qty: Joi.number().integer().min(1).required(),
  operatorId: Joi.string().allow(''),
  sixSOperator: Joi.string().allow(''),
});

const bulkInvReturnSchema = Joi.object({
  items: Joi.array().items(singleInvReturnSchema).min(1).required()
});

/**
 * Convenience schemas for kiosk-style tool checkout/return.
 * These operate on the **tools dataset** (same as screwdriver page),
 * bridging from generic { code, qty, operatorId } to the
 * existing per-serial endpoints.
 */
const kioskCheckoutSchema = Joi.object({
  code: Joi.string().trim().required(),                  // tool serial
  qty: Joi.number().integer().min(1).default(1),
  operatorId: Joi.string().trim().required(),
  sixSOperator: Joi.string().allow(''),
});

const kioskReturnSchema = Joi.object({
  code: Joi.string().trim().required(),                  // tool serial
  qty: Joi.number().integer().min(1).default(1),
  operatorId: Joi.string().allow(''),
});

/** Golden-sample part borrows (same ledger as kiosk; purpose forced server-side). */
const goldenFloorBorrowSchema = Joi.object({
  targetServerSn: Joi.string().trim().min(1).max(120).required(),
  donorServerSn: Joi.string().trim().allow('').max(120),
  partSn: Joi.string().trim().min(1).max(120).required(),
  notes: Joi.string().trim().allow('').max(2000),
  expectedReturnHours: Joi.number().integer().min(1).max(720).allow(null),
});

const goldenFloorReturnSchema = Joi.object({
  borrowId: Joi.string().trim().allow(''),
  partSn: Joi.string().trim().allow('').max(120),
  condition: Joi.string().trim().valid('Good', 'Damaged', 'Consumed', 'Not returned — logged').required(),
  notes: Joi.string().trim().allow('').max(2000),
});

function sessionActor(req) {
  const u = req.session?.user || {};
  return String(
    u.techId || u.employeeId || u.id || u.username || u.email || u.name || 'anonymous'
  ).trim();
}

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(
    { body: req.body, params: req.params, query: req.query },
    { abortEarly: false, allowUnknown: true }
  );
  if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });
  req.validatedBody = value.body;
  req.validatedParams = value.params;
  req.validatedQuery = value.query;
  next();
};

/* ───────── helpers ───────── */
// Compute derived flags fresh from numeric fields to avoid dependency on pre-set flags
function deriveInventoryState(item) {
  const qty = Number(item.OnHandQty) || 0;
  const safety = Number(item.SafetyLevelQty) || 0;
  const below = qty <= safety;
  let status = 'In Stock';
  if (qty === 0) status = 'Out of Stock';
  else if (below) status = 'Low Stock';
  return { below, status };
}

/* ───────── router factory ───────── */
export default function toolsRouter(io /*, app */) {
  const router = express.Router();

  // --- Order matters: put static/non-param routes before "/:serialNumber" ---

  /** CSV export of tools */
  router.get('/export', toolService.exportToolsCSV);

  /**
   * Inventory return convenience endpoint (back-compat):
   * POST /tools/return
   * Accepts either:
   *  - { code, qty, operatorId?, sixSOperator? }  (single)
   *  - { items: [{ code, qty, operatorId?, sixSOperator? }, ...] } (bulk)
   *
   * NOTE: This operates on the Inventory store, not the Tools store.
   * It uses the backend-agnostic inventoryRepo (JSON or Sequelize).
   */
  router.post('/return', ah(async (req, res) => {
    // Validate "either single or bulk"
    const single = singleInvReturnSchema.validate(req.body, { abortEarly: false, allowUnknown: true });
    const bulk   = bulkInvReturnSchema.validate(req.body,   { abortEarly: false, allowUnknown: true });

    let payload;
    if (!single.error && req.body && !req.body.items) {
      payload = [single.value];
    } else if (!bulk.error) {
      payload = bulk.value.items;
    } else {
      const details = (single.error || bulk.error)?.details || [];
      return res.status(400).json({ message: 'Validation failed', details });
    }

    const updated = [];
    const notFound = [];
    const actor = req.session?.user?.id ?? req.ip;

    for (const it of payload) {
      try {
        const cur = await inventoryRepo.getItemByCode(it.code);
        if (!cur) { notFound.push(it.code); continue; }

        const beforeQty = Number(cur.OnHandQty) || 0;
        const qty = Number(it.qty) || 0;
        const nextQty = beforeQty + qty;

        // Update using repo to stay backend-agnostic
        const { item } = await inventoryRepo.updateItem(it.code, { OnHandQty: nextQty });

        // Ensure derived shape for response
        const { below, status } = deriveInventoryState(item);
        item.BelowSafetyLine = below;
        item.OrderStatus = status;

        updated.push(item);

        await inventoryRepo.addAuditLog({
          ItemCode: it.code,
          qty,
          startingQty: beforeQty,
          operatorId: it.operatorId,
          sixSOperator: it.sixSOperator,
          action: 'return',
          actor,
          time: new Date().toISOString(),
        });
      } catch (_e) {
        // Treat as not found/failed update to avoid aborting the whole batch
        notFound.push(it.code);
      }
    }

    if (updated.length) {
      io?.publish?.inventoryUpdated?.({ reason: 'return', codes: updated.map(i => i.ItemCode) });
      return res.json({ message: 'Return processed', updatedCount: updated.length, notFound, items: updated });
    }

    return res.status(404).json({ message: 'No matching items to return', notFound });
  }));

  /**
   * NEW: kiosk-style tool checkout endpoint
   * POST /tools/checkout
   *
   * Body:
   *   { code, qty?, operatorId, sixSOperator? }
   *
   * This simply forwards to the existing per-serial tools endpoint
   * (toolService.checkoutTool(io)), so screwdriver + realtime stay in sync.
   */
  router.post('/checkout', ah(async (req, res, next) => {
    const { error, value } = kioskCheckoutSchema.validate(req.body || {}, {
      abortEarly: false,
      allowUnknown: true,
    });
    if (error) {
      return res.status(400).json({ message: 'Validation failed', details: error.details });
    }

    const serialNumber = value.code;

    // Map kiosk payload into the shape expected by the existing handler
    req.params = { ...(req.params || {}), serialNumber };
    req.body = { ...(req.body || {}), operatorId: value.operatorId, sixSOperator: value.sixSOperator };

    // Provide "validated" copies in case toolService uses them
    req.validatedParams = { serialNumber };
    req.validatedBody = { operatorId: value.operatorId };

    // Delegate to the existing logic (which already updates tools + emits socket events)
    return toolService.checkoutTool(io)(req, res, next);
  }));

  /**
   * NEW: kiosk-style tool checkin endpoint
   * POST /tools/checkin
   *
   * Body:
   *   { code, qty?, operatorId? }
   *
   * Also forwards into the same return handler used by screwdriver page.
   */
  router.post('/checkin', ah(async (req, res, next) => {
    const { error, value } = kioskReturnSchema.validate(req.body || {}, {
      abortEarly: false,
      allowUnknown: true,
    });
    if (error) {
      return res.status(400).json({ message: 'Validation failed', details: error.details });
    }

    const serialNumber = value.code;

    req.params = { ...(req.params || {}), serialNumber };
    // operatorId is optional; we pass it through in case you want it in logs
    req.body = { ...(req.body || {}), operatorId: value.operatorId };

    req.validatedParams = { serialNumber };
    req.validatedBody = {}; // returnToolSchema doesn't require anything

    return toolService.returnTool(io)(req, res, next);
  }));

  /** Golden sample parts — read open borrows (Command Floor / Floor Tools tab) */
  router.get(
    '/golden-parts',
    requireAnyTool('screwdriver', 'kiosk'),
    apiLimiter,
    ah(async (_req, res) => {
      const borrows = await listOpenGoldenSampleBorrows();
      res.json({ borrows });
    })
  );

  /** Log a golden-sample borrow (same JSONL as /kiosk/part-borrows; purpose = golden_sample). */
  router.post(
    '/golden-parts/borrow',
    requireAnyTool('screwdriver', 'kiosk'),
    apiLimiter,
    idempotency(),
    express.json(),
    ah(async (req, res) => {
      const { error, value } = goldenFloorBorrowSchema.validate(req.body || {}, {
        abortEarly: false,
        allowUnknown: false,
      });
      if (error) {
        return res.status(400).json({ message: 'Invalid golden part borrow', details: error.details });
      }
      const user = req.session?.user || {};
      const actor = sessionActor(req);
      const valueWithPurpose = { ...value, purpose: 'golden_sample' };
      const result = await createPartBorrow({ value: valueWithPurpose, user, actor, io });
      res.status(result.status).json(result.body);
    })
  );

  /** Return a golden-sample borrow (operator must match borrow record). */
  router.post(
    '/golden-parts/return',
    requireAnyTool('screwdriver', 'kiosk'),
    apiLimiter,
    idempotency(),
    express.json(),
    ah(async (req, res) => {
      const { error, value } = goldenFloorReturnSchema.validate(req.body || {}, {
        abortEarly: false,
        allowUnknown: false,
      });
      if (error) {
        return res.status(400).json({ message: 'Invalid golden part return', details: error.details });
      }
      const actor = sessionActor(req);
      const result = await returnPartBorrow({
        value,
        actor,
        sessionUser: req.session?.user || {},
        io,
        allowedPurposes: ['golden_sample'],
      });
      res.status(result.status).json(result.body);
    })
  );

  /** Bulk tools checkout/return (tools dataset) with validation */
  router.post('/bulk/checkout', validate(bulkCheckoutSchema), toolService.bulkCheckout(io));
  router.post('/bulk/return',   validate(bulkReturnSchema),  toolService.bulkReturn(io));

  /** Tools collection routes */
  router.get('/',  toolService.getAllTools);      // GET /tools
  router.post('/', toolService.addTool(io));      // POST /tools

  /** Per-serial routes (define AFTER static/bulk routes) */
  router.get('/:serialNumber', toolService.getTool);
  router.put('/:serialNumber', toolService.editTool(io));
  router.delete('/:serialNumber', toolService.deleteTool(io));

  router.post(
    '/:serialNumber/checkout',
    validate(checkoutToolSchema),
    toolService.checkoutTool(io)
  );

  router.post(
    '/:serialNumber/return',
    validate(returnToolSchema),
    toolService.returnTool(io)
  );

  return router;
}
