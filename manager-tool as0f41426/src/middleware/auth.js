// src/middleware/auth.js
import { User } from '../models/index.js';

export async function attachCurrentUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    res.locals.currentUser = null;
    return next();
  }

  try {
    const user = await User.findByPk(req.session.userId);
    req.currentUser = user || null;
    res.locals.currentUser = user || null;
  } catch (err) {
    console.error('AUTH attachCurrentUser error:', err);
    req.currentUser = null;
    res.locals.currentUser = null;
  }

  next();
}

export function ensureAuthenticated(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

/**
 * ensureRole(['MANAGER', 'LEAD']) will:
 * - allow any user whose role is in that list
 * - ALWAYS allow ADMIN (superuser)
 */
export function ensureRole(allowedRoles) {
  return async function (req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }

    try {
      const user = await User.findByPk(req.session.userId);
      if (!user) {
        return res.redirect('/login');
      }

      // ADMIN bypasses all role restrictions
      if (user.role === 'ADMIN' || allowedRoles.includes(user.role)) {
        req.currentUser = user;
        res.locals.currentUser = user;
        return next();
      }

      return res.status(403).send('Forbidden: insufficient permissions.');
    } catch (err) {
      console.error('ensureRole error:', err);
      return res.status(500).send('Auth error');
    }
  };
}
