// src/utils/goals.js

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateOnly(dateStr) {
  if (!dateStr) return null;

  if (dateStr instanceof Date) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const s = String(dateStr).trim();
  if (!s) return null;

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const da = Number(m[3]);
    const d = new Date(y, mo, da);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateISO(dateLike) {
  const d = parseDateOnly(dateLike);
  if (!d) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function computeDaysLeft(dueDate, now = new Date()) {
  const due = parseDateOnly(dueDate);
  if (!due) return null;

  const n = new Date(now);
  n.setHours(0, 0, 0, 0);

  const diffMs = due.getTime() - n.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function dueLabel(daysLeft) {
  if (daysLeft == null) return { text: 'No due date', tone: 'muted' };
  if (daysLeft < 0) return { text: `${Math.abs(daysLeft)}d overdue`, tone: 'bad' };
  if (daysLeft === 0) return { text: 'Due today', tone: 'warn' };
  if (daysLeft <= 7) return { text: `${daysLeft}d left`, tone: 'warn' };
  return { text: `${daysLeft}d left`, tone: 'ok' };
}

function priorityPresentation(priority) {
  const p = String(priority || '').toUpperCase();
  if (p === 'HIGH') {
    return { label: 'High Priority', className: 'chip chip-danger' };
  }
  if (p === 'MEDIUM') {
    return { label: 'Medium Priority', className: 'chip chip-warn' };
  }
  if (p === 'LOW') {
    return { label: 'Low Priority', className: 'chip muted small' };
  }
  return { label: 'No Priority', className: 'chip muted small' };
}

function categoryPresentation(category) {
  const c = String(category || '').trim();
  return c ? c.replace(/_/g, ' ') : 'Uncategorized';
}

function computeGoalHealth({ status, progress, daysLeft }) {
  const st = String(status || 'OPEN').toUpperCase();
  const p = Number.isFinite(Number(progress)) ? Number(progress) : 0;

  if (st === 'ON_HOLD') {
    return {
      key: 'HOLD',
      label: 'On Hold',
      className: 'status-badge status-muted',
    };
  }

  if (st === 'DONE') {
    return {
      key: 'OK',
      label: 'On Track',
      className: 'status-badge status-done',
    };
  }

  if (daysLeft != null && daysLeft < 0) {
    return {
      key: 'RISK',
      label: 'Overdue',
      className: 'status-badge status-danger',
    };
  }

  if (daysLeft != null && daysLeft <= 7 && p < 60) {
    return {
      key: 'WARN',
      label: 'Watch',
      className: 'status-badge status-warn',
    };
  }

  if (daysLeft != null && daysLeft <= 14 && p < 30) {
    return {
      key: 'WARN',
      label: 'Watch',
      className: 'status-badge status-warn',
    };
  }

  return {
    key: 'OK',
    label: 'On Track',
    className: 'status-badge status-done',
  };
}

function statusPresentation(status) {
  const st = String(status || 'OPEN').toUpperCase();

  if (st === 'DONE') {
    return { label: 'DONE', className: 'status-badge status-done' };
  }

  if (st === 'IN_PROGRESS') {
    return { label: 'IN PROGRESS', className: 'status-badge status-open' };
  }

  if (st === 'ON_HOLD') {
    return { label: 'ON HOLD', className: 'status-badge status-muted' };
  }

  return { label: 'OPEN', className: 'status-badge status-open' };
}

function dueClassFromTone(tone) {
  if (tone === 'bad') return 'chip chip-danger';
  if (tone === 'warn') return 'chip chip-warn';
  return 'chip muted small';
}

export function computeGoalMeta(goal, opts = {}) {
  const now = opts.now || new Date();

  const progressNum = Number.isFinite(Number(goal.progress)) ? Number(goal.progress) : 0;
  const status = String(goal.status || 'OPEN').toUpperCase();

  const dueISO = formatDateISO(goal.dueDate);
  const daysLeft = computeDaysLeft(goal.dueDate, now);
  const due = dueLabel(daysLeft);
  const health = computeGoalHealth({ status, progress: progressNum, daysLeft });
  const statusMeta = statusPresentation(status);
  const priorityMeta = priorityPresentation(goal.priority);

  const isOverdue = daysLeft != null && daysLeft < 0;
  const isAtRisk =
    status !== 'DONE' &&
    status !== 'ON_HOLD' &&
    (isOverdue || (daysLeft != null && daysLeft <= 7 && progressNum < 60));

  return {
    status,
    statusLabel: statusMeta.label,
    statusClass: statusMeta.className,

    progressNum,

    dueISO,
    daysLeft,
    isOverdue,
    dueText: due.text,
    dueTone: due.tone,
    dueClass: dueClassFromTone(due.tone),

    healthKey: health.key,
    healthLabel: health.label,
    healthClass: health.className,

    isAtRisk,

    ownerName: goal.Owner ? goal.Owner.name : null,

    categoryLabel: categoryPresentation(goal.category),
    priorityLabel: priorityMeta.label,
    priorityClass: priorityMeta.className,
  };
}