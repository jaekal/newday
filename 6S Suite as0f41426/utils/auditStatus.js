// utils/auditStatus.js (moment-free)
export function getAuditStatus(asset, auditRules, auditLogs = []) {
  const rule = auditRules?.[asset.category];
  const days = Number(rule?.frequencyDays || 0);
  if (!days || days < 0) {
    return { due: false, overdue: false, nextDue: null };
  }

  let lastAudit = null;
  for (const log of auditLogs) {
    const d = log?.auditDate ? new Date(log.auditDate) : null;
    if (d && !Number.isNaN(d.getTime()) && (!lastAudit || d > lastAudit)) lastAudit = d;
  }

  if (!lastAudit) {
    return { due: true, overdue: true, nextDue: null };
  }

  const nextDue = new Date(lastAudit.getTime() + days * 24 * 60 * 60 * 1000);
  const now = new Date();
  const dueSoon = new Date(nextDue.getTime() - 7 * 24 * 60 * 60 * 1000);

  const isoDate = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  return {
    due: now >= dueSoon,
    overdue: now >= nextDue,
    nextDue: isoDate(nextDue),
  };
}
