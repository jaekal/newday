// middleware/csrf.js
//
// Session-bound CSRF protection.
//
// - Stores a per-session token on `req.session.csrfToken`.
// - Exposes the token via `res.locals.csrfToken` (for EJS templates)
//   and via a non-HttpOnly `XSRF-TOKEN` cookie (so static HTML pages
//   whose <meta name="csrf-token"> is empty at build-time can still
//   pick it up at runtime from `document.cookie`).
// - Validates unsafe methods (POST/PUT/PATCH/DELETE) against the
//   session token. Accepts the token from any of:
//     X-CSRF-Token / X-XSRF-TOKEN / CSRF-Token header,
//     body `_csrf`, or query `_csrf`.
// - Exempts webhook/OIDC/health/metric/socket.io paths. Callers that
//   authenticate with API keys (e.g. /integrations POST /inbound)
//   should also be listed in EXEMPT_PREFIXES.
//
// Deliberately dependency-free so it can drop into this repo without
// touching package.json.

import crypto from 'crypto';

const TOKEN_COOKIE = 'XSRF-TOKEN';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EXEMPT_PREFIXES = [
  '/integrations/inbound',
  '/integrations',         // API-key/HMAC authenticated; has its own auth model
  '/auth/oidc/callback',
  '/socket.io',
  '/health',
  '/ping',
  '/metrics',
  '/__up',
  '/__diag',
  '/__boot',
  '/favicon.ico',
  '/images/favicon.png',
  '/api/docs',
];

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function isExemptPath(path) {
  if (!path) return false;
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p));
}

function extractProvided(req) {
  return (
    req.get('X-CSRF-Token') ||
    req.get('X-XSRF-TOKEN') ||
    req.get('CSRF-Token') ||
    (req.body && typeof req.body === 'object' ? req.body._csrf : '') ||
    (req.query && typeof req.query === 'object' ? req.query._csrf : '') ||
    ''
  );
}

export default function csrfMiddleware({ secureCookie = false, sameSite = 'lax' } = {}) {
  return function csrf(req, res, next) {
    if (!req.session) return next();

    if (!req.session.csrfToken) {
      req.session.csrfToken = generateToken();
    }
    const token = req.session.csrfToken;

    res.locals.csrfToken = token;
    req.csrfToken = () => token;

    res.cookie(TOKEN_COOKIE, token, {
      httpOnly: false,
      sameSite,
      secure: secureCookie,
      path: '/',
    });

    const method = String(req.method || '').toUpperCase();
    if (SAFE_METHODS.has(method)) return next();
    if (isExemptPath(req.path)) return next();

    const provided = String(extractProvided(req) || '');
    if (!safeCompare(provided, token)) {
      const accept = String(req.headers.accept || '');
      const wantsJson =
        accept.includes('application/json') ||
        req.xhr === true ||
        (req.path && req.path.startsWith('/api/')) ||
        String(req.headers['content-type'] || '').includes('application/json');

      if (wantsJson) {
        return res.status(403).json({ message: 'Invalid or missing CSRF token' });
      }
      res.status(403);
      return res.send('Invalid or missing CSRF token');
    }

    next();
  };
}
