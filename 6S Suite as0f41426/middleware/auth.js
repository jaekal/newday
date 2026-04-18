// middleware/auth.js
import Negotiator from 'negotiator';
import { roleAccess } from '../config/roleAccess.js';
import { s } from '../utils/text.js';

export const normalizeRole = (v) => s(v).toLowerCase();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

export function prefersJson(req) {
  try {
    const negotiator = new Negotiator(req);
    const mediaType = negotiator.mediaType([
      'application/json',
      'text/html',
      'text/plain',
    ]);
    if (mediaType === 'application/json') return true;
  } catch {}

  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') || req.xhr === true;
}

function logAccessEvent(req, level, message, extra = {}) {
  return;
}

export function sanitizeUser(user) {
  if (!user) return null;

  return {
    id: s(user.id),
    username: s(user.username || user.id),
    name: s(user.name || user.username || user.id),
    role: normalizeRole(user.role || 'user'),
    email: s(user.email || ''),
    techId: s(user.techId || ''),
  };
}

export function attachUserToLocals(req, res, next) {
  const user = sanitizeUser(req.session?.user);
  const role = user?.role || 'user';

  if (req.session?.user) {
    req.session.user.role = role;
  }

  req.user = user;
  res.locals.user = user;
  res.locals.currentUser = user;
  res.locals.isAdmin = role === 'admin';
  res.locals.role = role;
  res.locals.allowedTools = roleAccess[role] || [];

  next();
}

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();

  logAccessEvent(req, 'warn', 'Authentication required', {
    action: 'require_auth',
    success: false,
    reason: 'unauthenticated',
    path: req.originalUrl || req.path,
    method: req.method,
    ip: clientIp(req),
  });

  if (prefersJson(req)) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const nextParam = encodeURIComponent(req.originalUrl || '/home');
  return res.redirect(`/auth/login?next=${nextParam}`);
}

export function requireRole(...allowedRoles) {
  const needed = (allowedRoles || []).flat().map(normalizeRole).filter(Boolean);

  return (req, res, next) => {
    if (!req.session?.user) {
      return requireAuth(req, res, next);
    }

    const role = normalizeRole(req.session.user.role || 'user');
    const ok = role === 'admin' || needed.length === 0 || needed.includes(role);

    if (ok) return next();

    logAccessEvent(req, 'warn', 'Role access denied', {
      action: 'require_role',
      success: false,
      reason: 'insufficient_role',
      role,
      requiredRoles: needed,
      path: req.originalUrl || req.path,
      method: req.method,
      ip: clientIp(req),
    });

    if (prefersJson(req)) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }

    return res.status(403).send('Forbidden');
  };
}
