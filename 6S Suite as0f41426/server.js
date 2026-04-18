// server.js
// Auth ON, HTTPS if available (FORCE_HTTP override), non-blocking init,
// deferred boot tasks with caps/timeouts, shared Socket.IO session,
// protective limits around taskService to avoid UI overload, and
// /projects/api list route exposed before gated /projects mount.

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import methodOverride from 'method-override';
import { Server } from 'socket.io';
import cron from 'node-cron';
import promClient from 'prom-client';
import { createClient as createRedisClient } from 'redis';

// Utils/services/sockets
import errorHandler from './utils/errorHandler.js';
import registerSocketHandlers from './sockets/ioHandlers.js';
import { initData, refreshAll } from './services/dataService.js';
import taskService, { invalidateCache as invalidateTaskCache } from './services/taskService.js';

// Routers
import toolsRouter from './routes/tools.js';
import adminRouter from './routes/admin.js';
import employeesRouter from './routes/employees.js';
import assetCatalogRouter from './routes/assetCatalog.js';
import inventoryRouter from './routes/inventory.js';
import authRouter from './routes/auth.js';
import expirationRoutes from './routes/expiration.js';
import integrationsRouter from './routes/integrations.js';
import adminApiKeysRouter from './routes/adminApiKeys.js';
import projectRoutes, { listHandler as projectsListHandler } from './routes/projects.js';
import auditRoutes from './routes/audits.js';
import auditExportRouter from './routes/auditExport.js';
import kioskRouter from './routes/kiosk.js';
import esdCartsRouter from './routes/esdCarts.js';
import managementRoutes from './routes/management.js';
import oidcRouter from './routes/oidc.js';
import searchApiRouter from './routes/searchApi.js';
import exportsRouter from './routes/exports.js';
import adminIntegrationsRouter from './routes/adminIntegrations.js';
import integrationsInboundRouter from './routes/integrationsInbound.js';
import reorderQueueRouter from './routes/reorderQueue.js';
import scansRouter from './routes/scans.js';
import labelsRouter from './routes/labels.js';
import auditObsRouter from './routes/auditObs.js';
import transfersRouter from './routes/transfers.js';
import inspectionsRouter from './routes/inspections.js';

// RBAC + rate limit
import { attachUserToLocals, requireAuth } from './middleware/auth.js';
import { requireRoleForTool, requireRole } from './middleware/roleCheck.js';
import { apiLimiter, sensitiveLimiter } from './middleware/rateLimit.js';
import { createActivityLogger } from './middleware/activityLogger.js';
import csrfMiddleware from './middleware/csrf.js';

// Jobs
import { runLowStockCheck } from './jobs/lowStockJob.js';
import { sequelize } from './models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ───────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 1133);
const HTTP_PORT = Number(process.env.HTTP_PORT || 1155);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const FORCE_HTTP = /^(1|true|yes)$/i.test(process.env.FORCE_HTTP || '');

// DISABLE_RBAC is a dev-only escape hatch. In production it is always ignored
// and a loud warning is logged if someone tries to turn it on.
const RAW_DISABLE_RBAC = /^(1|true|yes)$/i.test(process.env.DISABLE_RBAC || '');
const DISABLE_RBAC = RAW_DISABLE_RBAC && !IS_PROD;

// SESSION_SECRET must be set and non-default in production.
const RAW_SESSION_SECRET = process.env.SESSION_SECRET || '';
const WEAK_SESSION_SECRETS = new Set(['', 'dev-secret', 'change-me', 'changeme', 'secret']);
if (IS_PROD && (WEAK_SESSION_SECRETS.has(RAW_SESSION_SECRET) || RAW_SESSION_SECRET.length < 32)) {
  // eslint-disable-next-line no-console
  console.error(
    'FATAL: SESSION_SECRET must be set to a random value of at least 32 characters in production.'
  );
  process.exit(1);
}
const SESSION_SECRET = RAW_SESSION_SECRET || 'dev-secret';

const TRUST_PROXY_RAW = String(process.env.TRUST_PROXY || '').trim();

function resolveTrustProxyValue(raw) {
  if (!raw) return IS_PROD ? 1 : false;
  if (/^(1|true|yes)$/i.test(raw)) return 1;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (['loopback', 'linklocal', 'uniquelocal'].includes(raw)) return raw;
  return false;
}

const TRUST_PROXY_VALUE = resolveTrustProxyValue(TRUST_PROXY_RAW);

// HTTPS detection
const keyPath = process.env.HTTPS_KEY ? path.resolve(process.env.HTTPS_KEY) : '';
const certPath = process.env.HTTPS_CERT ? path.resolve(process.env.HTTPS_CERT) : '';
const HTTPS_AVAILABLE =
  Boolean(keyPath) &&
  Boolean(certPath) &&
  fs.existsSync(keyPath) &&
  fs.existsSync(certPath);

const HTTPS_ENABLED = !FORCE_HTTP && HTTPS_AVAILABLE;

function normalizeSameSite(value) {
  const v = String(value || 'lax').trim().toLowerCase();
  return ['lax', 'strict', 'none'].includes(v) ? v : 'lax';
}

const SESSION_SAMESITE = normalizeSameSite(process.env.SESSION_SAMESITE || 'lax');

const SESSION_SECURE_EXPLICIT = process.env.SESSION_SECURE;
const EFFECTIVE_SECURE_COOKIE =
  SESSION_SECURE_EXPLICIT == null || SESSION_SECURE_EXPLICIT === ''
    ? HTTPS_ENABLED
    : /^(1|true|yes)$/i.test(SESSION_SECURE_EXPLICIT);

// Boot/task caps & flags
const BOOT_TASKS_ENABLED = !/^(0|false|no)$/i.test(process.env.BOOT_TASKS_ENABLED || '1');
const BOOT_DELAY_MS = Number(process.env.BOOT_DELAY_MS || 1000);
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 10_000);

const EXP_SYNC_ENABLED = !/^(0|false|no)$/i.test(process.env.EXP_SYNC_ENABLED || '1');
const EXP_SYNC_DAYS = Number(process.env.EXP_SYNC_DAYS || 30);
const EXP_SYNC_MAX_CREATE = Number(process.env.EXP_SYNC_MAX_CREATE || 50);

const PROJECTS_MAX = Number(process.env.PROJECTS_MAX || 3000);
const AUDIT_INSTANCE_MAX_CREATE = Number(process.env.AUDIT_INSTANCE_MAX_CREATE || 24);
const PRUNE_DONE_DAYS = Number(process.env.PRUNE_DONE_DAYS || 60);
const AUDIT_INSTANCE_RETENTION = Number(process.env.AUDIT_INSTANCE_RETENTION_DAYS || 30);
const BOOT_LOG_VERBOSE = /^(1|true|yes)$/i.test(process.env.BOOT_LOG_VERBOSE || '');

// RBAC shims
const passThroughMw = (_req, _res, next) => next();
const requireRoleMaybe = DISABLE_RBAC ? (..._roles) => passThroughMw : requireRole;
const requireRoleForToolMaybe = DISABLE_RBAC ? (_tool) => passThroughMw : requireRoleForTool;

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

if (RAW_DISABLE_RBAC && IS_PROD) {
  logger.error('DISABLE_RBAC=1 is ignored in production. Role checks remain enforced.');
}
if (DISABLE_RBAC) {
  logger.warn('DISABLE_RBAC=1 — role checks bypassed. This is a dev-only setting.');
}

function shouldSuppressProcessWarning(warning) {
  const message = String(warning?.message || warning || '');
  return (
    message.includes('Closing file descriptor') ||
    message.includes('Closing a FileHandle object on garbage collection is deprecated')
  );
}

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = function patchedEmitWarning(warning, ...args) {
  if (shouldSuppressProcessWarning(warning)) return;
  return originalEmitWarning(warning, ...args);
};

process.on('warning', (w) => {
  if (shouldSuppressProcessWarning(w)) return;
  logger.warn(
    {
      name: w.name,
      message: w.message,
      stack: w.stack,
    },
    'process warning'
  );
});

// Optional: OpenTelemetry tracing
try {
  if (/^(1|true|yes)$/i.test(process.env.OTEL_ENABLED || '')) {
    const { default: initTelemetry } = await import('./telemetry.js');
    await initTelemetry();
    logger.info('OpenTelemetry initialized');
  }
} catch (e) {
  logger.warn({ e }, 'OpenTelemetry init failed');
}

// ── App ──────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.locals.homeRoute = '/home';

if (TRUST_PROXY_VALUE !== false) {
  app.set('trust proxy', TRUST_PROXY_VALUE);
}

// Per-request CSP nonce
app.use((req, res, next) => {
  res.locals.cspNonce = Buffer.from(randomUUID()).toString('base64');
  next();
});

// Helmet
app.use(
  helmet({
    hsts: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': [
          "'self'",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`,
          'https://code.jquery.com',
          'https://cdn.jsdelivr.net',
          'https://cdn.datatables.net',
          'https://cdn.tailwindcss.com',
          'https://cdnjs.cloudflare.com',
        ],
        'script-src-attr': ["'none'"],
        'style-src': [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.datatables.net',
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
        ],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': [
          "'self'",
          'https://cdn.jsdelivr.net',
          'https://fonts.gstatic.com',
        ],
        'connect-src': ["'self'", 'http:', 'https:', 'ws:', 'wss:'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'self'"],
      },
    },
  })
);

// Login CSP override
function loginCspOverride(_req, res, next) {
  const nonce = res.locals.cspNonce || '';
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'nonce-${nonce}' https://code.jquery.com https://cdn.jsdelivr.net https://cdn.datatables.net https://cdn.tailwindcss.com https://cdnjs.cloudflare.com`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline' https://cdn.datatables.net https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
      "connect-src 'self' http: https: ws: wss:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join('; ')
  );
  next();
}

app.use('/auth/login', loginCspOverride);

// Compression & parsers
app.use(compression());

// Body-size limits are deliberately conservative. The previous 10MB ceiling
// was far larger than any legitimate JSON/form request this app sends, and
// large limits give abusive clients more leverage (memory pressure, slowloris
// POSTs). Override per-route only where a specific endpoint justifies it.
//   - JSON requests: 1MB default; /integrations webhooks bumped to 5MB.
//   - URL-encoded (classic HTML form posts): 1MB default.
// Multipart/form-data for file uploads is handled by Multer and is NOT
// subject to these limits.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';
const FORM_BODY_LIMIT = process.env.FORM_BODY_LIMIT || '1mb';
const INTEGRATIONS_BODY_LIMIT = process.env.INTEGRATIONS_BODY_LIMIT || '5mb';

// Mount the /integrations-specific JSON parser first so webhook payloads can
// use the larger limit AND capture a raw copy for HMAC verification. Once
// body-parser populates req.body on this path, the global parser below will
// no-op for the same request (body-parser skips when req._body is already set).
app.use(
  '/integrations',
  express.json({
    limit: INTEGRATIONS_BODY_LIMIT,
    type: ['application/json', 'application/*+json'],
    verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); },
  })
);

app.use(
  express.json({
    limit: JSON_BODY_LIMIT,
    // Reject non-JSON content types on endpoints that only speak JSON.
    // (body-parser's default `type` is 'application/json' which already
    // ignores XML/HTML/text — we set it explicitly for clarity.)
    type: ['application/json', 'application/*+json'],
  })
);

app.use(express.urlencoded({ extended: true, limit: FORM_BODY_LIMIT }));
app.use(methodOverride('_method'));

// Favicon BEFORE static
const faviconIcoPath = path.join(__dirname, 'public', 'favicon.ico');
const faviconPngPath = path.join(__dirname, 'public', 'images', 'favicon.png');

app.get('/favicon.ico', (_req, res) => {
  if (fs.existsSync(faviconIcoPath)) return res.sendFile(faviconIcoPath);
  if (fs.existsSync(faviconPngPath)) return res.sendFile(faviconPngPath);
  return res.status(204).end();
});

app.get('/images/favicon.png', (_req, res) => {
  if (fs.existsSync(faviconPngPath)) return res.sendFile(faviconPngPath);
  if (fs.existsSync(faviconIcoPath)) return res.sendFile(faviconIcoPath);
  return res.status(404).end();
});

app.get(['/audits', '/audits/', '/audits/index.html', '/audits/audits.html'], requireAuth, (_req, res) => {
  res.redirect(302, '/projects?domain=audit');
});

// Note: /projects static files are served further below, AFTER the session
// gate + tool-role check, to avoid leaking project bundles to unauthenticated
// clients. See the `/projects` static mount near the routes section.

app.get('/styles.css', (_req, res) => {
  const cssPath = path.join(__dirname, 'public', 'styles.css');
  if (fs.existsSync(cssPath)) return res.sendFile(cssPath);
  return res.type('text/css').send('/* fallback */ body{visibility:visible}');
});

// Logging
const NOISY_PATH_PREFIXES = [
  '/cfdocs',
  '/administrator',
  '/search/moin_static',
  '/search/.editorconfig',
  '/anthill-0.1.6.1',
  '/l-forum-2.4.0',
  '/resourcespace',
  '/moin_static',
];

function shouldIgnoreAutoLog(req) {
  const url = req.url || '';
  const hasQualysHeader = Boolean(req.headers['qualys-scan']);

  if (hasQualysHeader) return true;
  if (NOISY_PATH_PREFIXES.some((prefix) => url.startsWith(prefix))) return true;

  return false;
}

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),

    autoLogging: {
      ignore: shouldIgnoreAutoLog,
    },

    customLogLevel(req, res, err) {
      if (shouldIgnoreAutoLog(req)) return 'silent';
      if (err || res.statusCode >= 500) return 'error';
      return 'silent';
    },

    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} -> ${res.statusCode}`;
    },

    customErrorMessage(req, res, err) {
      return `${req.method} ${req.url} -> ${res.statusCode}${err?.message ? ` ${err.message}` : ''}`;
    },

    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.ip || req.socket?.remoteAddress,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

// Propagate X-Request-Id to responses
app.use((req, res, next) => {
  if (req.id) res.setHeader('X-Request-Id', req.id);
  next();
});

// If HTTPS is enabled, redirect accidental plain HTTP requests to HTTPS
app.use((req, res, next) => {
  if (!HTTPS_ENABLED) return next();

  const isSecure =
    req.secure ||
    String(req.headers['x-forwarded-proto'] || '')
      .toLowerCase()
      .includes('https');

  if (isSecure) return next();

  if (req.hostname === 'localhost' || req.hostname === '127.0.0.1' || req.hostname === '::1') {
    return next();
  }

  const host = req.headers.host || '';
  const hostNoPort = host.replace(/:\d+$/, '');
  return res.redirect(301, `https://${hostNoPort}:${PORT}${req.originalUrl}`);
});

// Sessions
let sessionStore;
let redisClient = null;

if (/^(1|true|yes)$/i.test(process.env.USE_REDIS || '')) {
  try {
    redisClient = createRedisClient({
      url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    });

    redisClient.on('error', (e) => logger.warn({ e }, 'Redis error'));
    await redisClient.connect();

    const mod = await import('connect-redis');
    const RedisStore =
      mod.RedisStore || (mod.default && mod.default.name?.includes('RedisStore') ? mod.default : null);

    if (!RedisStore) {
      throw new Error('connect-redis not found');
    }

    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'sess:',
    });

    logger.info('Session store: Redis');
  } catch (e) {
    logger.warn({ e }, 'Redis unavailable; falling back to MemoryStore');
  }
}

if (!sessionStore) {
  logger.info('Session store: MemoryStore (development only)');
}

const sessionMiddleware = session({
  name: 'sixs.sid',
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  proxy: TRUST_PROXY_VALUE !== false || EFFECTIVE_SECURE_COOKIE,
  cookie: {
    httpOnly: true,
    sameSite: SESSION_SAMESITE,
    secure: EFFECTIVE_SECURE_COOKIE,
    maxAge: 1000 * 60 * 60 * 8,
  },
});

app.use(sessionMiddleware);

// CSRF protection (session-bound double-submit). Must run after session.
app.use(
  csrfMiddleware({
    secureCookie: EFFECTIVE_SECURE_COOKIE,
    sameSite: SESSION_SAMESITE,
  })
);

// Attach user -> res.locals
app.use(attachUserToLocals);

// Seed activityLogPath BEFORE registering the logger so reader/writer stay in
// sync even if initData runs late or fails partway through. initData will
// override this with the canonical PATHS.ACTIVITY_LOG_PATH during boot; the
// value here is just a deterministic fallback.
const DEFAULT_ACTIVITY_LOG_PATH = path.join(__dirname, 'data', 'activity-log.json');
if (!app.get('activityLogPath')) app.set('activityLogPath', DEFAULT_ACTIVITY_LOG_PATH);
app.use(createActivityLogger({ path: app.get('activityLogPath') }));

app.get(['/inspections', '/inspections/', '/inspections/index.html'], requireAuth, requireRoleMaybe('lead', 'management'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'inspections.html'));
});

// Static & views
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global gate
app.use((req, res, next) => {
  const allow = new Set([
    '/auth/login',
    '/auth/logout',
    '/auth/whoami',
    '/auth/oidc',
    '/admin/session',
    '/login',
    '/ping',
    '/health',
    '/health/live',
    '/health/ready',
    '/favicon.ico',
    '/images/favicon.png',
    '/api/docs',
    '/socket.io',
    '/__up',
    '/__diag',
    '/__boot',
    '/styles.css',
    '/integrations/inbound',
  ]);

  const isAllow = [...allow].some((p) => req.path === p || req.path.startsWith(p));
  const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());

  const protectedPrefixes = [
    '/admin',
    '/asset-catalog',
    '/inventory',
    '/projects',
    '/audits',
    '/expiration',
    '/kiosk',
    '/tools',
    '/scans',
    '/labels',
    '/audit-obs',
    '/integrations',
    '/api',
    '/exports',
    '/admin/apikeys',
    '/cf',
    '/tool-management',
    '/management',
  ];

  const needsAuth = protectedPrefixes.some((p) => req.path.startsWith(p));

  if (!req.session?.user && !isAllow && needsAuth) {
    const nextParam = encodeURIComponent(req.originalUrl || '/home');
    return res.redirect(`/auth/login?next=${nextParam}`);
  }

  if (!req.session?.user && !isAllow && isWriteMethod) {
    if ((req.headers.accept || '').includes('application/json') || req.xhr === true) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const nextParam = encodeURIComponent(req.originalUrl || '/home');
    return res.redirect(`/auth/login?next=${nextParam}`);
  }

  next();
});

// Health / diag
app.get('/ping', (_req, res) => res.send('pong'));

app.get('/__up', (_req, res) => {
  res.json({
    up: true,
    pid: process.pid,
    port: PORT,
    https: HTTPS_ENABLED,
    httpsAvailable: HTTPS_AVAILABLE,
    cookieSecure: EFFECTIVE_SECURE_COOKIE,
    trustProxy: app.get('trust proxy') || false,
  });
});

app.get('/__diag', requireRoleMaybe('admin', 'lead'), (_req, res) => {
  res.json({
    env: {
      NODE_ENV,
      PORT,
      HTTP_PORT,
      FORCE_HTTP,
      HTTPS_AVAILABLE,
      HTTPS_ENABLED,
      EFFECTIVE_SECURE_COOKIE,
      SESSION_SAMESITE,
      TRUST_PROXY: app.get('trust proxy') || false,
      HTTPS_KEY: keyPath || null,
      HTTPS_CERT: certPath || null,
    },
    versions: process.versions,
    memory: process.memoryUsage(),
    uptimeSec: process.uptime(),
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/health/live', (_req, res) => res.send('ok'));

app.get('/health/ready', async (_req, res) => {
  const failures = [];

  try {
    await sequelize.authenticate();
  } catch (e) {
    failures.push(`db: ${e?.message || 'unreachable'}`);
  }

  if (redisClient) {
    try {
      await redisClient.ping();
    } catch (e) {
      failures.push(`redis: ${e?.message || 'unreachable'}`);
    }
  }

  if (failures.length) {
    return res.status(503).json({ ready: false, failures });
  }

  return res.json({ ready: true });
});

// Metrics
promClient.collectDefaultMetrics({
  prefix: process.env.METRICS_PREFIX || '',
});

function metricsGuard(req, res, next) {
  const metricsToken = process.env.METRICS_TOKEN || '';
  if (metricsToken) {
    const auth = req.headers.authorization || '';
    if (auth === `Bearer ${metricsToken}`) return next();
  }

  const allowIps = (process.env.METRICS_ALLOW_IPS || '127.0.0.1,::1,::ffff:127.0.0.1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const clientIp = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
  const rawIp = req.ip || req.socket?.remoteAddress || '';
  const role = (req.session?.user?.role || '').toLowerCase();

  if (allowIps.includes('*') || allowIps.includes(clientIp) || allowIps.includes(rawIp)) return next();
  if (role === 'admin' || role === 'lead') return next();

  return res.status(404).json({ message: 'Not found' });
}

app.get('/metrics', metricsGuard, async (_req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// Boot status
const bootStatus = {
  enabled: BOOT_TASKS_ENABLED,
  startedAt: null,
  finishedAt: null,
  steps: [],
  lastError: null,
};

app.get('/__boot', (_req, res) => res.json(bootStatus));

// Init data
Promise.resolve(initData(app)).catch((e) => {
  logger.warn({ e }, 'initData failed (non-fatal)');
});

// ── Boot tasks ───────────────────────────────────────────────────────────
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function withTimeout(promise, ms, label) {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runBootTasks(io) {
  const bootLog = {
    info: (...args) => { if (BOOT_LOG_VERBOSE) logger.info(...args); },
    warn: (...args) => { if (BOOT_LOG_VERBOSE) logger.warn(...args); },
  };

  if (!BOOT_TASKS_ENABLED) {
    bootLog.warn('runBootTasks: skipped (BOOT_TASKS_ENABLED=0)');
    bootStatus.enabled = false;
    bootStatus.startedAt = Date.now();
    bootStatus.finishedAt = Date.now();
    return;
  }

  const start = Date.now();
  bootStatus.enabled = true;
  bootStatus.startedAt = start;
  bootStatus.steps = [];
  bootStatus.finishedAt = null;
  bootStatus.lastError = null;

  bootLog.info('runBootTasks: starting');

  try {
    const steps = [];

    const size = await taskService.size().catch(() => 0);
    const tooBig = size >= PROJECTS_MAX;

    if (tooBig) {
      bootLog.warn({ size, PROJECTS_MAX }, 'runBootTasks: store near/over limit — boot tasks will be light');
    }

    if (!tooBig && (process.env.SEED_ON_BOOT ?? '1').toLowerCase() !== '0') {
      steps.push([
        'seedDefaults',
        async () => withTimeout(taskService.seedDefaults(), TASK_TIMEOUT_MS, 'seedDefaults'),
      ]);
      steps.push([
        'seedKanbanDemo',
        async () => withTimeout(taskService.seedKanbanDemo(), TASK_TIMEOUT_MS, 'seedKanbanDemo'),
      ]);
    }

    if (!tooBig) {
      steps.push([
        'ensureDailyInstances',
        async () =>
          withTimeout(
            taskService.ensureDailyInstances(new Date(), {
              maxCreate: AUDIT_INSTANCE_MAX_CREATE,
              hardLimit: PROJECTS_MAX,
            }),
            TASK_TIMEOUT_MS,
            'ensureDailyInstances'
          ),
      ]);

      steps.push([
        'ensureWeeklyInstances',
        async () =>
          withTimeout(
            taskService.ensureWeeklyInstances(new Date(), {
              maxCreate: AUDIT_INSTANCE_MAX_CREATE,
              hardLimit: PROJECTS_MAX,
            }),
            TASK_TIMEOUT_MS,
            'ensureWeeklyInstances'
          ),
      ]);
    }

    if (EXP_SYNC_ENABLED && !tooBig) {
      steps.push([
        'syncExpirationsToProjects',
        async () =>
          withTimeout(
            taskService.syncExpirationsToProjects({
              days: EXP_SYNC_DAYS,
              maxCreate: EXP_SYNC_MAX_CREATE,
              hardLimit: PROJECTS_MAX,
            }),
            TASK_TIMEOUT_MS,
            'syncExpirationsToProjects'
          ),
      ]);
    } else {
      bootLog.info('runBootTasks: expirations sync skipped (disabled or store too big)');
    }

    steps.push([
      'prune',
      async () =>
        withTimeout(
          taskService.prune({
            doneOlderThanDays: PRUNE_DONE_DAYS,
            auditInstanceOlderThanDays: AUDIT_INSTANCE_RETENTION,
            hardLimit: PROJECTS_MAX,
          }),
          TASK_TIMEOUT_MS,
          'prune'
        ),
    ]);

    for (const [name, fn] of steps) {
      const t0 = Date.now();
      bootLog.info(`runBootTasks: ${name} -> start`);

      try {
        await fn();
        const ms = Date.now() - t0;
        bootLog.info({ ms }, `runBootTasks: ${name} -> done`);
        bootStatus.steps.push({ name, ok: true, ms });
      } catch (e) {
        const ms = Date.now() - t0;
        bootLog.warn({ e, ms }, `runBootTasks: ${name} -> failed (non-fatal)`);
        bootStatus.steps.push({
          name,
          ok: false,
          ms,
          error: String(e?.message || e),
        });
        bootStatus.lastError = String(e?.message || e);
      }

      await tick();
    }

    io?.publish?.auditUpdated?.({ reason: 'boot_tasks' });
    io?.publish?.projectsUpdated?.({ reason: 'boot_tasks' });
  } catch (e) {
    logger.error({ e }, 'runBootTasks: crashed (continuing)');
    bootStatus.lastError = String(e?.message || e);
  } finally {
    bootStatus.finishedAt = Date.now();
    bootLog.info({ ms: bootStatus.finishedAt - start }, 'runBootTasks: completed');
  }
}

// ── Server + Socket.IO ───────────────────────────────────────────────────
let server;
let httpRedirectServer = null;
let protocol = 'http';

if (HTTPS_ENABLED) {
  const key = fs.readFileSync(keyPath);
  const cert = fs.readFileSync(certPath);

  server = https.createServer({ key, cert }, app);
  protocol = 'https';

  logger.info({ keyPath, certPath }, 'HTTPS enabled');

  httpRedirectServer = http.createServer((req, res) => {
    const hostHeader = req.headers.host || '';
    const hostNoPort = hostHeader.replace(/:\d+$/, '');
    const location = `https://${hostNoPort}:${PORT}${req.url || '/'}`;
    res.writeHead(301, { Location: location });
    res.end();
  });
} else {
  if (HTTPS_AVAILABLE && FORCE_HTTP) {
    logger.warn('FORCE_HTTP=1 — using HTTP even though certs exist');
  }
  if (!HTTPS_AVAILABLE) {
    logger.warn('HTTPS certs not found — falling back to HTTP');
  }
  server = http.createServer(app);
}

// Socket.IO CORS — default to same-origin only. SOCKET_ALLOWED_ORIGINS is a
// comma-separated list of allowed origins (e.g. https://a.example,https://b.example).
const SOCKET_ALLOWED_ORIGINS = String(process.env.SOCKET_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin(origin, cb) {
      // Same-origin requests omit the Origin header — allow those.
      if (!origin) return cb(null, true);
      if (SOCKET_ALLOWED_ORIGINS.length === 0) {
        // Default: allow only same-origin. In production we never reflect
        // arbitrary origins with credentials:true.
        return cb(null, false);
      }
      if (SOCKET_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  },
});

io.engine.use((req, res, next) => sessionMiddleware(req, res, next));
app.set('io', io);

app.refreshAll = () => {
  invalidateTaskCache();
  return refreshAll(app, io);
};

// Default publishers
if (!io.publish) io.publish = {};
io.publish.auditUpdated ||= (payload) => io.emit('auditUpdated', payload);
io.publish.projectsUpdated ||= (payload) => io.emit('projectsUpdated', payload);
io.publish.esdCartsUpdated ||= (payload) => io.emit('esdCartsUpdated', payload);
io.publish.assetsUpdated ||= (payload) => io.emit('assetsUpdated', payload);
io.publish.toolsUpdated ||= (payload) => io.emit('toolsUpdated', payload);

// ── Routes ───────────────────────────────────────────────────────────────
app.use('/auth', sensitiveLimiter, authRouter);
app.use('/auth/oidc', oidcRouter);
app.get('/login', (_req, res) => res.redirect('/auth/login'));

app.use('/integrations/inbound', apiLimiter, integrationsInboundRouter(io, app));

// Admin / secure routers
app.use('/tools', requireAuth, toolsRouter(io, app));
app.use('/admin', requireRoleMaybe('admin', 'lead', 'management'), adminRouter(io, app));
app.use('/employees', requireAuth, employeesRouter(io, app));
app.use('/asset-catalog', requireRoleForToolMaybe('assetCatalog'), assetCatalogRouter(io));
app.use('/inventory', requireAuth, inventoryRouter(io));
app.use('/management', requireRoleMaybe('admin', 'lead', 'management'), managementRoutes);
app.use('/audits', requireRoleForToolMaybe('audits'), auditRoutes(io));
app.use('/audits', requireRoleForToolMaybe('audits'), auditExportRouter);
app.use('/expiration', requireRoleForToolMaybe('expiration'), expirationRoutes(io));
app.use('/kiosk', requireAuth, requireRoleForToolMaybe('kiosk'), kioskRouter(io, app));
app.use('/inspections', requireAuth, inspectionsRouter());
app.use('/esd-carts', requireAuth, esdCartsRouter(io, app));
app.use('/inventory', requireAuth, reorderQueueRouter);
app.use('/integrations', requireRoleMaybe('admin', 'lead'), integrationsRouter(io, app));
app.use('/exports', requireRoleMaybe('admin', 'lead'), exportsRouter);
app.use('/admin/integrations', requireRoleMaybe('admin', 'lead'), adminIntegrationsRouter(io, app));
app.use('/admin/apikeys', requireRoleMaybe('admin', 'lead'), adminApiKeysRouter);
app.use('/scans', requireRoleForToolMaybe('inventory'), scansRouter(io, app));
app.use('/labels', requireRoleForToolMaybe('inventory'), labelsRouter(io, app));
app.use('/audit-obs', requireRoleForToolMaybe('audits'), auditObsRouter(io, app));
app.use('/transfers', requireAuth, requireRoleForToolMaybe('transfers'), transfersRouter(io));

app.get('/projects/api', requireAuth, projectsListHandler);
app.get('/projects/api/', requireAuth, projectsListHandler);

app.get('/api/audit-rules', requireAuth, apiLimiter, async (_req, res) => {
  try {
    const rulesPath = path.join(__dirname, 'config', 'auditRules.json');
    if (!fs.existsSync(rulesPath)) return res.json({});

    const raw = await fs.promises.readFile(rulesPath, 'utf-8');
    return res.json(JSON.parse(raw));
  } catch {
    return res.json({});
  }
});

app.use('/api', requireAuth, apiLimiter, searchApiRouter);

app.use('/projects', (req, res, next) => {
  if (req.path === '/' || req.path === '') {
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
      const nonce = res.locals.cspNonce || '';
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          `script-src 'self' 'nonce-${nonce}' https://code.jquery.com https://cdn.jsdelivr.net https://cdn.datatables.net https://cdn.tailwindcss.com`,
          "script-src-attr 'none'",
          "style-src 'self' 'unsafe-inline' https://cdn.datatables.net https://cdn.jsdelivr.net https://fonts.googleapis.com",
          "img-src 'self' data: blob:",
          "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
          "connect-src 'self' http: https: ws: wss:",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'self'",
        ].join('; ')
      );
    }
  }
  next();
});

// Static /projects bundles are gated behind auth + tool-role check.
app.use(
  '/projects',
  requireAuth,
  requireRoleForToolMaybe('projects'),
  express.static(path.join(__dirname, 'public', 'projects'), {
    fallthrough: true,
    etag: true,
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) res.type('text/css');
      if (filePath.endsWith('.js')) res.type('application/javascript');
    },
  })
);

app.use('/projects', requireRoleForToolMaybe('projects'), projectRoutes(io));

app.get('/', requireAuth, (_req, res) => res.redirect('/home'));

app.get('/tool-management', requireRoleMaybe('admin', 'lead', 'coordinator'), (_req, res) => {
  res.redirect(302, '/asset-catalog?itemType=equipment');
});

app.get('/tool-management/', requireRoleMaybe('admin', 'lead', 'coordinator'), (_req, res) => {
  res.redirect(302, '/asset-catalog?itemType=equipment');
});

app.get('/admin/user-management', requireRoleMaybe('admin', 'lead', 'management'), (req, res) => {
  res.render('admin/index', {
    user: req.user || req.session?.user,
    cspNonce: res.locals.cspNonce,
    allowedTools: res.locals.allowedTools || [],
  });
});

app.get('/admin/user-management/', requireRoleMaybe('admin', 'lead', 'management'), (_req, res) => {
  res.redirect('/admin/user-management');
});

// /resources was a tech-resources portal whose frontend bundle
// (/resources/resources.js) was removed. Route retired until the feature is
// rebuilt; remove '/resources' from the global allow list if added back later.

app.get('/cf/inventory', requireAuth, requireRoleForToolMaybe('inventory'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cf', 'inventory', 'index.html'));
});

app.get('/cf/assets', requireAuth, requireRoleForToolMaybe('assetCatalog'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cf', 'assets', 'index.html'));
});

app.get('/cf/tools', requireAuth, requireRoleForToolMaybe('screwdriver'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cf', 'tools', 'index.html'));
});

app.get('/cf/management', requireAuth, requireRoleMaybe('admin', 'lead', 'management'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cf', 'management', 'index.html'));
});

app.get('/history', requireAuth, (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${res.locals.cspNonce}' https://cdn.jsdelivr.net; connect-src 'self' http: https: ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self';`
  );

  res.render('history', {
    user: req.session.user,
    cspNonce: res.locals.cspNonce,
  });
});

app.get('/history/', requireAuth, (_req, res) => res.redirect('/history'));

app.get('/home', requireAuth, (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${res.locals.cspNonce}' https://code.jquery.com https://cdn.jsdelivr.net https://cdn.datatables.net https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://cdn.datatables.net https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; connect-src 'self' http: https: ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self';`
  );

  res.render('home', {
    user: req.session.user,
    cspNonce: res.locals.cspNonce,
  });
});

app.get('/calibration-calendar', requireAuth, (_req, res) => res.redirect('/expiration'));
app.get('/calibration-calendar/', requireAuth, (_req, res) => res.redirect('/expiration'));

app.get('/esd/', requireAuth, (_req, res) => res.redirect('/screwdriver/screwdriver.html'));
app.get('/esd/index.html', requireAuth, (_req, res) => res.redirect('/screwdriver/screwdriver.html'));

// /search and /search2 were placeholder routes for a global search page that
// was never shipped (the referenced index.html files do not exist). Removed
// to prevent broken links.

app.get('/management', requireRoleMaybe('admin', 'lead', 'management'), (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/management/portal.html'));
});

app.get('/api/whoami', (req, res) => {
  const user = req.session?.user || null;
  res.json({ user });
});

// Swagger UI
try {
  const specPath = path.join(__dirname, 'openapi.yaml');
  if (fs.existsSync(specPath)) {
    const swaggerUi = (await import('swagger-ui-express')).default;
    const YAML = (await import('yamljs')).default;
    const spec = YAML.load(specPath);

    app.use('/api/docs', requireRoleMaybe('admin', 'lead'), swaggerUi.serve, swaggerUi.setup(spec));
    logger.info('Swagger UI at /api/docs');
  }
} catch (e) {
  logger.warn({ e }, 'Swagger UI not mounted');
}

// WebSocket handlers
registerSocketHandlers(io);

// Errors
app.use((err, req, res, next) => {
  req.log?.error({ err }, 'Express error');
  errorHandler(err, req, res, next);
});

app.use((req, res) => {
  const accept = String(req.headers?.accept || '');
  const wantsJson =
    accept.includes('application/json') ||
    req.xhr === true ||
    String(req.headers['content-type'] || '').includes('application/json') ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/tools/') ||
    req.path.startsWith('/inventory/api') ||
    req.path.startsWith('/asset-catalog/api') ||
    req.path.startsWith('/management/api') ||
    req.path.startsWith('/expiration/api') ||
    req.path.startsWith('/employees');

  const isAssetRequest =
    /\.(css|js|map|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)$/i.test(req.path) ||
    accept.startsWith('image/') ||
    accept.includes('text/css') ||
    accept.includes('javascript');

  if (wantsJson) {
    return res.status(404).json({ message: 'Not found', path: req.path });
  }

  if (isAssetRequest) {
    return res.status(404).end();
  }

  const from = encodeURIComponent(req.path);
  return res.redirect(302, `/home?msg=notfound&from=${from}`);
});

// ── Jobs ────────────────────────────────────────────────────────────────
const LOW_STOCK_ALERTS = !/^false$/i.test(process.env.LOW_STOCK_ALERTS || 'true');
const LOW_STOCK_CRON = process.env.LOW_STOCK_CRON || '*/15 * * * *';
const LOW_STOCK_RUN_ON_START = /^(1|true|yes)$/i.test(process.env.LOW_STOCK_RUN_ON_START || 'false');

if (LOW_STOCK_ALERTS) {
  try {
    cron.schedule(LOW_STOCK_CRON, async () => {
      try {
        await runLowStockCheck(io);
        logger.info('Low stock check completed');
      } catch (e) {
        logger.error({ e }, 'Low stock check failed');
      }
    });

    if (LOW_STOCK_RUN_ON_START) {
      setTimeout(() => {
        runLowStockCheck(io).catch(() => {});
      }, 30_000);
    }

    logger.info(`Low-stock cron scheduled: ${LOW_STOCK_CRON}`);
  } catch (e) {
    logger.error({ e }, 'Failed to schedule low-stock cron');
  }
} else {
  logger.info('Low-stock alerts disabled');
}

try {
  cron.schedule('50 3 * * *', async () => {
    try {
      await taskService.prune({
        doneOlderThanDays: PRUNE_DONE_DAYS,
        auditInstanceOlderThanDays: AUDIT_INSTANCE_RETENTION,
        hardLimit: PROJECTS_MAX,
      });
      io?.publish?.projectsUpdated?.({ reason: 'prune_cron' });
      logger.info('Prune completed');
    } catch (e) {
      logger.error({ e }, 'Prune cron failed');
    }
  });

  cron.schedule('55 3 * * *', async () => {
    try {
      if (EXP_SYNC_ENABLED) {
        await taskService.syncExpirationsToProjects({
          days: EXP_SYNC_DAYS,
          maxCreate: EXP_SYNC_MAX_CREATE,
          hardLimit: PROJECTS_MAX,
        });
        io?.publish?.projectsUpdated?.({ reason: 'exp_sync_cron' });
        logger.info('Expiration sync completed');
      }
    } catch (e) {
      logger.error({ e }, 'Expiration sync cron failed');
    }
  });

  cron.schedule('0 4 * * *', async () => {
    try {
      await taskService.ensureDailyInstances(new Date(), {
        maxCreate: AUDIT_INSTANCE_MAX_CREATE,
        hardLimit: PROJECTS_MAX,
      });
      io?.publish?.auditUpdated?.({ reason: 'daily_cron' });
      logger.info('Daily audits instantiated');
    } catch (e) {
      logger.error({ e }, 'Daily audit cron failed');
    }
  });

  cron.schedule('5 4 * * 1', async () => {
    try {
      await taskService.ensureWeeklyInstances(new Date(), {
        maxCreate: AUDIT_INSTANCE_MAX_CREATE,
        hardLimit: PROJECTS_MAX,
      });
      io?.publish?.auditUpdated?.({ reason: 'weekly_cron' });
      logger.info('Weekly audits instantiated');
    } catch (e) {
      logger.error({ e }, 'Weekly audit cron failed');
    }
  });
} catch (e) {
  logger.error({ e }, 'Failed to schedule maintenance crons');
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }

  return results;
}

// ── Listen ──────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const addr = server.address();
  const lanIps = getLanIps();

  logger.info(
    {
      addr,
      protocol,
      httpsEnabled: HTTPS_ENABLED,
      httpsAvailable: HTTPS_AVAILABLE,
      cookieSecure: EFFECTIVE_SECURE_COOKIE,
      trustProxy: app.get('trust proxy') || false,
      lanIps,
      keyPath: keyPath || null,
      certPath: certPath || null,
    },
    `✅ ${NODE_ENV} server up on ${protocol}://localhost:${PORT}`
  );

  if (httpRedirectServer) {
    httpRedirectServer.listen(HTTP_PORT, () => {
      logger.info(
        { httpRedirectPort: HTTP_PORT, httpsPort: PORT },
        `HTTP redirect server up on http://localhost:${HTTP_PORT} -> https://localhost:${PORT}`
      );
    });
  }

  setTimeout(() => {
    runBootTasks(io).catch(() => {});
  }, BOOT_DELAY_MS);
});

// Graceful shutdown
const shutdown = async (sig) => {
  logger.info({ sig }, 'Shutting down…');

  try {
    await new Promise((resolve) => server.close(resolve));
  } catch {}

  try {
    if (httpRedirectServer) {
      await new Promise((resolve) => httpRedirectServer.close(resolve));
    }
  } catch {}

  try {
    await new Promise((resolve) => io.close(resolve));
  } catch {}

  try {
    await redisClient?.quit();
  } catch {}

  try {
    await sequelize.query('PRAGMA wal_checkpoint(TRUNCATE)');
    logger.info('SQLite WAL checkpoint complete');
  } catch (e) {
    logger.warn({ e }, 'SQLite WAL checkpoint failed (non-fatal)');
  }

  try {
    await sequelize.close();
    logger.info('Sequelize connection closed');
  } catch (e) {
    logger.warn({ e }, 'Sequelize close failed (non-fatal)');
  }

  process.exit(0);
};

['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => shutdown(sig));
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
  process.exit(1);
});
