import { randomUUID } from 'crypto';
import { appendActivity } from '../utils/activityLog.js';
import { s } from '../utils/text.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PAGE_VIEW_EXTENSIONS = /\.(?:css|js|mjs|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|json|txt|xml)$/i;
const REDACT_KEYS = /(password|secret|token|apikey|api[-_ ]?key|authorization|cookie|rawbody|csrf)/i;
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

function resolveActor(req) {
  const actor = req.user || req.session?.user || null;
  if (actor) {
    return {
      id: s(actor.id || actor.username),
      name: s(actor.name || actor.username || actor.id),
      role: s(actor.role),
      type: 'user',
    };
  }

  return {
    id: '',
    name: 'Anonymous',
    role: '',
    type: 'anonymous',
  };
}

function shouldTrack(req) {
  const method = String(req.method || '').toUpperCase();
  const path = s(req.path || req.originalUrl);
  if (!path) return false;
  if (req.headers?.['qualys-scan']) return false;
  if (NOISY_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (path.startsWith('/socket.io')) return false;
  if (path.startsWith('/health')) return false;
  if (path.startsWith('/metrics')) return false;
  if (path.startsWith('/favicon')) return false;
  if (path.startsWith('/notifications/api')) return false;
  if (path.startsWith('/api/')) return false;
  if (PAGE_VIEW_EXTENSIONS.test(path)) return false;
  if (WRITE_METHODS.has(method)) return true;
  if (method !== 'GET') return false;
  return isPageViewRequest(req);
}

function isPageViewRequest(req) {
  const accept = s(req.headers?.accept).toLowerCase();
  if (!accept.includes('text/html')) return false;
  const fetchMode = s(req.headers?.['sec-fetch-mode']).toLowerCase();
  if (fetchMode && fetchMode !== 'navigate') return false;
  const dest = s(req.headers?.['sec-fetch-dest']).toLowerCase();
  if (dest && dest !== 'document') return false;
  if (s(req.headers?.['x-requested-with']).toLowerCase() === 'xmlhttprequest') return false;
  return true;
}

function truncate(value, max = 240) {
  const text = s(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value).slice(0, 25)) {
      out[key] = REDACT_KEYS.test(key) ? '[redacted]' : sanitize(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return truncate(value, 300);
  return value;
}

function inferModule(pathname = '') {
  const path = s(pathname).toLowerCase();
  if (path === '/' || path.startsWith('/home')) return 'home';
  if (path.startsWith('/cf')) return 'command-floor';
  if (path.startsWith('/tools')) return 'tools';
  if (path.startsWith('/inventory')) return 'inventory';
  if (path.startsWith('/asset-catalog')) return 'assets';
  if (path.startsWith('/projects')) return 'projects';
  if (path.startsWith('/audits')) return 'audits';
  if (path.startsWith('/employees')) return 'employees';
  if (path.startsWith('/transfers')) return 'transfers';
  if (path.startsWith('/kiosk')) return 'kiosk';
  if (path.startsWith('/auth')) return 'auth';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/expiration')) return 'expiration';
  if (path.startsWith('/integrations')) return 'integrations';
  if (path.startsWith('/scans')) return 'scans';
  if (path.startsWith('/labels')) return 'labels';
  if (path.startsWith('/audit-obs')) return 'audit-observations';
  return 'system';
}

function inferAction(req) {
  const path = s(req.path || req.originalUrl).toLowerCase();
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' && isPageViewRequest(req)) return 'page_view';
  if (path.includes('/checkout')) return 'checkout';
  if (path.includes('/checkin')) return 'checkin';
  if (path.includes('/return')) return 'return';
  if (path.includes('/bulk-audit')) return 'bulk_audit';
  if (path.includes('/weeklyaudit')) return 'weekly_audit';
  if (path.includes('/instantiate')) return 'generate';
  if (path.includes('/template')) return 'template_save';
  if (path.includes('/move')) return 'move';
  if (path.includes('/import')) return 'import';
  if (path.includes('/export')) return 'export';
  if (path.includes('/calibration')) return 'calibration_update';
  if (path.includes('/login')) return 'login';
  if (path.includes('/logout')) return 'logout';
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'request';
}

function inferTarget(req) {
  const body = req.body || {};
  const params = req.params || {};
  const query = req.query || {};
  const id =
    s(params.id) ||
    s(params.serial) ||
    s(body.id) ||
    s(body.serialNumber) ||
    s(body.tagNumber) ||
    s(body.itemCode) ||
    s(body.assetId) ||
    s(body.employeeId) ||
    s(query.id);

  const label =
    s(body.title) ||
    s(body.name) ||
    s(body.serialNumber) ||
    s(body.tagNumber) ||
    s(body.itemCode) ||
    s(body.username) ||
    s(body.email);

  const type =
    s(body.domain) ||
    (s(body.tagNumber) ? 'asset' : '') ||
    (s(body.serialNumber) ? 'tool' : '') ||
    (s(body.itemCode) ? 'inventory-item' : '') ||
    '';

  if (!id && !label && !type) return null;
  return { id, label, type };
}

function buildSummary({ module, action, target, actorName, path, statusCode }) {
  const actor = actorName || 'Anonymous';
  if (action === 'page_view') {
    return `${actor} viewed ${path}`;
  }
  const subject = target?.label || target?.id || module;
  return `${actor} ${action.replaceAll('_', ' ')} ${subject} (${statusCode}) on ${path}`;
}

export function createActivityLogger({ path }) {
  if (!path) throw new Error('createActivityLogger requires a log path');

  return (req, res, next) => {
    if (!shouldTrack(req)) return next();
    const startedAt = Date.now();
    const actor = resolveActor(req);
    const body = sanitize(req.body || {});
    const query = sanitize(req.query || {});
    const target = inferTarget(req);
    const module = inferModule(req.path || req.originalUrl);
    const action = inferAction(req);
    const requestId = s(req.id) || randomUUID();
    let settled = false;

    const persist = async () => {
      if (settled) return;
      settled = true;
      try {
        await appendActivity({
          path,
          entry: {
            id: requestId,
            time: new Date().toISOString(),
            type: action === 'page_view' ? 'page_view' : 'http_transaction',
            module,
            action,
            summary: buildSummary({
              module,
              action,
              target,
              actorName: s(actor?.name || actor?.username || actor?.id),
              path: req.originalUrl || req.path,
              statusCode: res.statusCode,
            }),
            status: res.statusCode >= 200 && res.statusCode < 400 ? 'success' : 'error',
            statusCode: res.statusCode,
            method: req.method,
            path: req.originalUrl || req.path,
            route: `${req.baseUrl || ''}${req.route?.path || ''}`,
            actorId: s(actor?.id),
            actorName: s(actor?.name),
            actorRole: s(actor?.role),
            actorType: s(actor?.type || 'user'),
            requestId,
            target,
            details: {
              query,
              body,
              params: sanitize(req.params || {}),
            },
            durationMs: Date.now() - startedAt,
            ip: s(req.ip || req.socket?.remoteAddress),
            userAgent: truncate(req.headers['user-agent'], 180),
            building: s(body.building || query.building || actor?.building),
          },
        });
      } catch (err) {
        req.log?.warn?.({ err }, 'activity log append failed');
      }
    };

    res.on('finish', () => {
      void persist();
    });
    res.on('close', () => {
      void persist();
    });
    next();
  };
}
