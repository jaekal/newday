import crypto from 'crypto';
import ApiKeys from '../services/apiKeysService.js';

function timingSafeEqual(a, b) {
  const A = Buffer.from(a || '');
  const B = Buffer.from(b || '');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function headerToHex(sig) {
  // Accept: "sha256=<hex>", "<hex>", or base64
  const s = String(sig || '').trim();
  if (!s) return null;
  const raw = s.startsWith('sha256=') ? s.slice(7) : s;

  if (/^[0-9a-fA-F]+$/.test(raw)) return raw.toLowerCase(); // hex
  try {
    // base64 → hex
    return Buffer.from(raw, 'base64').toString('hex').toLowerCase();
  } catch {
    return null;
  }
}

/** Optional timestamp skew check to limit replay.
 *  Enable by setting WEBHOOK_MAX_SKEW_SEC (e.g., 900).
 *  Client should send X-Webhook-Timestamp (unix seconds or ISO).
 */
function isTimestampFresh(req) {
  const skew = Number(process.env.WEBHOOK_MAX_SKEW_SEC || 0);
  if (!Number.isFinite(skew) || skew <= 0) return true;
  const h = String(req.headers['x-webhook-timestamp'] || '').trim();
  if (!h) return true; // header optional: don’t break existing senders
  let tsMs = Number(h) * 1000;
  if (!Number.isFinite(tsMs)) {
    const d = new Date(h);
    tsMs = Number.isNaN(+d) ? NaN : +d;
  }
  if (!Number.isFinite(tsMs)) return false;
  const delta = Math.abs(Date.now() - tsMs) / 1000;
  return delta <= skew;
}

/**
 * Optional HMAC check over the body.
 * Prefers req.rawBody (Buffer) if you capture it in express.json verify().
 * Falls back to JSON.stringify(req.body).
 */
function verifySignature(req, secret) {
  const presentedHex = headerToHex(req.headers['x-webhook-signature']);
  if (!presentedHex) return true; // no/invalid header → skip quietly

  if (!isTimestampFresh(req)) return false;

  const key = String(secret || '');
  const raw = req.rawBody
    ? (Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody))
    : Buffer.from(JSON.stringify(req.body ?? {}));

  const macHex = crypto.createHmac('sha256', key).update(raw).digest('hex').toLowerCase();
  return timingSafeEqual(macHex, presentedHex);
}

export default function apiKeyAuth(requiredScopes = []) {
  return async (req, res, next) => {
    try {
      const rawKey = String(req.headers['x-api-key'] || '').trim();
      if (!rawKey) return res.status(401).json({ message: 'Missing X-API-Key' });

      const record = await ApiKeys.verifyKey(rawKey);
      if (!record) return res.status(401).json({ message: 'Invalid API key' });
      if (record.revoked) return res.status(403).json({ message: 'API key revoked' });

      // Scope check
      const scopes = new Set(record.scopes || []);
      for (const s of requiredScopes) {
        if (!scopes.has(s)) {
          return res.status(403).json({ message: `Missing scope: ${s}` });
        }
      }

      // Optional HMAC verification (only if header is present)
      if (!verifySignature(req, record.secret)) {
        return res.status(401).json({ message: 'Invalid webhook signature' });
      }

      req.apiKey = {
        id: record.id,
        name: record.name,
        scopes: record.scopes || [],
        secret: record.secret || '',
      };
      // Best-effort access log/touch
      await ApiKeys.touch(record.id).catch(() => {});

      next();
    } catch (e) {
      next(e);
    }
  };
}
