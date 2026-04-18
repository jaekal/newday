// routes/labels.js
import express from 'express';
import Joi from 'joi';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import idempotency from '../middleware/idempotency.js';
import { buildZpl, queueAndMaybeProxy } from '../services/labelService.js';

const printSchema = Joi.object({
  templateId: Joi.string().trim().allow(''),
  template: Joi.string().trim().allow(''),
  data: Joi.object().unknown(true).default({}),
  copies: Joi.number().integer().min(1).max(100).default(1),
}).or('templateId', 'template'); // require at least one

export default function labelsRouter(io, app) {
  const router = express.Router();

  // POST /labels/print { templateId?, template?, data, copies }
  router.post(
    '/print',
    sensitiveLimiter,
    idempotency(),
    async (req, res, next) => {
      try {
        const { error, value } = printSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: true,
        });
        if (error) {
          return res
            .status(400)
            .json({ message: 'Validation failed', details: error.details });
        }

        const { templateId, template, data, copies } = value;
        const zpl = await buildZpl({ templateId, template, data, copies });
        const { file, proxied } = await queueAndMaybeProxy(zpl);

        res.json({ ok: true, queuedFile: file, sentToProxy: proxied, zpl });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
