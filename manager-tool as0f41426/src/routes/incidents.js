// src/routes/incidents.js
import express from 'express';
import { Op } from 'sequelize';
import { User, StaffProfile, Incident } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';
import { createAuditLog } from '../utils/auditLogger.js';
import {
  INCIDENT_TYPES,
  INCIDENT_TONES,
  TYPE_TONE_MAP,
  TYPE_META,
  IMPACT_AREAS,
  THEMES,
  SEVERITY_OPTIONS,
  FOLLOWUP_STATUSES,
  DETAILS_TEMPLATES,
  normalizeOptionalEnum,
  normalizeUpper,
  parseBooleanOn,
  safeISODateOnly,
  todayISO,
  computeFollowUpHealth,
  getTypeMeta,
  isToneAllowedForType,
} from '../utils/incidents.js';

const router = express.Router();

const INCIDENT_FORM_ROLES = ['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD'];
const STAFFISH_ROLES = ['STAFF', 'LEAD', 'SUPERVISOR'];

/* ─────────────────────────────────────────────────────────────
 * Viewer / scoping helpers
 * ───────────────────────────────────────────────────────────── */

async function getViewer(req) {
  if (!req.session || !req.session.userId) return null;
  return User.findByPk(req.session.userId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
}

function getProfileScope(user) {
  const profile = user?.StaffProfile || null;
  return {
    building: profile?.building || '',
    shift: profile?.shift || '',
  };
}

function canViewerAccessStaff(viewer, staffUser) {
  if (!viewer || !staffUser) return false;
  if (viewer.role === 'ADMIN') return true;

  const viewerScope = getProfileScope(viewer);
  const staffScope = getProfileScope(staffUser);

  if (!viewerScope.building && !viewerScope.shift) return true;
  if (!staffUser.StaffProfile) return false;

  if (
    viewerScope.building &&
    staffScope.building &&
    viewerScope.building !== staffScope.building
  ) {
    return false;
  }

  if (
    viewerScope.shift &&
    staffScope.shift &&
    viewerScope.shift !== staffScope.shift
  ) {
    return false;
  }

  return true;
}

function scopeStaffToViewer(staffArray, viewer) {
  if (!viewer || viewer.role === 'ADMIN') return staffArray;
  return staffArray.filter((s) => canViewerAccessStaff(viewer, s));
}

async function loadStaffOptionsForViewer(viewer) {
  const allStaff = await User.findAll({
    where: { role: { [Op.in]: STAFFISH_ROLES } },
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  return viewer?.role === 'ADMIN' ? allStaff : scopeStaffToViewer(allStaff, viewer);
}

/* ─────────────────────────────────────────────────────────────
 * Incident visibility / permissions
 * ───────────────────────────────────────────────────────────── */

async function getScopedLeadIdsForSupervisor(viewer) {
  const leads = await User.findAll({
    where: { role: 'LEAD' },
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });

  return leads.filter((u) => canViewerAccessStaff(viewer, u)).map((u) => u.id);
}

async function buildIncidentVisibilityWhere(viewer) {
  if (!viewer) return { where: { id: -1 } };

  if (viewer.role === 'ADMIN') return { where: {} };

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    const scopedStaff = await loadStaffOptionsForViewer(viewer);
    const allowedStaffIds = scopedStaff.map((s) => s.id);

    return {
      where: allowedStaffIds.length
        ? { staffId: { [Op.in]: allowedStaffIds } }
        : { staffId: -1 },
    };
  }

  if (viewer.role === 'SUPERVISOR') {
    const scopedLeadIds = await getScopedLeadIdsForSupervisor(viewer);
    return {
      where: {
        [Op.or]: [
          { submitterId: viewer.id },
          { submitterId: { [Op.in]: scopedLeadIds.length ? scopedLeadIds : [-1] } },
        ],
      },
    };
  }

  if (viewer.role === 'LEAD') {
    return { where: { submitterId: viewer.id } };
  }

  return { where: { id: -1 } };
}

async function canViewerEditIncident(viewer, incident) {
  if (!viewer || !incident) return false;

  if (viewer.role === 'ADMIN') return true;

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    return !!incident.Staff && canViewerAccessStaff(viewer, incident.Staff);
  }

  if (viewer.role === 'SUPERVISOR') {
    if (incident.submitterId === viewer.id) return true;
    const scopedLeadIds = await getScopedLeadIdsForSupervisor(viewer);
    return scopedLeadIds.includes(incident.submitterId);
  }

  if (viewer.role === 'LEAD') {
    return incident.submitterId === viewer.id;
  }

  return false;
}

async function canViewerDeleteIncident(viewer, incident) {
  if (!viewer || !incident) return false;

  if (viewer.role === 'ADMIN') return true;

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    return !!incident.Staff && canViewerAccessStaff(viewer, incident.Staff);
  }

  if (viewer.role === 'SUPERVISOR') {
    if (incident.submitterId === viewer.id) return true;
    const scopedLeadIds = await getScopedLeadIdsForSupervisor(viewer);
    return scopedLeadIds.includes(incident.submitterId);
  }

  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Form helpers
 * ───────────────────────────────────────────────────────────── */

function buildIncidentFormDefaults(overrides = {}) {
  return {
    staffId: '',
    incidentDate: todayISO(),
    title: '',
    details: '',
    type: 'COACHING',
    tone: 'NEEDS_IMPROVEMENT',
    impactArea: '',
    theme: '',
    severity: 'LOW',
    requiresFollowUp: false,
    followUpStatus: 'NO_ACTION',
    followUpDueDate: '',
    followUpOutcome: '',
    ...overrides,
  };
}

function buildReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') ? value : '/incidents';
}

function buildFilterSummary(filters, staffOptions = []) {
  const parts = [];

  if (filters.staffId) {
    const match = staffOptions.find((s) => String(s.id) === String(filters.staffId));
    parts.push(`Staff: ${match ? match.name : `#${filters.staffId}`}`);
  }

  if (filters.q) parts.push(`Search: "${filters.q}"`);
  if (filters.type) parts.push(`Type: ${filters.type.replace(/_/g, ' ')}`);
  if (filters.tone) parts.push(`Tone: ${filters.tone.replace(/_/g, ' ')}`);
  if (filters.impactArea) parts.push(`Impact: ${filters.impactArea.replace(/_/g, ' ')}`);
  if (filters.theme) parts.push(`Theme: ${filters.theme.replace(/_/g, ' ')}`);
  if (filters.severity) parts.push(`Severity: ${filters.severity}`);

  if (filters.followUp === 'open') parts.push('Follow-up: Open');
  if (filters.followUp === 'overdue') parts.push('Follow-up: Overdue');
  if (filters.mine === '1') parts.push('Mine only');

  if (filters.fromDate && filters.toDate) {
    parts.push(`Date: ${filters.fromDate} → ${filters.toDate}`);
  } else if (filters.fromDate) {
    parts.push(`Date: from ${filters.fromDate}`);
  } else if (filters.toDate) {
    parts.push(`Date: to ${filters.toDate}`);
  }

  return parts.length ? parts.join(' • ') : 'All records (no filters applied)';
}

function normalizeIncidentPayload(body = {}) {
  const type = normalizeOptionalEnum(body.type, INCIDENT_TYPES, 'COACHING');
  const typeMeta = getTypeMeta(type);

  let tone = normalizeOptionalEnum(body.tone, INCIDENT_TONES, typeMeta.defaultTone);
  if (!isToneAllowedForType(type, tone)) {
    tone = typeMeta.defaultTone;
  }

  const severity = normalizeOptionalEnum(
    body.severity,
    SEVERITY_OPTIONS,
    typeMeta.defaultSeverity
  );

  const requiresFollowUpRaw = parseBooleanOn(body.requiresFollowUp);
  const requiresFollowUp = typeMeta.followUpSuggested ? true : requiresFollowUpRaw;

  let followUpStatus = normalizeOptionalEnum(
    body.followUpStatus,
    FOLLOWUP_STATUSES,
    requiresFollowUp ? 'OPEN' : 'NO_ACTION'
  );

  if (!requiresFollowUp) {
    followUpStatus = 'NO_ACTION';
  } else if (followUpStatus === 'NO_ACTION') {
    followUpStatus = 'OPEN';
  }

  return {
    staffId: Number(body.staffId) || null,
    incidentDate: safeISODateOnly(body.incidentDate),
    title: String(body.title || '').trim(),
    details: String(body.details || '').trim(),
    type,
    tone,
    impactArea: normalizeOptionalEnum(body.impactArea, IMPACT_AREAS, null),
    theme: normalizeOptionalEnum(body.theme, THEMES, null),
    severity,
    requiresFollowUp,
    followUpStatus,
    followUpDueDate: requiresFollowUp ? safeISODateOnly(body.followUpDueDate) : null,
    followUpOutcome: String(body.followUpOutcome || '').trim() || null,
  };
}

function validateIncidentPayload(payload) {
  const errors = [];

  if (!payload.staffId) errors.push('Staff member is required.');
  if (!payload.incidentDate) errors.push('Event date is required.');
  if (!payload.title) errors.push('Title is required.');
  if (payload.title && payload.title.length > 200) {
    errors.push('Title must be 200 characters or fewer.');
  }

  if (!isToneAllowedForType(payload.type, payload.tone)) {
    errors.push('Tone is not valid for the selected type.');
  }

  if (payload.requiresFollowUp && !payload.followUpDueDate) {
    errors.push('Follow-up due date is required when follow-up is enabled.');
  }

  if (
    payload.requiresFollowUp &&
    payload.followUpStatus === 'CLOSED' &&
    !payload.followUpOutcome
  ) {
    errors.push('Follow-up outcome is required when closing an item.');
  }

  return errors;
}

async function renderIncidentForm(
  res,
  viewer,
  viewName,
  { incident = {}, error = null, returnTo = '/incidents', staffOptions = [] } = {}
) {
  return res.render(viewName, {
    staffOptions,
    incident: buildIncidentFormDefaults(incident),
    viewerRole: viewer.role,
    error,
    returnTo,
    types: INCIDENT_TYPES,
    tones: INCIDENT_TONES,
    toneMap: TYPE_TONE_MAP,
    typeMeta: TYPE_META,
    impactAreas: IMPACT_AREAS,
    themes: THEMES,
    severityOptions: SEVERITY_OPTIONS,
    followUpStatuses: FOLLOWUP_STATUSES,
    templates: DETAILS_TEMPLATES,
  });
}

/* ─────────────────────────────────────────────────────────────
 * GET /incidents
 * ───────────────────────────────────────────────────────────── */

router.get('/', ensureRole(INCIDENT_FORM_ROLES), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const {
      staffId,
      q,
      type,
      tone,
      impactArea,
      theme,
      severity,
      followUp,
      mine,
      fromDate,
      toDate,
    } = req.query;

    const where = {};

    const normalizedType = normalizeOptionalEnum(type, INCIDENT_TYPES, '');
    const normalizedTone = normalizeOptionalEnum(tone, INCIDENT_TONES, '');
    const normalizedImpact = normalizeOptionalEnum(impactArea, IMPACT_AREAS, '');
    const normalizedTheme = normalizeOptionalEnum(theme, THEMES, '');
    const normalizedSeverity = normalizeOptionalEnum(severity, SEVERITY_OPTIONS, '');

    if (normalizedType) where.type = normalizedType;
    if (normalizedTone) where.tone = normalizedTone;
    if (normalizedImpact) where.impactArea = normalizedImpact;
    if (normalizedTheme) where.theme = normalizedTheme;
    if (normalizedSeverity) where.severity = normalizedSeverity;

    if (fromDate || toDate) {
      where.incidentDate = {};
      if (fromDate) where.incidentDate[Op.gte] = safeISODateOnly(fromDate);
      if (toDate) where.incidentDate[Op.lte] = safeISODateOnly(toDate);
    }

    if (mine === '1') {
      where.submitterId = viewer.id;
    }

    const staffOptions = await loadStaffOptionsForViewer(viewer);

    if (staffId) {
      const requested = String(staffId);
      const allowed = staffOptions.some((s) => String(s.id) === requested);
      where.staffId = allowed ? Number(staffId) : -1;
    }

    const visibility = await buildIncidentVisibilityWhere(viewer);

    const finalWhere = {
      [Op.and]: [
        visibility.where || {},
        where,
        q && String(q).trim()
          ? {
              [Op.or]: [
                { title: { [Op.like]: `%${String(q).trim()}%` } },
                { details: { [Op.like]: `%${String(q).trim()}%` } },
                { followUpOutcome: { [Op.like]: `%${String(q).trim()}%` } },
              ],
            }
          : {},
      ],
    };

    const incidents = await Incident.findAll({
      where: finalWhere,
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
        { model: User, as: 'Submitter' },
      ],
      order: [
        ['incidentDate', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    let filteredIncidents = incidents;

    if (followUp === 'open') {
      filteredIncidents = incidents.filter((inc) => {
        const s = normalizeUpper(inc.followUpStatus || '');
        return inc.requiresFollowUp && (s === 'OPEN' || s === 'IN_PROGRESS');
      });
    } else if (followUp === 'overdue') {
      filteredIncidents = incidents.filter((inc) => {
        const health = computeFollowUpHealth(inc);
        return !!health.overdue;
      });
    }

    const RECOGNITION_TONES = new Set([
      'RECOGNITION',
      'ACHIEVEMENT',
      'ENCOURAGEMENT',
      'PROFESSIONAL_COMMENDATION',
    ]);

    const IMPROVEMENT_TONES = new Set([
      'NEEDS_IMPROVEMENT',
      'GUIDANCE',
      'REDIRECTION',
      'ACCOUNTABILITY_REMINDER',
      'PERFORMANCE_CONCERN',
      'POLICY_VIOLATION',
      'CONDUCT_CONCERN',
      'ESCALATED_DOCUMENTATION',
    ]);

    const NEUTRAL_INFO_TONES = new Set([
      'NEUTRAL_RECORD',
      'ATTENDANCE_NOTE',
      'OPERATIONAL_NOTE',
      'ADMINISTRATIVE_UPDATE',
    ]);

    const stats = {
      totalEvents: filteredIncidents.length,
      positiveCount: 0,
      coachingCount: 0,
      formalCount: 0,
      infoCount: 0,

      recognitionCount: 0,
      needsImprovementCount: 0,
      neutralCount: 0,

      openFollowUps: 0,
      overdueFollowUps: 0,

      lowSeverityCount: 0,
      mediumSeverityCount: 0,
      highSeverityCount: 0,
    };

    filteredIncidents.forEach((inc) => {
      const typeValue = normalizeUpper(inc.type || '');
      const toneValue = normalizeUpper(inc.tone || '');
      const severityValue = normalizeUpper(inc.severity || '');
      const health = computeFollowUpHealth(inc);

      if (typeValue === 'POSITIVE') stats.positiveCount++;
      else if (typeValue === 'COACHING') stats.coachingCount++;
      else if (typeValue === 'FORMAL') stats.formalCount++;
      else if (typeValue === 'INFO') stats.infoCount++;

      if (RECOGNITION_TONES.has(toneValue)) {
        stats.recognitionCount++;
      } else if (IMPROVEMENT_TONES.has(toneValue)) {
        stats.needsImprovementCount++;
      } else if (NEUTRAL_INFO_TONES.has(toneValue)) {
        stats.neutralCount++;
      }

      if (severityValue === 'LOW') stats.lowSeverityCount++;
      else if (severityValue === 'MEDIUM') stats.mediumSeverityCount++;
      else if (severityValue === 'HIGH') stats.highSeverityCount++;

      if (inc.requiresFollowUp) {
        const statusValue = normalizeUpper(inc.followUpStatus || '');
        if (statusValue === 'OPEN' || statusValue === 'IN_PROGRESS') {
          stats.openFollowUps++;
        }
        if (health.overdue) {
          stats.overdueFollowUps++;
        }
      }
    });

    const filters = {
      staffId: staffId || '',
      q: q || '',
      type: normalizedType || '',
      tone: normalizedTone || '',
      impactArea: normalizedImpact || '',
      theme: normalizedTheme || '',
      severity: normalizedSeverity || '',
      followUp: followUp || '',
      mine: mine || '',
      fromDate: fromDate || '',
      toDate: toDate || '',
    };

    const filterSummary = buildFilterSummary(filters, staffOptions);

    res.render('incidents/index', {
      incidents: filteredIncidents.map((inc) => ({
        inc,
        followUpHealth: computeFollowUpHealth(inc),
      })),
      staffOptions,
      filters,
      filterSummary,
      stats,
      viewerRole: viewer.role,
    });
  } catch (err) {
    console.error('INCIDENTS LIST ERROR:', err);
    return res.status(500).send('Error loading incidents.');
  }
});

/* ─────────────────────────────────────────────────────────────
 * GET /incidents/new
 * ───────────────────────────────────────────────────────────── */

router.get('/new', ensureRole(INCIDENT_FORM_ROLES), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const staffOptions = await loadStaffOptionsForViewer(viewer);

    return renderIncidentForm(res, viewer, 'incidents/new', {
      staffOptions,
      incident: buildIncidentFormDefaults(),
      error: null,
      returnTo: buildReturnTo(req.query.returnTo),
    });
  } catch (err) {
    console.error('INCIDENT NEW FORM ERROR:', err);
    return res.status(500).send('Error loading incident form.');
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /incidents
 * ───────────────────────────────────────────────────────────── */

router.post('/', ensureRole(INCIDENT_FORM_ROLES), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const returnTo = buildReturnTo(req.body.returnTo);
    const staffOptions = await loadStaffOptionsForViewer(viewer);
    const payload = normalizeIncidentPayload(req.body);
    const errors = validateIncidentPayload(payload);

    if (errors.length) {
      return renderIncidentForm(res.status(400), viewer, 'incidents/new', {
        staffOptions,
        incident: payload,
        error: errors.join('\n'),
        returnTo,
      });
    }

    const staff = await User.findByPk(payload.staffId, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });

    if (!staff) {
      return renderIncidentForm(res.status(400), viewer, 'incidents/new', {
        staffOptions,
        incident: payload,
        error: 'Selected staff member was not found.',
        returnTo,
      });
    }

    if (!canViewerAccessStaff(viewer, staff)) {
      return renderIncidentForm(res.status(403), viewer, 'incidents/new', {
        staffOptions,
        incident: payload,
        error: 'You do not have access to log an incident for this staff member.',
        returnTo,
      });
    }

    const newIncident = await Incident.create({
      staffId: payload.staffId,
      submitterId: viewer.id,
      incidentDate: payload.incidentDate,
      title: payload.title,
      details: payload.details || null,
      type: payload.type,
      tone: payload.tone,
      impactArea: payload.impactArea,
      theme: payload.theme,
      severity: payload.severity,
      requiresFollowUp: payload.requiresFollowUp,
      followUpStatus: payload.followUpStatus,
      followUpDueDate: payload.followUpDueDate,
      followUpOutcome: payload.followUpOutcome,
    });

    await createAuditLog({
      req,
      actorUser: viewer,
      actionType: 'CREATE',
      entityType: 'INCIDENT',
      entityId: newIncident.id,
      targetName: staff.name || null,
      summary: `Incident logged for ${staff.name}: "${payload.title}"`,
      details: { type: payload.type, tone: payload.tone, severity: payload.severity, incidentDate: payload.incidentDate },
    });

    return res.redirect(`/staff/${newIncident.staffId}`);
  } catch (err) {
    console.error('INCIDENT CREATE ERROR:', err);
    return res.status(500).send('Error creating incident.');
  }
});

/* ─────────────────────────────────────────────────────────────
 * GET /incidents/:id/edit
 * ───────────────────────────────────────────────────────────── */

router.get('/:id/edit', ensureRole(INCIDENT_FORM_ROLES), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const id = Number(req.params.id);
    const incident = await Incident.findByPk(id, {
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
        { model: User, as: 'Submitter' },
      ],
    });

    if (!incident) return res.status(404).send('Incident not found.');

    const allowed = await canViewerEditIncident(viewer, incident);
    if (!allowed) {
      return res.status(403).send('You do not have access to edit this incident.');
    }

    const staffOptions = await loadStaffOptionsForViewer(viewer);

    return renderIncidentForm(res, viewer, 'incidents/edit', {
      staffOptions,
      incident: {
        id: incident.id,
        staffId: incident.staffId,
        incidentDate: safeISODateOnly(incident.incidentDate),
        title: incident.title || '',
        details: incident.details || '',
        type: incident.type || 'COACHING',
        tone: incident.tone || 'NEEDS_IMPROVEMENT',
        impactArea: incident.impactArea || '',
        theme: incident.theme || '',
        severity: incident.severity || 'LOW',
        requiresFollowUp: !!incident.requiresFollowUp,
        followUpStatus: incident.followUpStatus || 'NO_ACTION',
        followUpDueDate: safeISODateOnly(incident.followUpDueDate),
        followUpOutcome: incident.followUpOutcome || '',
      },
      error: null,
      returnTo: buildReturnTo(req.query.returnTo),
    });
  } catch (err) {
    console.error('INCIDENT EDIT FORM ERROR:', err);
    return res.status(500).send('Error loading incident edit form.');
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /incidents/:id/update
 * ───────────────────────────────────────────────────────────── */

router.post('/:id/update', ensureRole(INCIDENT_FORM_ROLES), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const id = Number(req.params.id);
    const incident = await Incident.findByPk(id, {
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
      ],
    });

    if (!incident) return res.status(404).send('Incident not found.');

    const allowed = await canViewerEditIncident(viewer, incident);
    if (!allowed) {
      return res.status(403).send('You do not have access to update this incident.');
    }

    const returnTo = buildReturnTo(req.body.returnTo);
    const staffOptions = await loadStaffOptionsForViewer(viewer);
    const payload = normalizeIncidentPayload(req.body);
    const errors = validateIncidentPayload(payload);

    if (errors.length) {
      return renderIncidentForm(res.status(400), viewer, 'incidents/edit', {
        staffOptions,
        incident: { ...payload, id: incident.id },
        error: errors.join('\n'),
        returnTo,
      });
    }

    const staff = await User.findByPk(payload.staffId, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });

    if (!staff) {
      return renderIncidentForm(res.status(400), viewer, 'incidents/edit', {
        staffOptions,
        incident: { ...payload, id: incident.id },
        error: 'Selected staff member was not found.',
        returnTo,
      });
    }

    if (!canViewerAccessStaff(viewer, staff)) {
      return renderIncidentForm(res.status(403), viewer, 'incidents/edit', {
        staffOptions,
        incident: { ...payload, id: incident.id },
        error: 'You do not have access to update this incident for that staff member.',
        returnTo,
      });
    }

    await incident.update({
      staffId: payload.staffId,
      incidentDate: payload.incidentDate,
      title: payload.title,
      details: payload.details || null,
      type: payload.type,
      tone: payload.tone,
      impactArea: payload.impactArea,
      theme: payload.theme,
      severity: payload.severity,
      requiresFollowUp: payload.requiresFollowUp,
      followUpStatus: payload.followUpStatus,
      followUpDueDate: payload.followUpDueDate,
      followUpOutcome: payload.followUpOutcome,
    });

    await createAuditLog({
      req,
      actorUser: viewer,
      actionType: 'UPDATE',
      entityType: 'INCIDENT',
      entityId: incident.id,
      targetName: incident.Staff?.name || null,
      summary: `Incident updated: "${payload.title}"`,
      details: { type: payload.type, tone: payload.tone, severity: payload.severity, followUpStatus: payload.followUpStatus },
    });

    return res.redirect(`/staff/${incident.staffId}`);
  } catch (err) {
    console.error('INCIDENT UPDATE ERROR:', err);
    return res.status(500).send('Error updating incident.');
  }
});

/* ─────────────────────────────────────────────────────────────
 * POST /incidents/:id/delete
 * ───────────────────────────────────────────────────────────── */

router.post('/:id/delete', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']), async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const id = Number(req.params.id);
    const incident = await Incident.findByPk(id, {
      include: [
        {
          model: User,
          as: 'Staff',
          include: [{ model: StaffProfile, as: 'StaffProfile' }],
        },
      ],
    });

    if (!incident) return res.status(404).send('Incident not found.');

    const allowed = await canViewerDeleteIncident(viewer, incident);
    if (!allowed) {
      return res.status(403).send('You do not have access to delete this incident.');
    }

    const staffId = incident.staffId;
    const incidentTitle = incident.title;
    const staffName = incident.Staff?.name || null;
    await incident.destroy();

    await createAuditLog({
      req,
      actorUser: viewer,
      actionType: 'DELETE',
      entityType: 'INCIDENT',
      entityId: id,
      targetName: staffName,
      summary: `Incident deleted: "${incidentTitle}" (staff: ${staffName})`,
    });

    return res.redirect(`/staff/${staffId}`);
  } catch (err) {
    console.error('INCIDENT DELETE ERROR:', err);
    return res.status(500).send('Error deleting incident.');
  }
});

export default router;