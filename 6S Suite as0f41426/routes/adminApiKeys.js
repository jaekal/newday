// routes/adminApiKeys.js
import express from 'express';
import ApiKeys from '../services/apiKeysService.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import idempotency from '../middleware/idempotency.js';

const router = express.Router();

// List (redacted) — relies on service helper; falls back to manual redaction if absent
router.get('/list', sensitiveLimiter, async (_req, res, next) => {
  try {
    const all = (typeof ApiKeys.listRedacted === 'function')
      ? await ApiKeys.listRedacted()
      : (await ApiKeys.list()).map(({ secret, keyHash, ...rest }) => rest);
    res.json(all);
  } catch (e) { next(e); }
});

// Create a new API key (idempotent)
router.post('/', sensitiveLimiter, idempotency(), async (req, res, next) => {
  try {
    const { name, scopes } = req.body || {};
    const scopesArr = Array.isArray(scopes)
      ? scopes
      : (typeof scopes === 'string' ? scopes.split(',') : []);
    const { record, key, secret } = await ApiKeys.create({ name, scopes: scopesArr });
    res.status(201).json({
      message: 'API key created',
      id: record.id,
      key,
      secret,
      scopes: record.scopes,
    });
  } catch (e) { next(e); }
});

// Revoke a key
router.post('/:id/revoke', sensitiveLimiter, async (req, res, next) => {
  try {
    const ok = await ApiKeys.revoke(req.params.id);
    if (!ok) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Revoked' });
  } catch (e) { next(e); }
});

// Rotate secret for a key
router.post('/:id/rotate-secret', sensitiveLimiter, async (req, res, next) => {
  try {
    const { secret } = await ApiKeys.rotateSecret(req.params.id);
    res.json({ message: 'Rotated', secret });
  } catch (e) { next(e); }
});

export default router;
