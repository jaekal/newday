// src/routes/adminAudit.js
import express from 'express';
import { Op } from 'sequelize';
import { ensureRole } from '../middleware/auth.js';
import { LoginAuditLog, AuditLog, User } from '../models/index.js';

const router = express.Router();

router.use(ensureRole(['ADMIN']));

// Human-readable labels for event/action types
const LOGIN_EVENT_LABELS = {
  LOGIN_SUCCESS: 'Login Success',
  LOGIN_FAILED: 'Login Failed',
  LOGOUT: 'Logout',
  SESSION_EXPIRED: 'Session Expired',
  PASSWORD_RESET: 'Password Reset',
  ACCOUNT_LOCKED: 'Account Locked',
};

const ACTION_LABELS = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  VIEW: 'Viewed',
  IMPORT: 'Imported',
  EXPORT: 'Exported',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  SUBMIT: 'Submitted',
};

const ENTITY_LABELS = {
  USER: 'User',
  STAFF: 'Staff',
  REVIEW: 'Review',
  GOAL: 'Goal',
  INCIDENT: 'Incident',
  CHECKIN: 'Check-in',
  SCHEDULE: 'Schedule',
  SETTINGS: 'Settings',
};

function humanizeLoginEvent(eventType) {
  return LOGIN_EVENT_LABELS[String(eventType).toUpperCase()] || eventType;
}

function humanizeActivityTitle(entityType, actionType) {
  const entity = ENTITY_LABELS[String(entityType).toUpperCase()] || entityType;
  const action = ACTION_LABELS[String(actionType).toUpperCase()] || actionType;
  return `${entity} ${action}`;
}

// Severity: 'success' | 'warn' | 'danger' | 'neutral'
function loginSeverity(eventType) {
  const t = String(eventType).toUpperCase();
  if (t === 'LOGIN_SUCCESS') return 'success';
  if (t === 'LOGOUT' || t === 'SESSION_EXPIRED') return 'neutral';
  if (t === 'LOGIN_FAILED' || t === 'ACCOUNT_LOCKED') return 'danger';
  return 'neutral';
}

function activitySeverity(actionType) {
  const t = String(actionType).toUpperCase();
  if (t === 'DELETE') return 'danger';
  if (t === 'CREATE' || t === 'APPROVE' || t === 'SUBMIT') return 'success';
  if (t === 'UPDATE' || t === 'IMPORT') return 'warn';
  return 'neutral';
}

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

function mapLoginLog(log) {
  const actor = log.user?.username || log.emailSnapshot || log.loginName || 'Unknown';
  const loginName = log.loginName || log.emailSnapshot || '';
  return {
    source: 'login',
    createdAt: log.createdAt,
    title: humanizeLoginEvent(log.eventType),
    actor,
    subtitle: loginName !== actor ? loginName : null,
    role: log.roleSnapshot || log.user?.role || '',
    summary: log.failureReason || null,
    severity: loginSeverity(log.eventType),
    ipAddress: log.ipAddress || '',
    details: {
      email: log.emailSnapshot || log.loginName || null,
      role: log.roleSnapshot || null,
      failureReason: log.failureReason || null,
      userAgent: log.userAgent || null,
    },
  };
}

function mapAuditLog(log) {
  return {
    source: 'activity',
    createdAt: log.createdAt,
    title: humanizeActivityTitle(log.entityType, log.actionType),
    actor: log.actor?.username || log.actorName || 'Unknown',
    subtitle: log.targetName || null,
    role: log.actorRole || log.actor?.role || '',
    summary: log.summary || null,
    severity: activitySeverity(log.actionType),
    ipAddress: log.ipAddress || '',
    details: {
      entityType: log.entityType || null,
      entityId: log.entityId || null,
      target: log.targetName || null,
      changes: safeParseJson(log.detailsJson),
      userAgent: log.userAgent || null,
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const tab = String(req.query.tab || 'combined');
    const filterActor = String(req.query.actor || '').trim().toLowerCase();
    const filterSeverity = String(req.query.severity || '').trim().toLowerCase();

    const [loginLogs, auditLogs] = await Promise.all([
      LoginAuditLog.findAll({
        include: [{ model: User, as: 'user', required: false, attributes: ['id', 'username', 'email', 'role'] }],
        order: [['createdAt', 'DESC']],
        limit: limit + offset,
      }),
      AuditLog.findAll({
        include: [{ model: User, as: 'actor', required: false, attributes: ['id', 'username', 'email', 'role'] }],
        order: [['createdAt', 'DESC']],
        limit: limit + offset,
      }),
    ]);

    const mappedLogins = loginLogs.map(mapLoginLog);
    const mappedActivity = auditLogs.map(mapAuditLog);

    const combined = [...mappedLogins, ...mappedActivity]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    function applyFilters(rows) {
      return rows.filter((r) => {
        if (filterActor && !r.actor.toLowerCase().includes(filterActor)) return false;
        if (filterSeverity && r.severity !== filterSeverity) return false;
        return true;
      });
    }

    const tabRows =
      tab === 'logins' ? applyFilters(mappedLogins) :
      tab === 'activity' ? applyFilters(mappedActivity) :
      applyFilters(combined);

    const paginatedRows = tabRows.slice(offset, offset + limit);
    const hasMore = tabRows.length > offset + limit;

    return res.render('admin/audit', {
      title: 'Admin Audit Center',
      currentTab: tab,
      rows: paginatedRows,
      totalCount: tabRows.length,
      limit,
      offset,
      hasMore,
      hasPrev: offset > 0,
      filterActor,
      filterSeverity,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE single audit record
router.post('/delete', async (req, res, next) => {
  try {
    const id = Number(req.body.id);
    const source = String(req.body.source || '');
    if (!id || id <= 0) return res.redirect('/admin/audit');

    if (source === 'login') {
      await LoginAuditLog.destroy({ where: { id } });
    } else {
      await AuditLog.destroy({ where: { id } });
    }

    const ref = req.get('referer');
    return res.redirect(ref && ref.includes('/admin/audit') ? ref : '/admin/audit');
  } catch (err) {
    next(err);
  }
});

// PURGE: bulk delete checked entries or entire category
router.post('/purge', async (req, res, next) => {
  try {
    const category = String(req.body.category || '');

    if (category === 'all-login') {
      await LoginAuditLog.destroy({ where: {} });
    } else if (category === 'all-activity') {
      await AuditLog.destroy({ where: {} });
    } else if (category === 'all') {
      await LoginAuditLog.destroy({ where: {} });
      await AuditLog.destroy({ where: {} });
    } else {
      // Bulk delete selected entries encoded as "source:id"
      const entries = [].concat(req.body.entries || []);
      const loginIds = [];
      const activityIds = [];

      for (const entry of entries) {
        const [src, rawId] = String(entry).split(':');
        const numId = Number(rawId);
        if (!numId || numId <= 0) continue;
        if (src === 'login') loginIds.push(numId);
        else activityIds.push(numId);
      }

      if (loginIds.length) await LoginAuditLog.destroy({ where: { id: { [Op.in]: loginIds } } });
      if (activityIds.length) await AuditLog.destroy({ where: { id: { [Op.in]: activityIds } } });
    }

    return res.redirect('/admin/audit');
  } catch (err) {
    next(err);
  }
});

export default router;