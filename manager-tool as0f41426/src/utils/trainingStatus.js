// src/utils/trainingStatus.js

export function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const s = String(value).trim();
  if (!s) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatDateISO(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

export function frequencyToMonths(freqRaw) {
  if (!freqRaw) return null;
  const s = String(freqRaw).trim().toLowerCase();
  if (!s) return null;

  if (s.includes('annual') || s === 'yearly' || s === 'once a year') return 12;
  if (s.includes('biannual') || s.includes('semiannual') || s.includes('twice a year')) return 6;
  if (s.includes('quarter')) return 3;
  if (s.includes('monthly')) return 1;

  const everyMatch = s.match(/every\s+(\d+)\s*(year|years|month|months)/);
  if (everyMatch) {
    const n = Number(everyMatch[1]);
    const unit = everyMatch[2];
    if (!Number.isFinite(n) || n <= 0) return null;
    return unit.startsWith('year') ? n * 12 : n;
  }

  const bareMatch = s.match(/^(\d+)\s*(year|years|month|months)$/);
  if (bareMatch) {
    const n = Number(bareMatch[1]);
    const unit = bareMatch[2];
    if (!Number.isFinite(n) || n <= 0) return null;
    return unit.startsWith('year') ? n * 12 : n;
  }

  if (s.includes('biennial')) return 24;

  return null;
}

export function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Course type → category tag
 * Tune these keywords to your organization.
 */
export function courseCategoryFromType(courseTypeRaw) {
  const t = String(courseTypeRaw || '').trim().toLowerCase();

  // Required / compliance / safety
  const requiredKeywords = [
    'esd',
    'safety',
    'compliance',
    'policy',
    'required',
    'ethics',
    'harassment',
    'osha',
    'security',
    'environment',
    'qms',
    'quality',
    'audit',
    'certification',
  ];

  // Role-based / technical
  const roleBasedKeywords = [
    'technical',
    'process',
    'equipment',
    'manufacturing',
    'test',
    'engineering',
    'operations',
    'lab',
    'solder',
    'ipc',
    'iso',
  ];

  // Optional / development
  const optionalKeywords = [
    'development',
    'soft skill',
    'leadership',
    'communication',
    'career',
    'optional',
  ];

  if (requiredKeywords.some((k) => t.includes(k))) return 'REQUIRED';
  if (roleBasedKeywords.some((k) => t.includes(k))) return 'ROLE_BASED';
  if (optionalKeywords.some((k) => t.includes(k))) return 'OPTIONAL';

  // Unknown defaults to role-based (safer assumption for ops orgs)
  return 'ROLE_BASED';
}

export function categoryPresentation(category) {
  switch (category) {
    case 'REQUIRED':
      return { label: 'Required', chipClass: 'chip chip-required' };
    case 'OPTIONAL':
      return { label: 'Optional', chipClass: 'chip chip-optional' };
    case 'ROLE_BASED':
    default:
      return { label: 'Role-Based', chipClass: 'chip chip-rolebased' };
  }
}

export function computeTrainingRecordMeta(record, opts = {}) {
  const expiringSoonDays = Number.isFinite(opts.expiringSoonDays) ? opts.expiringSoonDays : 60;
  const now = opts.now instanceof Date ? opts.now : new Date();

  const progressRaw = record?.overallProgress;
  const progressNum =
    progressRaw === '' || progressRaw === null || progressRaw === undefined
      ? null
      : Number(progressRaw);

  const start = toDate(record?.startDate);
  const end = toDate(record?.endDate);

  const completionDate =
    end || ((progressNum === 100 || String(progressRaw).trim() === '100%') && start ? start : null);

  const freqMonths = frequencyToMonths(record?.certificationFrequency);
  const dueDate = completionDate && freqMonths ? addMonths(completionDate, freqMonths) : null;

  const isComplete = progressNum === 100 || String(progressRaw).trim() === '100%';
  const isNotStarted = progressNum === 0 || String(progressRaw).trim().toLowerCase() === 'not started';
  const isInProgress = progressNum != null && progressNum > 0 && progressNum < 100;

  let status = 'UNKNOWN';
  let label = 'Unknown';
  let badgeClass = 'status-badge status-open';

  if (isInProgress) {
    status = 'IN_PROGRESS';
    label = 'In Progress';
    badgeClass = 'status-badge status-open';
  } else if (isNotStarted) {
    status = 'NOT_STARTED';
    label = 'Not Started';
    badgeClass = 'status-badge status-open';
  } else if (isComplete) {
    if (dueDate) {
      const daysLeft = daysBetween(now, dueDate);
      if (daysLeft < 0) {
        status = 'EXPIRED';
        label = 'Expired';
        badgeClass = 'status-badge status-danger';
      } else if (daysLeft <= expiringSoonDays) {
        status = 'EXPIRING';
        label = `Expiring (${daysLeft}d)`;
        badgeClass = 'status-badge status-warning';
      } else {
        status = 'CURRENT';
        label = 'Current';
        badgeClass = 'status-badge status-done';
      }
    } else {
      status = 'COMPLETED';
      label = 'Completed';
      badgeClass = 'status-badge status-done';
    }
  }

  const daysLeft = dueDate ? daysBetween(now, dueDate) : null;

  return {
    progressNum: Number.isFinite(progressNum) ? progressNum : null,
    startDate: start,
    endDate: end,
    completionDate,
    freqMonths,
    dueDate,
    daysLeft,
    status,
    label,
    badgeClass,
  };
}

export function computeCourseOverallStatus(recordMetas = []) {
  const statuses = recordMetas.map((m) => m.status);
  const priority = ['EXPIRED', 'EXPIRING', 'IN_PROGRESS', 'NOT_STARTED', 'CURRENT', 'COMPLETED', 'UNKNOWN'];
  for (const s of priority) {
    if (statuses.includes(s)) return s;
  }
  return 'UNKNOWN';
}

export function courseStatusPresentation(overallStatus) {
  switch (overallStatus) {
    case 'EXPIRED':
      return { label: 'Expired', badgeClass: 'status-badge status-danger' };
    case 'EXPIRING':
      return { label: 'Expiring Soon', badgeClass: 'status-badge status-warning' };
    case 'CURRENT':
      return { label: 'Current', badgeClass: 'status-badge status-done' };
    case 'IN_PROGRESS':
      return { label: 'In Progress', badgeClass: 'status-badge status-open' };
    case 'NOT_STARTED':
      return { label: 'Not Started', badgeClass: 'status-badge status-open' };
    case 'COMPLETED':
      return { label: 'Completed', badgeClass: 'status-badge status-done' };
    default:
      return { label: 'Unknown', badgeClass: 'status-badge status-open' };
  }
}
