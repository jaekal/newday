// middleware/roleCheck.js
import { roleAccess } from '../config/roleAccess.js';
import { prefersJson, normalizeRole } from './auth.js';

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function logAccessEvent(req, level, message, extra = {}) {
  req.log?.[level]?.(
    {
      event: 'access',
      ...extra,
    },
    message
  );
}

function respondForbidden(req, res, { reason, required, toolKey } = {}) {
  const payload = {
    error: {
      code: 'FORBIDDEN',
      message: 'Forbidden: insufficient privileges',
      reason,
      toolKey: toolKey ?? undefined,
      requiredRoles: required?.length ? required : undefined,
      userRole: req.session?.user?.role ?? null,
      requestId: req.id,
    },
  };

  if (prefersJson(req)) {
    return res.status(403).json(payload);
  }

  return res.status(403).send('403 Forbidden: insufficient privileges.');
}

export function hasAccess(role, toolKey) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole || !toolKey) return false;

  const allowedTools = roleAccess[normalizedRole] || [];
  return allowedTools.includes(toolKey);
}

export function hasAccessForRequest(req, toolKey) {
  const role = normalizeRole(req.session?.user?.role);
  if (!role) return false;
  if (role === 'admin') return true;
  return hasAccess(role, toolKey);
}

export function requireRoleForTool(toolKey) {
  if (!toolKey) {
    throw new Error('requireRoleForTool(toolKey) requires a non-empty toolKey');
  }

  const allowedRoles = Object.entries(roleAccess)
    .filter(([, tools]) => Array.isArray(tools) && tools.includes(toolKey))
    .map(([role]) => normalizeRole(role));

  return (req, res, next) => {
    const role = normalizeRole(req.session?.user?.role);
    const path = req.originalUrl || req.path;

    if (!role) {
      logAccessEvent(req, 'warn', 'Tool access denied: unauthenticated', {
        action: 'require_role_for_tool',
        success: false,
        reason: 'unauthenticated',
        toolKey,
        requiredRoles: allowedRoles,
        path,
        method: req.method,
        ip: clientIp(req),
      });

      return respondForbidden(req, res, {
        reason: 'unauthenticated',
        required: allowedRoles,
        toolKey,
      });
    }

    if (role === 'admin') return next();

    if (!allowedRoles.includes(role)) {
      logAccessEvent(req, 'warn', 'Tool access denied', {
        action: 'require_role_for_tool',
        success: false,
        reason: 'role_not_permitted_for_tool',
        role,
        toolKey,
        requiredRoles: allowedRoles,
        path,
        method: req.method,
        ip: clientIp(req),
      });

      return respondForbidden(req, res, {
        reason: 'role_not_permitted_for_tool',
        required: allowedRoles,
        toolKey,
      });
    }

    return next();
  };
}

/** Allow if the user has any one of these tool keys (see config/roleAccess.js). Admin always passes. */
export function requireAnyTool(...toolKeys) {
  const keys = toolKeys.flat().filter(Boolean);
  if (!keys.length) {
    throw new Error('requireAnyTool(...toolKeys) requires at least one tool key');
  }

  return (req, res, next) => {
    const role = normalizeRole(req.session?.user?.role);
    const path = req.originalUrl || req.path;

    if (!role) {
      logAccessEvent(req, 'warn', 'Tool access denied: unauthenticated', {
        action: 'require_any_tool',
        success: false,
        reason: 'unauthenticated',
        toolKeys: keys,
        path,
        method: req.method,
        ip: clientIp(req),
      });
      return respondForbidden(req, res, {
        reason: 'unauthenticated',
        required: keys,
        toolKey: keys.join('|'),
      });
    }

    if (role === 'admin') return next();

    for (const k of keys) {
      if (hasAccessForRequest(req, k)) return next();
    }

    logAccessEvent(req, 'warn', 'Tool access denied (any-of)', {
      action: 'require_any_tool',
      success: false,
      reason: 'no_matching_tool_key',
      role,
      toolKeys: keys,
      path,
      method: req.method,
      ip: clientIp(req),
    });

    return respondForbidden(req, res, {
      reason: 'no_matching_tool_key',
      required: keys,
      toolKey: keys.join('|'),
    });
  };
}

export function requireRole(...roles) {
  const required = roles.flat().filter(Boolean).map(normalizeRole);

  if (!required.length) {
    throw new Error('requireRole(...roles) requires at least one role');
  }

  return (req, res, next) => {
    const role = normalizeRole(req.session?.user?.role);
    const path = req.originalUrl || req.path;

    if (!role) {
      logAccessEvent(req, 'warn', 'Role check denied: unauthenticated', {
        action: 'require_role',
        success: false,
        reason: 'unauthenticated',
        requiredRoles: required,
        path,
        method: req.method,
        ip: clientIp(req),
      });

      return respondForbidden(req, res, {
        reason: 'unauthenticated',
        required,
      });
    }

    if (role === 'admin') return next();

    if (!required.includes(role)) {
      logAccessEvent(req, 'warn', 'Role check denied', {
        action: 'require_role',
        success: false,
        reason: 'role_not_allowed',
        role,
        requiredRoles: required,
        path,
        method: req.method,
        ip: clientIp(req),
      });

      return respondForbidden(req, res, {
        reason: 'role_not_allowed',
        required,
      });
    }

    return next();
  };
}