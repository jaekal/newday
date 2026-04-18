// routes/auditObs.js
import express from 'express';
import Joi from 'joi';
import taskService from '../services/taskService.js';
import { requireAuth } from '../middleware/auth.js';
import { s } from '../utils/text.js';

/* ───────── validation ───────── */
const createObsSchema = Joi.object({
  params: Joi.object({
    id: Joi.string().trim().required(), // audit task id
  }),
  body: Joi.object({
    state: Joi.string().trim().min(1).max(32).default('found'),
    assetId: Joi.alternatives().try(Joi.string().trim(), Joi.number()).optional(),
    barcode: Joi.string().trim().allow(''),
    note: Joi.string().trim().max(2000).allow(''),
    locationId: Joi.string().trim().allow(''),
  }),
  query: Joi.object({}),
});

const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(
    { body: req.body, params: req.params, query: req.query },
    { abortEarly: false, allowUnknown: true }
  );
  if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });
  req.validatedBody = value.body;
  req.validatedParams = value.params;
  next();
};

export default function auditObsRouter(io /*, app */) {
  const router = express.Router();

  /**
   * POST /audit-obs/:id/observations
   * Body: { state, assetId?, barcode?, note?, locationId? }
   * Notes:
   *  - Requires auth
   *  - Only allowed on audit *instances* (not templates). Service throws if invalid.
   */
  router.post(
    '/:id/observations',
    requireAuth,
    express.json(),
    validate(createObsSchema),
    async (req, res, next) => {
      try {
        const actor = s(req.session?.user?.id) || 'system';
        const obs = await taskService.addAuditObservation(req.validatedParams.id, {
          ...req.validatedBody,
          actor,
        });
        io?.publish?.auditUpdated?.({
          reason: 'audit_observation',
          auditId: req.validatedParams.id,
        });
        res.status(201).json({ ok: true, observation: obs });
      } catch (err) {
        const msg = String(err?.message || '');
        if (/Audit not found/i.test(msg)) return res.status(404).json({ message: 'Audit not found' });
        if (/Not an audit instance/i.test(msg)) return res.status(400).json({ message: 'Not an audit instance' });
        next(err);
      }
    }
  );

  return router;
}
