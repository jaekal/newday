import express from 'express';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import idempotency from '../middleware/idempotency.js';
import WebhooksOut from '../services/webhooksOutService.js';
import { s } from '../utils/text.js';

const router = express.Router();

const asBool = (v) => (typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true');

function validateIntegrationPayload(body = {}) {
  const type = s(body.type || 'generic').toLowerCase();
  const cfg = body.config || {};

  switch (type) {
    case 'slack':
      if (!s(cfg.webhookUrl || cfg.url)) return 'Slack config requires webhookUrl';
      break;
    case 'jira':
      if (!s(cfg.baseUrl) || !s(cfg.email) || !s(cfg.apiToken) || !s(cfg.projectKey)) {
        return 'Jira config requires baseUrl, email, apiToken, projectKey';
      }
      break;
    case 'servicenow':
      if (!s(cfg.instance) || !s(cfg.user) || !s(cfg.password)) {
        return 'ServiceNow config requires instance, user, password';
      }
      break;
    case 'generic':
    default:
      if (!s(cfg.url)) return 'Generic webhook requires url';
      break;
  }
  return null;
}

function normalizeIntegrationPayload(body = {}) {
  const name = s(body.name || 'Integration');
  const type = s(body.type || 'generic').toLowerCase();
  const enabled = asBool(body.enabled ?? true);

  // Ensure array of strings, unique
  const subscribedEvents = Array.isArray(body.subscribedEvents)
    ? [...new Set(body.subscribedEvents.map(String))]
    : [];

  // Pass config verbatim (service will redact on list)
  const config = body.config && typeof body.config === 'object' ? body.config : {};

  const rec = { name, type, enabled, subscribedEvents, config };
  if (body.id) rec.id = s(body.id);
  return rec;
}

// List (redacted by default via service)
router.get('/list', sensitiveLimiter, async (_req, res, next) => {
  try {
    const list = await WebhooksOut.list(); // redacted=true by default
    res.json(list);
  } catch (e) { next(e); }
});

// Read one (by id, redacted)
router.get('/:id', sensitiveLimiter, async (req, res, next) => {
  try {
    const all = await WebhooksOut.list();
    const rec = all.find(x => x.id === s(req.params.id));
    if (!rec) return res.status(404).json({ message: 'Not found' });
    res.json(rec);
  } catch (e) { next(e); }
});

// Create (upsert) — idempotent
router.post('/', sensitiveLimiter, idempotency(), async (req, res, next) => {
  try {
    const errMsg = validateIntegrationPayload(req.body || {});
    if (errMsg) return res.status(400).json({ message: errMsg });

    const rec = await WebhooksOut.upsert(normalizeIntegrationPayload(req.body || {}));
    res.status(201).json({ message: 'Saved', integration: rec });
  } catch (e) { next(e); }
});

// Update (upsert by id) — idempotent
router.put('/:id', sensitiveLimiter, idempotency(), async (req, res, next) => {
  try {
    const errMsg = validateIntegrationPayload(req.body || {});
    if (errMsg) return res.status(400).json({ message: errMsg });

    const payload = normalizeIntegrationPayload({ ...req.body, id: req.params.id });
    const rec = await WebhooksOut.upsert(payload);
    res.json({ message: 'Saved', integration: rec });
  } catch (e) { next(e); }
});

// Delete
router.delete('/:id', sensitiveLimiter, async (req, res, next) => {
  try {
    const ok = await WebhooksOut.remove(req.params.id);
    if (!ok) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { next(e); }
});

// Fire a test delivery for a target
router.post('/:id/test', sensitiveLimiter, async (req, res, next) => {
  try {
    const { event, payload } = req.body || {};
    const out = await WebhooksOut.test(
      req.params.id,
      s(event) || 'test.event',
      (payload && typeof payload === 'object') ? payload : { ok: true }
    );
    res.json(out);
  } catch (e) { next(e); }
});

export default (_io, _app) => router;
