import crypto from 'crypto';

// In-memory store with TTL + hard size cap. For multi-instance deployments,
// swap this out for Redis/another shared store.
const store = new Map(); // key -> { ts, hash, path, method }
const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 12 * 60 * 60 * 1000);
const CLEAN_INTERVAL = Number(process.env.IDEMPOTENCY_SWEEP_MS || 10 * 60 * 1000);
// Hard ceiling on stored keys. A burst of unique Idempotency-Key values (or a
// misbehaving client / attacker) could otherwise grow the Map without bound
// between sweeps. When we exceed the cap we evict the oldest insertions first.
const MAX_ENTRIES = Math.max(1000, Number(process.env.IDEMPOTENCY_MAX_ENTRIES || 50_000));

function evictExpired(now = Date.now()) {
  for (const [k, v] of store) if (now - v.ts > TTL_MS) store.delete(k);
}

function evictOldestIfOver() {
  if (store.size <= MAX_ENTRIES) return;
  // JavaScript Map iterates in insertion order, so this is effectively FIFO
  // eviction — cheap and good enough for an abuse-safety ceiling.
  const overflow = store.size - MAX_ENTRIES;
  let removed = 0;
  for (const k of store.keys()) {
    if (removed >= overflow) break;
    store.delete(k);
    removed += 1;
  }
}

setInterval(() => {
  evictExpired();
  evictOldestIfOver();
}, CLEAN_INTERVAL).unref?.();

function bodyHash(req) {
  const raw = JSON.stringify(req.body ?? {});
  return crypto
    .createHash('sha256')
    .update(`${req.method}\n${req.originalUrl}\n${raw}`)
    .digest('hex');
}

function pickKey(req) {
  // Accept both Idempotency-Key and X-Idempotency-Key (case-insensitive)
  return (
    String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim() ||
    ''
  );
}

// By default, only enforce for non-idempotent methods
const DEFAULT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export default function idempotency({ methods = DEFAULT_METHODS } = {}) {
  return (req, res, next) => {
    const key = pickKey(req);
    if (!key) return next();

    if (methods && !methods.has(req.method)) {
      // Ignore key for GET/HEAD/etc unless explicitly enabled via options
      return next();
    }

    // Basic sanity on key (avoid absurdly large keys)
    if (key.length > 256) {
      return res.status(400).json({ message: 'Idempotency key too long' });
    }

    const h = bodyHash(req);
    const existing = store.get(key);

    // Always echo the key back if present
    res.setHeader('Idempotency-Key', key);

    if (existing) {
      const sameTarget = existing.path === req.originalUrl && existing.method === req.method;
      const sameHash = existing.hash === h;
      if (sameTarget && sameHash) {
        return res.status(409).json({ message: 'Duplicate request (idempotency)', key });
      }
      return res
        .status(409)
        .json({ message: 'Idempotency key reuse with different payload', key });
    }

    store.set(key, { ts: Date.now(), hash: h, path: req.originalUrl, method: req.method });
    if (store.size > MAX_ENTRIES) evictOldestIfOver();
    next();
  };
}
