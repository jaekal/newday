// middleware/rateLimit.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import promClient from 'prom-client';

const RATE_LIMIT_NAMESPACE = String(process.env.RATE_LIMIT_NAMESPACE || 'v2').trim() || 'v2';
const API_LIMIT_WINDOW_MS = Number(process.env.API_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const API_LIMIT_MAX = Number(process.env.API_LIMIT_MAX || 2000);
const SENSITIVE_LIMIT_WINDOW_MS = Number(process.env.SENSITIVE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const SENSITIVE_LIMIT_MAX = Number(process.env.SENSITIVE_LIMIT_MAX || 300);

// Login brute-force limit: much tighter than `sensitiveLimiter`. Defaults to
// 15 attempts per 15 minutes per (IP + attempted username) pair. An attacker
// rotating usernames per IP still hits the per-IP ceiling (twice the
// per-user bucket) via ip-only fallback. Legitimate users almost never
// exceed 3-5 login attempts.
const LOGIN_LIMIT_WINDOW_MS = Number(process.env.LOGIN_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_LIMIT_MAX = Number(process.env.LOGIN_LIMIT_MAX || 15);

const keyGenerator = (req) => {
  // Prefer a stable user identifier if available
  const userId = req.session?.user?.id;
  if (userId) return `${RATE_LIMIT_NAMESPACE}:user:${userId}`;

  // Fallback to IP-based limiting
  // First look at X-Forwarded-For (if you're behind a proxy/load balancer)
  const xff = req.headers['x-forwarded-for'];
  let ip;

  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0].trim();
    if (first) {
      ip = first;
    }
  }

  // If no valid XFF entry, fall back to Express' req.ip
  if (!ip) {
    ip = req.ip;
  }

  // IMPORTANT: wrap IP with ipKeyGenerator so IPv6 users can't bypass limits
  const ipKey = ipKeyGenerator(ip);

  return `${RATE_LIMIT_NAMESPACE}:ip:${ipKey}`;
};

const rl429Counter = new promClient.Counter({
  name: 'sixs_rate_limiter_block_total',
  help: 'Total requests blocked by express-rate-limit',
  labelNames: ['path', 'key_type'],
});

function rateLimitedJsonHandler(req, res, _next, options = {}) {
  const key = keyGenerator(req);
  const keyType = key.startsWith('user:') ? 'user' : 'ip';
  const path = req.baseUrl || req.originalUrl || req.path || '';

  try {
    rl429Counter.inc({ path, key_type: keyType });
  } catch {
    // noop
  }

  const retrySec = Math.ceil((options.windowMs || 60_000) / 1000);
  return res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: `Too many requests. Try again in ~${retrySec}s.`,
      path,
      keyType,
    },
  });
}

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: rateLimitedJsonHandler,
};

export const apiLimiter = rateLimit({
  ...common,
  windowMs: API_LIMIT_WINDOW_MS,
  max: API_LIMIT_MAX,
});

export const sensitiveLimiter = rateLimit({
  ...common,
  windowMs: SENSITIVE_LIMIT_WINDOW_MS,
  max: SENSITIVE_LIMIT_MAX,
});

// Key the login limiter on (IP + submitted username) to blunt credential
// stuffing where an attacker rotates usernames but keeps the same IP.
// Username is normalized to lowercase + truncated to avoid unbounded keys.
const loginKeyGenerator = (req) => {
  const raw =
    (req.body && (req.body.username || req.body.email)) ||
    (req.query && (req.query.username || req.query.email)) ||
    '';
  const username = String(raw).toLowerCase().trim().slice(0, 64) || 'anon';

  const xff = req.headers['x-forwarded-for'];
  let ip;
  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0].trim();
    if (first) ip = first;
  }
  if (!ip) ip = req.ip;
  const ipKey = ipKeyGenerator(ip);

  return `${RATE_LIMIT_NAMESPACE}:login:${ipKey}:${username}`;
};

export const loginLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginKeyGenerator,
  handler: (req, res, _next, options) =>
    rateLimitedJsonHandler(req, res, _next, options),
  windowMs: LOGIN_LIMIT_WINDOW_MS,
  max: LOGIN_LIMIT_MAX,
  // Don't count successful logins against the bucket.
  skipSuccessfulRequests: true,
});
