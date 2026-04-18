// routes/integrations.js
import express from 'express';
import apiKeyAuth from '../middleware/apiKeyAuth.js';
import idempotency from '../middleware/idempotency.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { Asset } from '../models/index.js';
import inventoryRepo from '../services/inventoryRepo.js';
import taskService from '../services/taskService.js';
import crypto from 'crypto';

const router = express.Router();

// Narrow-scope checker per endpoint
const requireScopes = (scopes) => apiKeyAuth(scopes);

/** Optional HMAC (SHA-256) verification for webhook-style posts.
 *  Uses X-Webhook-Signature header. If req.rawBody is present, we use it.
 *  Else we fallback to JSON stringify of parsed body (less strict).
 *  Header may be "sha256=<hex>" or just "<hex>".
 */
function verifyOptionalHmac(req) {
  const provided = String(req.headers['x-webhook-signature'] || '').trim();
  const secret = req.apiKey?.secret || ''; // set by apiKeyAuth
  if (!provided || !secret) return true;   // nothing to verify → allow

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody ?? Buffer.from(JSON.stringify(req.body || {})))
    .digest('hex');

  const cleanProvided = provided.startsWith('sha256=') ? provided.slice(7) : provided;

  const A = Buffer.from(expectedHex, 'utf8');
  const B = Buffer.from(cleanProvided, 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * POST /integrations/inbound
 * Headers:
 *   X-API-Key: <key>                         (required; validated by apiKeyAuth)
 *   X-Webhook-Signature: optional HMAC (hex or "sha256=<hex>") of JSON body using the key’s secret
 *   Idempotency-Key: optional, to prevent accidental replays
 * Body: { type: string, ... }
 */
router.post(
  '/inbound',
  apiLimiter,
  idempotency(),
  requireScopes(['webhook:write']),
  async (req, res, next) => {
    try {
      // Optional HMAC verification (only if header present)
      if (!verifyOptionalHmac(req)) {
        return res.status(401).json({ message: 'Invalid webhook signature' });
      }

      const { type } = req.body || {};
      if (!type) return res.status(400).json({ message: 'Missing type' });

      switch (type) {
        case 'asset.update': {
          const { asset = {} } = req.body || {};
          const tag = String(asset.tagNumber || '').trim();
          if (!tag) return res.status(400).json({ message: 'asset.tagNumber required' });

          const fields = ['name', 'location', 'status', 'category', 'description'];
          const payload = {};
          for (const f of fields) if (asset[f] != null) payload[f] = String(asset[f]);

          if (Object.keys(payload).length === 0) {
            return res.status(400).json({ message: 'No updatable fields provided' });
          }

          const existing = await Asset.findOne({ where: { tagNumber: tag } });
          if (!existing) return res.status(404).json({ message: 'Asset not found', tagNumber: tag });

          await existing.update(payload);

          // Publish socket signal if available
          req.app?.get('io')?.publish?.assetsUpdated?.({ reason: 'integration', tagNumber: tag });

          return res.json({ message: 'Asset updated', id: existing.id, updated: payload });
        }

        case 'inventory.checkout': {
          const code = String((req.body || {}).code || '').trim();
          const qtyNum = Number((req.body || {}).qty);
          const operatorId = String((req.body || {}).operatorId || 'api').trim();

          if (!code) return res.status(400).json({ message: 'code required' });
          if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
            return res.status(400).json({ message: 'qty must be a positive number' });
          }

          const item = await inventoryRepo.checkout({
            code,
            qty: qtyNum,
            operatorId,
            actor: `api:${req.apiKey?.id || 'unknown'}`,
          });

          return res.json({ message: 'Checked out', item });
        }

        case 'incident.create': {
          const { title, description, dueDate, priority, category } = req.body || {};
          const user = { id: `api:${req.apiKey?.id || 'unknown'}`, role: 'lead' }; // allowed to create

          const created = await taskService.createTask(user, {
            title: String(title || 'External Incident'),
            description: String(description || ''),
            domain: 'project',
            kind: 'project',
            source: 'integration',
            bucket: 'todo',
            dueDate: String(dueDate || ''),
            meta: { priority: String(priority || 'normal'), category: String(category || '') },
          });

          // Publish socket signal if available
          req.app?.get('io')?.publish?.projectsUpdated?.({ reason: 'integration_incident', id: created.id });

          return res.status(201).json({ message: 'Incident task created', task: created });
        }

        default:
          return res.status(400).json({ message: 'Unsupported type', type });
      }
    } catch (e) {
      next(e);
    }
  }
);

export default (_io, _app) => router;
