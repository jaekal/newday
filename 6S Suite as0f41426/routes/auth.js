// routes/auth.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import Joi from 'joi';
import bcrypt from 'bcrypt';
import { sensitiveLimiter, loginLimiter } from '../middleware/rateLimit.js';
import { getBuildingOptions, normalizeBuilding } from '../utils/buildings.js';
import { resolvePostLoginNext } from '../utils/postLoginNext.js';
import { s, lc } from '../utils/text.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

const router = express.Router();

async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf8');
    const list = JSON.parse(raw);

    return (Array.isArray(list) ? list : []).map((u) => ({
      username: s(u.username || u.email || ''),
      usernameLC: lc(u.usernameLC || u.username || u.email || ''),
      passwordHash: s(u.passwordHash || ''),
      role: lc(u.role || 'user'),
      name: s(u.name || u.username || ''),
      email: s(u.email || ''),
      createdAt: u.createdAt || new Date().toISOString(),
      updatedAt: u.updatedAt || u.createdAt || new Date().toISOString(),
      techId: s(u.techId || u.employeeId || ''),
      building: normalizeBuilding(u.building, { allowBlank: true }),
      active: u.active === false ? false : true,
      status: s(u.status || (u.active === false ? 'inactive' : 'active')).toLowerCase(),
    }));
  } catch {
    return [];
  }
}

function findUser(users, usernameOrEmail) {
  const q = lc(usernameOrEmail);
  return users.find((u) => u.usernameLC === q || lc(u.email) === q);
}

function wantsJson(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json') || req.xhr === true;
}

const loginSchema = Joi.object({
  username: Joi.string().trim().required(),
  password: Joi.string().min(1).required(),
  next: Joi.string().allow('').optional(),
});

function safeNext(next) {
  const n = s(next);
  if (n && n.startsWith('/') && !n.startsWith('//')) return n;
  return '/home';
}

function buildLoginRedirect(next, errorMessage) {
  const params = new URLSearchParams();
  if (errorMessage) params.set('error', errorMessage);
  if (next) params.set('next', safeNext(next));
  return `/auth/login?${params.toString()}`;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function logAuthEvent(req, level, message, extra = {}) {
  if (extra?.action !== 'login') return;
  req.log?.[level]?.(
    {
      event: 'auth',
      ...extra,
    },
    message
  );
}

// Render login page
router.get('/login', (req, res) => {
  const nextParam = safeNext(req.query.next || '');

  if (req.session?.user) {
    const dest = resolvePostLoginNext(req.session.user.role, req.query.next || '');
    return res.redirect(dest);
  }

  const error = s(req.query.error || '');

  return res.render('login', {
    error,
    next: nextParam,
    cspNonce: res.locals.cspNonce,
  });
});

// Handle login (HTML form or JSON). Rate-limited per (IP + username) so a
// rotated-username attack from one IP still trips; successful logins don't
// count against the bucket.
router.post('/login', loginLimiter, async (req, res) => {
  const isJson = wantsJson(req);
  const incomingNext = safeNext((req.body && req.body.next) || req.query.next || '');

  const { value, error } = loginSchema.validate(req.body || {}, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (error) {
    logAuthEvent(req, 'warn', 'Login validation failed', {
      action: 'login',
      success: false,
      reason: 'validation_failed',
      ip: clientIp(req),
    });

    if (isJson) {
      return res.status(400).json({
        message: 'Validation failed',
        details: error.details,
      });
    }

    return res.redirect(buildLoginRedirect(incomingNext, 'Username and password required'));
  }

  const { username, password } = value;
  const users = await loadUsers();
  const user = findUser(users, username);

  if (!user) {
    logAuthEvent(req, 'warn', 'Login failed', {
      action: 'login',
      success: false,
      reason: 'user_not_found',
      usernameAttempt: s(username),
      ip: clientIp(req),
    });

    if (isJson) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.redirect(buildLoginRedirect(incomingNext, 'Invalid credentials'));
  }

  if (user.active === false || user.status === 'inactive' || user.status === 'disabled') {
    logAuthEvent(req, 'warn', 'Login blocked for inactive account', {
      action: 'login',
      success: false,
      reason: 'inactive_account',
      username: user.username,
      role: user.role || 'user',
      ip: clientIp(req),
    });

    if (isJson) {
      return res.status(403).json({ message: 'Account is inactive' });
    }

    return res.redirect(buildLoginRedirect(incomingNext, 'Account is inactive'));
  }

  const ok = await bcrypt.compare(password, user.passwordHash || '');

  if (!ok) {
    logAuthEvent(req, 'warn', 'Login failed', {
      action: 'login',
      success: false,
      reason: 'bad_password',
      username: user.username,
      ip: clientIp(req),
    });

    if (isJson) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    return res.redirect(buildLoginRedirect(incomingNext, 'Invalid credentials'));
  }

  try {
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    req.log?.warn?.({ e }, 'session regenerate failed during login');
  }

  req.session.user = {
    id: user.username,
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'user',
    email: user.email || '',
    techId: user.techId || '',
    building: user.building || '',
  };

  req.session.authenticatedAt = new Date().toISOString();

  try {
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  } catch (e) {
    req.log?.error?.(
      {
        event: 'auth',
        action: 'login',
        success: false,
        reason: 'session_save_failed',
        username: user.username,
        ip: clientIp(req),
        e,
      },
      'Session save failed after login'
    );

    if (isJson) {
      return res.status(500).json({ message: 'Unable to persist login session' });
    }

    return res.redirect(buildLoginRedirect(incomingNext, 'Unable to create login session'));
  }

  const destination = resolvePostLoginNext(req.session.user.role, incomingNext);

  logAuthEvent(req, 'info', 'Login successful', {
    action: 'login',
    success: true,
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'user',
    ip: clientIp(req),
    next: destination,
  });

  if (isJson) {
    return res.json({
      message: 'Logged in',
      user: req.session.user,
      next: destination,
    });
  }

  return res.redirect(destination);
});

// Self-service password reset is not currently implemented — the app has no
// outbound email integration. Rather than silently pretend to send a reset
// link (misleading the user and creating a spray target for username
// enumeration), we render an honest message directing users to their admin.
router.get('/forgot', (_req, res) => {
  return res.render('forgot-password', {
    message:
      'Self-service password reset is not available on this system. ' +
      'Please contact your administrator to reset your password.',
  });
});

router.post('/forgot', sensitiveLimiter, async (req, res) => {
  const message =
    'Self-service password reset is not available on this system. ' +
    'Please contact your administrator to reset your password.';

  req.log?.info?.(
    {
      event: 'auth',
      action: 'forgot_password',
      success: false,
      reason: 'feature_disabled',
      usernameAttempt: s(req.body?.usernameOrEmail || req.body?.username || req.body?.email || ''),
      ip: clientIp(req),
    },
    'Forgot password submitted but feature is disabled'
  );

  return wantsJson(req) ? res.json({ message }) : res.render('forgot-password', { message });
});

router.post('/logout', sensitiveLimiter, (req, res) => {
  const isJson = wantsJson(req);
  const currentUser = req.session?.user || null;

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure:
      req.secure || String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https'),
    path: '/',
  };

  req.session.destroy((err) => {
    res.clearCookie('sixs.sid', cookieOptions);

    if (err) {
      req.log?.error?.(
        {
          event: 'auth',
          action: 'logout',
          success: false,
          username: currentUser?.username || null,
          ip: clientIp(req),
          err,
        },
        'Logout failed'
      );

      if (isJson) {
        return res.status(500).json({ message: 'Logout failed' });
      }

      return res.redirect('/auth/login?error=Logout%20failed');
    }

    logAuthEvent(req, 'info', 'Logout successful', {
      action: 'logout',
      success: true,
      username: currentUser?.username || null,
      role: currentUser?.role || null,
      ip: clientIp(req),
    });

    if (isJson) {
      return res.json({ message: 'Logged out' });
    }

    return res.redirect('/auth/login');
  });
});

router.get('/whoami', (req, res) => {
  return res.json({ user: req.session?.user || null, buildings: getBuildingOptions() });
});

export default router;
