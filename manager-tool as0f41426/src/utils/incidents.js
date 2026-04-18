// src/utils/incidents.js

export const INCIDENT_TYPES = ['POSITIVE', 'COACHING', 'FORMAL', 'INFO'];

export const TYPE_TONE_MAP = {
  POSITIVE: [
    'RECOGNITION',
    'ACHIEVEMENT',
    'ENCOURAGEMENT',
    'PROFESSIONAL_COMMENDATION',
  ],
  COACHING: [
    'NEEDS_IMPROVEMENT',
    'GUIDANCE',
    'REDIRECTION',
    'ACCOUNTABILITY_REMINDER',
  ],
  FORMAL: [
    'PERFORMANCE_CONCERN',
    'POLICY_VIOLATION',
    'CONDUCT_CONCERN',
    'ESCALATED_DOCUMENTATION',
  ],
  INFO: [
    'NEUTRAL_RECORD',
    'ATTENDANCE_NOTE',
    'OPERATIONAL_NOTE',
    'ADMINISTRATIVE_UPDATE',
  ],
};

export const INCIDENT_TONES = Object.values(TYPE_TONE_MAP).flat();

export const TYPE_META = {
  POSITIVE: {
    label: 'Positive',
    description: 'Recognition, praise, encouragement, and standout contributions.',
    defaultTone: 'RECOGNITION',
    defaultSeverity: 'LOW',
    followUpSuggested: false,
    helper:
      'Capture what was done well, why it mattered, and the behavior you want repeated.',
  },
  COACHING: {
    label: 'Coaching',
    description: 'Developmental correction, guidance, or redirecting behavior.',
    defaultTone: 'NEEDS_IMPROVEMENT',
    defaultSeverity: 'LOW',
    followUpSuggested: false,
    helper:
      'Describe the observed behavior, the expected standard, and the coaching given.',
  },
  FORMAL: {
    label: 'Formal',
    description: 'Documented concern, policy issue, repeated issue, or serious event.',
    defaultTone: 'PERFORMANCE_CONCERN',
    defaultSeverity: 'MEDIUM',
    followUpSuggested: true,
    helper:
      'Document the event factually, note the policy or standard, and record required next steps.',
  },
  INFO: {
    label: 'Info',
    description: 'Neutral documentation for context, records, or operational reference.',
    defaultTone: 'NEUTRAL_RECORD',
    defaultSeverity: 'LOW',
    followUpSuggested: false,
    helper:
      'Capture the context clearly without framing it as praise or correction.',
  },
};

export const IMPACT_AREAS = [
  'SAFETY',
  'QUALITY',
  'DELIVERY',
  'PEOPLE',
  'COST',
  'COMPLIANCE',
  'PROCESS',
  'OTHER',
];

export const THEMES = [
  'OWNERSHIP',
  'TEAMWORK',
  'COMMUNICATION',
  'INITIATIVE',
  'ENGAGEMENT',
  'ATTENDANCE',
  'TRAINING',
  'CONDUCT',
  'PROCESS_IMPROVEMENT',
  'OTHER',
];

export const SEVERITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];

export const FOLLOWUP_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED', 'NO_ACTION'];

export function normalizeUpper(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, '_').toUpperCase();
}

export function normalizeOptionalEnum(value, allowed, fallback = null) {
  const v = normalizeUpper(value);
  if (!v) return fallback;
  return allowed.includes(v) ? v : fallback;
}

export function parseBooleanOn(value) {
  return value === true || value === 'true' || value === 'on' || value === '1' || value === 1;
}

export function safeISODateOnly(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(isoDate + 'T00:00:00');
  b.setHours(0, 0, 0, 0);
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function computeFollowUpHealth(incident) {
  const requires = !!incident.requiresFollowUp;
  const status = normalizeUpper(incident.followUpStatus || '');
  const due = safeISODateOnly(incident.followUpDueDate);
  const dLeft = due ? daysUntil(due) : null;

  if (!requires) {
    return {
      label: 'No follow-up',
      level: 'none',
      overdue: false,
      daysLeft: dLeft,
    };
  }

  if (status === 'CLOSED') {
    return {
      label: 'Closed',
      level: 'ok',
      overdue: false,
      daysLeft: dLeft,
    };
  }

  if (due && dLeft !== null && dLeft < 0) {
    return {
      label: 'Overdue',
      level: 'bad',
      overdue: true,
      daysLeft: dLeft,
    };
  }

  if (due && dLeft !== null && dLeft <= 3) {
    return {
      label: 'Due soon',
      level: 'warn',
      overdue: false,
      daysLeft: dLeft,
    };
  }

  return {
    label: status === 'IN_PROGRESS' ? 'In Progress' : 'Open',
    level: 'warn',
    overdue: false,
    daysLeft: dLeft,
  };
}

export function getAllowedTonesForType(type) {
  const normalizedType = normalizeUpper(type);
  return TYPE_TONE_MAP[normalizedType] || [];
}

export function isToneAllowedForType(type, tone) {
  const tones = getAllowedTonesForType(type);
  const normalizedTone = normalizeUpper(tone);
  return tones.includes(normalizedTone);
}

export function getTypeMeta(type) {
  const normalizedType = normalizeUpper(type);
  return TYPE_META[normalizedType] || TYPE_META.COACHING;
}

export const DETAILS_TEMPLATES = [
  {
    key: 'POSITIVE',
    label: 'Positive Recognition',
    text:
`What happened:
Why it mattered:
Specific behavior or result:
Positive impact:
Encourage repeat:`,
  },
  {
    key: 'COACHING',
    label: 'Coaching Conversation',
    text:
`What happened:
Observed behavior:
Impact:
Expectation / standard reviewed:
Coaching provided:
Employee response:
Next step:`,
  },
  {
    key: 'FORMAL',
    label: 'Formal Documentation',
    text:
`Policy / standard:
Observed issue:
Impact:
Required action:
Support provided:
Follow-up date:
Employee response:`,
  },
  {
    key: 'INFO',
    label: 'Informational Record',
    text:
`Context:
Operational note:
Relevant details:
Reference / next step:`,
  },
];