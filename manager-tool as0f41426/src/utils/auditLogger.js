// src/utils/auditLogger.js
import { AuditLog } from '../models/index.js';

export async function createAuditLog({
  req,
  actorUser = null,
  actionType,
  entityType,
  entityId = null,
  targetName = null,
  summary = null,
  details = null,
}) {
  try {
    await AuditLog.create({
      actorUserId: actorUser?.id || null,
      actorName: actorUser?.username || actorUser?.email || null,
      actorRole: actorUser?.role || null,
      actionType,
      entityType,
      entityId: entityId != null ? String(entityId) : null,
      targetName: targetName || null,
      summary: summary || null,
      detailsJson: details ? JSON.stringify(details) : null,
      ipAddress: req?.ip || null,
      userAgent: req?.get?.('user-agent') || null,
    });
  } catch (err) {
    console.error('AUDIT LOG WRITE ERROR →', {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      at: new Date().toISOString(),
    });
  }
}