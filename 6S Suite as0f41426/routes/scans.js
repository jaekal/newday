import express from 'express';
import { apiLimiter } from '../middleware/rateLimit.js';
import idempotency from '../middleware/idempotency.js';
import { processBatch } from '../services/scanService.js';

const SCANS_BATCH_MAX = Number(process.env.SCANS_BATCH_MAX || 500);

export default function scansRouter(io, app) {
  const router = express.Router();

  // Simple liveness check (handy for devices)
  router.get('/ping', (_req, res) => res.json({ ok: true }));

  // POST /scans/batch
  // Body: { scans:[{ barcode, action, payload, ts }], operatorId, strict }
  router.post(
    '/batch',
    apiLimiter,
    idempotency(), // optional: Idempotency-Key header prevents accidental replays
    async (req, res, next) => {
      try {
        const actor = req.session?.user?.id || 'system';

        const scans = Array.isArray(req.body?.scans) ? req.body.scans : null;
        const operatorId = String(req.body?.operatorId || '');
        const strict = !!req.body?.strict;

        if (!scans) {
          return res.status(400).json({ message: 'scans must be an array' });
        }
        if (scans.length === 0) {
          return res.status(400).json({ message: 'scans array is empty' });
        }
        if (scans.length > SCANS_BATCH_MAX) {
          return res.status(413).json({
            message: `Too many scans in one batch (max ${SCANS_BATCH_MAX})`,
            max: SCANS_BATCH_MAX,
            received: scans.length,
          });
        }

        const results = await processBatch({ scans, operatorId, strict, actor, io });
        res.json({ ok: true, count: results.length, results });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
