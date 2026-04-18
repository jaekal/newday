// src/routes/auth.js
import express from 'express';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { User, LoginAuditLog } from '../models/index.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLogger.js';

const router = express.Router();

function buildSafeUserLog(user) {
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

async function createLoginAudit({
  req,
  user = null,
  loginName = '',
  eventType,
  failureReason = null,
}) {
  try {
    await LoginAuditLog.create({
      userId: user?.id || null,
      loginName: String(loginName || '').trim(),
      emailSnapshot: user?.email || null,
      roleSnapshot: user?.role || null,
      eventType,
      failureReason,
      ipAddress: req.ip || null,
      userAgent: req.get('user-agent') || null,
    });
  } catch (err) {
    console.error('LOGIN AUDIT WRITE ERROR →', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      at: new Date().toISOString(),
    });
  }
}

// GET /login
router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }

  return res.render('auth/login', { error: null });
});

// POST /login
router.post('/login', async (req, res) => {
  const usernameInput = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  try {
    const user = await User.findOne({
      where: {
        [Op.or]: [{ username: usernameInput }, { email: usernameInput }],
      },
    });

    if (!user) {
      await createLoginAudit({
        req,
        user: null,
        loginName: usernameInput,
        eventType: 'LOGIN_FAILED',
        failureReason: 'USER_NOT_FOUND',
      });

      await createAuditLog({
        req,
        actorUser: null,
        actionType: 'LOGIN_FAILED',
        entityType: 'AUTH',
        entityId: null,
        targetName: usernameInput,
        summary: 'Login failed because user was not found.',
        details: {
          loginName: usernameInput,
          failureReason: 'USER_NOT_FOUND',
        },
      });

      console.warn('LOGIN FAILED → user not found', {
        login: usernameInput,
        ip: req.ip,
        at: new Date().toISOString(),
      });

      return res.status(401).render('auth/login', {
        error: 'Invalid credentials',
      });
    }

    if (!user.isEnabled) {
      await createLoginAudit({
        req,
        user,
        loginName: usernameInput,
        eventType: 'LOGIN_BLOCKED',
        failureReason: 'ACCOUNT_DISABLED',
      });

      await createAuditLog({
        req,
        actorUser: user,
        actionType: 'LOGIN_BLOCKED',
        entityType: 'AUTH',
        entityId: user.id,
        targetName: user.username || user.email,
        summary: 'Login attempt blocked because account is disabled.',
        details: {
          loginName: usernameInput,
          failureReason: 'ACCOUNT_DISABLED',
          userId: user.id,
        },
      });

      console.warn('LOGIN BLOCKED → disabled account', {
        user: buildSafeUserLog(user),
        ip: req.ip,
        at: new Date().toISOString(),
      });

      return res.status(403).render('auth/login', {
        error: 'Account is disabled. Please contact your manager or an administrator.',
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      await createLoginAudit({
        req,
        user,
        loginName: usernameInput,
        eventType: 'LOGIN_FAILED',
        failureReason: 'INVALID_PASSWORD',
      });

      await createAuditLog({
        req,
        actorUser: user,
        actionType: 'LOGIN_FAILED',
        entityType: 'AUTH',
        entityId: user.id,
        targetName: user.username || user.email,
        summary: 'Login failed because password was invalid.',
        details: {
          loginName: usernameInput,
          failureReason: 'INVALID_PASSWORD',
          userId: user.id,
        },
      });

      console.warn('LOGIN FAILED → invalid password', {
        user: buildSafeUserLog(user),
        ip: req.ip,
        at: new Date().toISOString(),
      });

      return res.status(401).render('auth/login', {
        error: 'Invalid credentials',
      });
    }

    req.session.userId = user.id;

    await createLoginAudit({
      req,
      user,
      loginName: usernameInput,
      eventType: 'LOGIN_SUCCESS',
      failureReason: null,
    });

    await createAuditLog({
      req,
      actorUser: user,
      actionType: 'LOGIN_SUCCESS',
      entityType: 'AUTH',
      entityId: user.id,
      targetName: user.username || user.email,
      summary: 'User logged into the application successfully.',
      details: {
        loginName: usernameInput,
        userId: user.id,
      },
    });

    console.info('LOGIN SUCCESS →', {
      user: buildSafeUserLog(user),
      ip: req.ip,
      at: new Date().toISOString(),
    });

    return res.redirect('/');
  } catch (err) {
    console.error('LOGIN ERROR →', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      ip: req.ip,
      at: new Date().toISOString(),
    });

    return res.status(500).render('auth/login', {
      error: 'Unexpected error during login. Check server logs.',
    });
  }
});

// POST /logout
router.post('/logout', async (req, res) => {
  try {
    let user = null;

    if (req.session?.userId) {
      user = await User.findByPk(req.session.userId);
    }

    await createLoginAudit({
      req,
      user,
      loginName: user?.username || 'unknown',
      eventType: 'LOGOUT',
      failureReason: null,
    });

    await createAuditLog({
      req,
      actorUser: user,
      actionType: 'LOGOUT',
      entityType: 'AUTH',
      entityId: user?.id || null,
      targetName: user?.username || user?.email || 'unknown',
      summary: 'User logged out of the application.',
      details: {
        userId: user?.id || null,
      },
    });

    console.info('LOGOUT →', {
      user: buildSafeUserLog(user),
      ip: req.ip,
      at: new Date().toISOString(),
    });

    req.session.destroy(() => {
      res.redirect('/login');
    });
  } catch (err) {
    console.error('LOGOUT ERROR →', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      ip: req.ip,
      at: new Date().toISOString(),
    });

    return res.redirect('/login');
  }
});

// GET /account/password
router.get('/account/password', ensureAuthenticated, (req, res) => {
  return res.render('account/password', { error: null, success: null });
});

router.post('/account/password', ensureAuthenticated, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  try {
    if (!newPassword || newPassword.length < 8) {
      return res.render('account/password', {
        error: 'New password must be at least 8 characters.',
        success: null,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render('account/password', {
        error: 'New passwords do not match.',
        success: null,
      });
    }

    const user = await User.findByPk(req.session.userId);

    if (!user) {
      return res.redirect('/login');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!valid) {
      return res.render('account/password', {
        error: 'Current password is incorrect.',
        success: null,
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = newHash;
    await user.save();

    await createAuditLog({
      req,
      actorUser: user,
      actionType: 'PASSWORD_CHANGE',
      entityType: 'ACCOUNT',
      entityId: user.id,
      targetName: user.username || user.email,
      summary: 'User changed account password.',
      details: {
        userId: user.id,
      },
    });

    console.info('PASSWORD CHANGED →', {
      user: buildSafeUserLog(user),
      ip: req.ip,
      at: new Date().toISOString(),
    });

    return res.render('account/password', {
      error: null,
      success: 'Password updated successfully.',
    });
  } catch (err) {
    console.error('PASSWORD CHANGE ERROR →', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      ip: req.ip,
      at: new Date().toISOString(),
    });

    return res.render('account/password', {
      error: 'Unable to update password at this time.',
      success: null,
    });
  }
});

export default router;