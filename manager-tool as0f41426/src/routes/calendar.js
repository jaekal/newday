// src/routes/calendar.js
import express from 'express';
import { Op } from 'sequelize';
import {
  User,
  StaffProfile,
  Meeting,
  Goal,
  Incident,
  ReviewAssignment,
  MonthlyReview,
  Training,
  ManagerScope,
} from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

function getMonthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

function toDateKey(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (e) {
    return '';
  }
}

function safeText(v) {
  return String(v || '').trim();
}

function normalizeUpper(v) {
  return safeText(v).toUpperCase();
}

function safeDate(value) {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch (e) {
    return null;
  }
}

function sameBuildingShift(profileA, profileB) {
  const ab = safeText(profileA?.building);
  const as = safeText(profileA?.shift);
  const bb = safeText(profileB?.building);
  const bs = safeText(profileB?.shift);

  if (ab && bb && ab !== bb) return false;
  if (as && bs && as !== bs) return false;
  return true;
}

async function getViewer(req) {
  if (!req.session?.userId) return null;
  return User.findByPk(req.session.userId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
}

async function getLeadAssignedStaffIds(viewer) {
  if (!viewer || viewer.role !== 'LEAD') return new Set();

  const rows = await ReviewAssignment.findAll({
    where: {
      reviewerId: viewer.id,
      active: true,
    },
    attributes: ['staffId'],
  });

  return new Set(rows.map((r) => Number(r.staffId)).filter(Number.isFinite));
}

async function getManagerScopes(viewer) {
  if (!viewer || viewer.role !== 'MANAGER') return [];
  try {
    const rows = await ManagerScope.findAll({
      where: { userId: viewer.id },
    });
    return rows.map((r) => r.get({ plain: true }));
  } catch (err) {
    console.warn('ManagerScope lookup skipped or unavailable:', err.message);
    return [];
  }
}

function isWithinManagerScopes(staffUser, managerScopes = [], viewerProfile = null) {
  if (!staffUser) return false;
  const sp = staffUser.StaffProfile || null;
  if (!sp) return false;

  if (managerScopes.length === 0) {
    return sameBuildingShift(viewerProfile || {}, sp);
  }

  const sb = safeText(sp.building);
  const ss = safeText(sp.shift);

  return managerScopes.some((scope) => {
    const mb = safeText(scope.building);
    const ms = safeText(scope.shift);

    if (mb && sb && mb !== sb) return false;
    if (ms && ss && ms !== ss) return false;
    return true;
  });
}

function canLeadSeeStaff(viewer, staffUser, assignedIds) {
  if (!viewer || !staffUser) return false;
  if (viewer.id === staffUser.id) return true;
  return assignedIds.has(Number(staffUser.id));
}

function canSupervisorSeeStaff(viewer, staffUser) {
  if (!viewer || !staffUser) return false;
  const vp = viewer.StaffProfile || null;
  const sp = staffUser.StaffProfile || null;
  if (!vp || !sp) return false;
  return sameBuildingShift(vp, sp);
}

function canManagerSeeStaff(viewer, staffUser, managerScopes) {
  const vp = viewer?.StaffProfile || null;
  return isWithinManagerScopes(staffUser, managerScopes, vp);
}

function canViewerSeeStaff(viewer, staffUser, assignedIds, managerScopes) {
  if (!viewer || !staffUser) return false;
  if (viewer.role === 'ADMIN') return true;
  if (viewer.role === 'LEAD') return canLeadSeeStaff(viewer, staffUser, assignedIds);
  if (viewer.role === 'SUPERVISOR') return canSupervisorSeeStaff(viewer, staffUser);
  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') return canManagerSeeStaff(viewer, staffUser, managerScopes);
  return false;
}

function canViewerSeeMeeting(viewer, meeting, assignedIds, managerScopes) {
  if (!viewer || !meeting) return false;
  if (viewer.role === 'ADMIN') return true;

  const staff = meeting.Staff || null;
  const organizer = meeting.Organizer || null;

  if (viewer.role === 'LEAD') {
    if (meeting.organizerId === viewer.id) return true;
    if (staff && assignedIds.has(Number(staff.id))) return true;
    return false;
  }

  if (viewer.role === 'SUPERVISOR') {
    if (staff && canSupervisorSeeStaff(viewer, staff)) return true;
    if (organizer && canSupervisorSeeStaff(viewer, organizer)) return true;
    return false;
  }

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    if (staff && canManagerSeeStaff(viewer, staff, managerScopes)) return true;
    if (organizer && canManagerSeeStaff(viewer, organizer, managerScopes)) return true;
    return false;
  }

  return false;
}

function canViewerSeeGoal(viewer, goal, assignedIds, managerScopes) {
  if (!viewer || !goal) return false;
  if (viewer.role === 'ADMIN') return true;

  const owner = goal.Owner || null;

  if (viewer.role === 'LEAD') {
    if (goal.ownerId === viewer.id) return true;
    if (owner && assignedIds.has(Number(owner.id))) return true;
    return false;
  }

  if (viewer.role === 'SUPERVISOR') {
    return owner ? canSupervisorSeeStaff(viewer, owner) : false;
  }

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    return owner ? canManagerSeeStaff(viewer, owner, managerScopes) : false;
  }

  return false;
}

function canViewerSeeIncident(viewer, incident, assignedIds, managerScopes) {
  if (!viewer || !incident) return false;
  if (viewer.role === 'ADMIN') return true;

  const staff = incident.Staff || null;
  const submitter = incident.Submitter || null;

  if (viewer.role === 'LEAD') {
    if (incident.submitterId === viewer.id) return true;
    if (staff && assignedIds.has(Number(staff.id))) return true;
    return false;
  }

  if (viewer.role === 'SUPERVISOR') {
    if (staff && canSupervisorSeeStaff(viewer, staff)) return true;
    if (submitter && canSupervisorSeeStaff(viewer, submitter)) return true;
    return false;
  }

  if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
    if (staff && canManagerSeeStaff(viewer, staff, managerScopes)) return true;
    if (submitter && canManagerSeeStaff(viewer, submitter, managerScopes)) return true;
    return false;
  }

  return false;
}

function buildCalendarMatrix(year, month, eventsByDateKey) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();
  const startWeekday = firstDay.getDay();

  const cells = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push({ inMonth: false });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day);
    const key = toDateKey(date);
    const dayEvents = eventsByDateKey[key] || [];

    cells.push({
      inMonth: true,
      day,
      key,
      count: dayEvents.length,
      birthdayCount: dayEvents.filter((e) => e.type === 'BIRTHDAY').length,
      oneOnOneCount: dayEvents.filter((e) => e.type === 'ONE_ON_ONE').length,
      dueCount: dayEvents.filter((e) => ['GOAL', 'INCIDENT', 'REVIEW', 'TRAINING'].includes(e.source)).length,
      events: dayEvents,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ inMonth: false });
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return weeks;
}

function makeIcsDate(value) {
  const d = safeDate(value);
  if (!d) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function escapeIcsText(v) {
  return String(v || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Training extractor helpers
 * Adjust here if your Training model uses different field names.
 */
function extractTrainingDate(training) {
  const candidates = [
    training?.dueDate,
    training?.expirationDate,
    training?.expiresAt,
    training?.expiryDate,
    training?.completionDueDate,
    training?.validUntil,
  ];

  for (const c of candidates) {
    const d = safeDate(c);
    if (d) return d;
  }
  return null;
}

function extractTrainingUserId(training) {
  const candidates = [
    training?.staffId,
    training?.userId,
    training?.employeeId,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractTrainingTitle(training) {
  return (
    safeText(training?.title) ||
    safeText(training?.name) ||
    safeText(training?.courseName) ||
    safeText(training?.trainingName) ||
    'Training Item'
  );
}

function extractTrainingStatus(training) {
  return normalizeUpper(
    training?.status ||
    training?.completionStatus ||
    training?.recordStatus
  );
}

async function loadScopedCalendarData(req) {
  const viewer = await getViewer(req);
  if (!viewer) return { viewer: null };

  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year = Number(req.query.year) || now.getFullYear();

  const selectedDay = safeText(req.query.day);
  const filterType = normalizeUpper(req.query.type);
  const filterShift = safeText(req.query.shift);
  const filterBuilding = safeText(req.query.building);
  const filterSource = normalizeUpper(req.query.source);
  const warningsOnly = req.query.warnings === '1';

  const { start, end } = getMonthRange(year, month);

  const [assignedIds, managerScopes] = await Promise.all([
    getLeadAssignedStaffIds(viewer),
    getManagerScopes(viewer),
  ]);

  // Scoped staff
  const staffUsers = await User.findAll({
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const scopedUsers = staffUsers.filter((u) =>
    canViewerSeeStaff(viewer, u, assignedIds, managerScopes)
  );

  const scopedUserById = new Map(scopedUsers.map((u) => [Number(u.id), u]));

  // Birthdays
  const birthdayEvents = scopedUsers
    .filter((u) => u.StaffProfile?.dateOfBirth)
    .filter((u) => {
      const dob = new Date(u.StaffProfile.dateOfBirth);
      return !Number.isNaN(dob.getTime()) && (dob.getMonth() + 1) === month;
    })
    .map((u) => {
      const dob = new Date(u.StaffProfile.dateOfBirth);
      const eventDate = new Date(year, month - 1, dob.getDate());

      return {
        id: `birthday-${u.id}-${month}-${year}`,
        date: eventDate,
        dateKey: toDateKey(eventDate),
        type: 'BIRTHDAY',
        source: 'STAFF_PROFILE',
        label: `Birthday – ${u.name}`,
        staffName: u.name,
        organizerName: '',
        building: safeText(u.StaffProfile?.building),
        shift: safeText(u.StaffProfile?.shift),
        notes: '',
        severity: '',
        warning: false,
      };
    });

  // Meetings
  const meetings = await Meeting.findAll({
    where: {
      startAt: { [Op.gte]: start, [Op.lt]: end },
    },
    include: [
      {
        model: User,
        as: 'Staff',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
      {
        model: User,
        as: 'Organizer',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
    ],
    order: [['startAt', 'ASC']],
  });

  const meetingEvents = meetings
    .filter((m) => canViewerSeeMeeting(viewer, m, assignedIds, managerScopes))
    .map((m) => {
      const staffProfile = m.Staff?.StaffProfile || null;
      const organizerProfile = m.Organizer?.StaffProfile || null;

      return {
        id: `meeting-${m.id}`,
        date: m.startAt,
        dateKey: toDateKey(m.startAt),
        type: normalizeUpper(m.type || 'OTHER'),
        source: 'MEETING',
        label:
          m.type === 'ONE_ON_ONE'
            ? `1:1 – ${m.Staff ? m.Staff.name : 'N/A'} with ${m.Organizer ? m.Organizer.name : 'N/A'}`
            : `${m.title || 'Meeting'} – ${m.Staff ? m.Staff.name : 'N/A'}`,
        staffName: m.Staff ? m.Staff.name : 'N/A',
        organizerName: m.Organizer ? m.Organizer.name : 'N/A',
        building: safeText(staffProfile?.building || organizerProfile?.building),
        shift: safeText(staffProfile?.shift || organizerProfile?.shift),
        notes: safeText(m.notes),
        severity: '',
        warning: false,
      };
    });

  // Goals due this month
  const goals = await Goal.findAll({
    where: {
      dueDate: { [Op.gte]: toDateKey(start), [Op.lt]: toDateKey(end) },
    },
    include: [
      {
        model: User,
        as: 'Owner',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
    ],
    order: [['dueDate', 'ASC']],
  });

  const goalEvents = goals
    .filter((g) => canViewerSeeGoal(viewer, g, assignedIds, managerScopes))
    .map((g) => {
      const dueDate = safeDate(g.dueDate);
      const ownerProfile = g.Owner?.StaffProfile || null;
      const statusUpper = normalizeUpper(g.status);
      const isWarning = statusUpper !== 'DONE' && statusUpper !== 'ON_HOLD';

      return {
        id: `goal-${g.id}`,
        date: dueDate,
        dateKey: toDateKey(dueDate),
        type: 'GOAL_DUE',
        source: 'GOAL',
        label: `Goal Due – ${g.title || 'Untitled Goal'}`,
        staffName: g.Owner ? g.Owner.name : 'N/A',
        organizerName: '',
        building: safeText(ownerProfile?.building),
        shift: safeText(ownerProfile?.shift),
        notes: safeText(g.description),
        severity: safeText(g.priority),
        warning: isWarning,
      };
    });

  // Incident follow-ups due this month
  const incidents = await Incident.findAll({
    where: {
      requiresFollowUp: true,
      followUpDueDate: { [Op.gte]: toDateKey(start), [Op.lt]: toDateKey(end) },
    },
    include: [
      {
        model: User,
        as: 'Staff',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
      {
        model: User,
        as: 'Submitter',
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      },
    ],
    order: [['followUpDueDate', 'ASC']],
  });

  const incidentEvents = incidents
    .filter((inc) => canViewerSeeIncident(viewer, inc, assignedIds, managerScopes))
    .map((inc) => {
      const due = safeDate(inc.followUpDueDate);
      const staffProfile = inc.Staff?.StaffProfile || inc.Submitter?.StaffProfile || null;
      const followUpStatus = normalizeUpper(inc.followUpStatus);
      const isOpen = followUpStatus !== 'CLOSED' && followUpStatus !== 'COMPLETE';

      return {
        id: `incident-${inc.id}`,
        date: due,
        dateKey: toDateKey(due),
        type: 'FOLLOW_UP',
        source: 'INCIDENT',
        label: `Incident Follow-up – ${inc.title || 'Untitled Incident'}`,
        staffName: inc.Staff ? inc.Staff.name : 'N/A',
        organizerName: inc.Submitter ? inc.Submitter.name : '',
        building: safeText(staffProfile?.building),
        shift: safeText(staffProfile?.shift),
        notes: safeText(inc.followUpOutcome || inc.details),
        severity: safeText(inc.severity),
        warning: isOpen,
      };
    });

  // Review due events
  const assignments = await ReviewAssignment.findAll({
    where: {
      active: true,
    },
  });

  const currentMonthReviews = await MonthlyReview.findAll({
    where: {
      periodMonth: month,
      periodYear: year,
    },
  });

  const reviewKeySet = new Set(
    currentMonthReviews.map((r) => `${Number(r.staffId)}::${Number(r.submitterId)}`)
  );

  const reviewDueDate = new Date(year, month - 1, 28);

  const reviewEvents = assignments
    .filter((a) => {
      const staffUser = scopedUserById.get(Number(a.staffId));
      if (!staffUser) return false;

      if (viewer.role === 'LEAD') {
        return Number(a.reviewerId) === Number(viewer.id);
      }

      if (viewer.role === 'SUPERVISOR') {
        return canSupervisorSeeStaff(viewer, staffUser);
      }

      if (viewer.role === 'MANAGER' || viewer.role === 'SENIOR_MANAGER') {
        return canManagerSeeStaff(viewer, staffUser, managerScopes);
      }

      return viewer.role === 'ADMIN';
    })
    .filter((a) => !reviewKeySet.has(`${Number(a.staffId)}::${Number(a.reviewerId)}`))
    .map((a) => {
      const staffUser = scopedUserById.get(Number(a.staffId));
      const profile = staffUser?.StaffProfile || null;

      return {
        id: `review-due-${a.id}`,
        date: reviewDueDate,
        dateKey: toDateKey(reviewDueDate),
        type: 'REVIEW_DUE',
        source: 'REVIEW',
        label: `Monthly Review Due – ${staffUser ? staffUser.name : 'Unknown Staff'}`,
        staffName: staffUser ? staffUser.name : 'Unknown Staff',
        organizerName: '',
        building: safeText(profile?.building),
        shift: safeText(profile?.shift),
        notes: `No monthly review found yet for ${month}/${year}.`,
        severity: 'OPEN',
        warning: true,
      };
    });

  // Training due / expiration events
  let trainingEvents = [];
  try {
    const trainings = await Training.findAll({
      order: [['createdAt', 'DESC']],
    });

    trainingEvents = trainings
      .map((t) => t.get({ plain: true }))
      .map((t) => {
        const userId = extractTrainingUserId(t);
        const due = extractTrainingDate(t);
        const statusUpper = extractTrainingStatus(t);
        const staffUser = scopedUserById.get(Number(userId)) || null;

        return {
          raw: t,
          userId,
          due,
          staffUser,
          statusUpper,
        };
      })
      .filter((t) => t.staffUser && t.due)
      .filter((t) => t.due >= start && t.due < end)
      .filter((t) => canViewerSeeStaff(viewer, t.staffUser, assignedIds, managerScopes))
      .map((t) => {
        const profile = t.staffUser?.StaffProfile || null;
        const isComplete =
          t.statusUpper === 'COMPLETE' ||
          t.statusUpper === 'COMPLETED' ||
          t.statusUpper === 'DONE';

        return {
          id: `training-${t.raw.id}`,
          date: t.due,
          dateKey: toDateKey(t.due),
          type: 'TRAINING_DUE',
          source: 'TRAINING',
          label: `Training Due – ${extractTrainingTitle(t.raw)}`,
          staffName: t.staffUser ? t.staffUser.name : 'Unknown Staff',
          organizerName: '',
          building: safeText(profile?.building),
          shift: safeText(profile?.shift),
          notes: safeText(t.raw.notes || t.raw.description),
          severity: safeText(t.raw.priority || t.raw.level || ''),
          warning: !isComplete,
        };
      });
  } catch (err) {
    console.warn('Training events skipped:', err.message);
  }

  let events = [
    ...birthdayEvents,
    ...meetingEvents,
    ...goalEvents,
    ...incidentEvents,
    ...reviewEvents,
    ...trainingEvents,
  ];

  if (filterType) {
    events = events.filter((e) => normalizeUpper(e.type) === filterType);
  }

  if (filterShift) {
    events = events.filter((e) => safeText(e.shift) === filterShift);
  }

  if (filterBuilding) {
    events = events.filter((e) => safeText(e.building) === filterBuilding);
  }

  if (filterSource) {
    events = events.filter((e) => normalizeUpper(e.source) === filterSource);
  }

  if (warningsOnly) {
    events = events.filter((e) => !!e.warning);
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  const eventsByDateKey = {};
  events.forEach((e) => {
    if (!eventsByDateKey[e.dateKey]) eventsByDateKey[e.dateKey] = [];
    eventsByDateKey[e.dateKey].push(e);
  });

  const calendarWeeks = buildCalendarMatrix(year, month, eventsByDateKey);
  const listEvents = selectedDay
    ? events.filter((e) => e.dateKey === selectedDay)
    : events;

  const buildingCounts = {};
  const shiftCounts = {};

  events.forEach((e) => {
    const b = safeText(e.building) || 'Unassigned';
    const s = safeText(e.shift) || 'Unassigned';
    buildingCounts[b] = (buildingCounts[b] || 0) + 1;
    shiftCounts[s] = (shiftCounts[s] || 0) + 1;
  });

  const filterOptions = {
    buildings: Array.from(new Set(events.map((e) => safeText(e.building)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    shifts: Array.from(new Set(events.map((e) => safeText(e.shift)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    types: Array.from(new Set(events.map((e) => normalizeUpper(e.type)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    sources: Array.from(new Set(events.map((e) => normalizeUpper(e.source)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
  };

  const stats = {
    total: events.length,
    birthdays: events.filter((e) => e.type === 'BIRTHDAY').length,
    oneOnOnes: events.filter((e) => e.type === 'ONE_ON_ONE').length,
    goalDue: events.filter((e) => e.source === 'GOAL').length,
    incidentFollowUps: events.filter((e) => e.source === 'INCIDENT').length,
    reviewDue: events.filter((e) => e.source === 'REVIEW').length,
    trainingDue: events.filter((e) => e.source === 'TRAINING').length,
    selectedDayCount: selectedDay ? listEvents.length : null,
    uniquePeople: new Set(events.map((e) => e.staffName).filter(Boolean)).size,
    warnings: events.filter((e) => e.warning).length,
  };

  const selectedDayMetrics = selectedDay
    ? {
        total: listEvents.length,
        birthdays: listEvents.filter((e) => e.type === 'BIRTHDAY').length,
        oneOnOnes: listEvents.filter((e) => e.type === 'ONE_ON_ONE').length,
        dueItems: listEvents.filter((e) => ['GOAL', 'INCIDENT', 'REVIEW', 'TRAINING'].includes(e.source)).length,
        buildings: Array.from(new Set(listEvents.map((e) => safeText(e.building)).filter(Boolean))).length,
        shifts: Array.from(new Set(listEvents.map((e) => safeText(e.shift)).filter(Boolean))).length,
      }
    : null;

  // Stale 1:1 warnings
  const scopedStaffIds = new Set(
    scopedUsers
      .filter((u) => normalizeUpper(u.role) === 'STAFF')
      .map((u) => Number(u.id))
      .filter(Number.isFinite)
  );

  const historicalMeetings = await Meeting.findAll({
    where: {
      type: 'ONE_ON_ONE',
      startAt: { [Op.lt]: end },
      staffId: { [Op.in]: Array.from(scopedStaffIds) },
    },
    include: [
      { model: User, as: 'Staff', include: [{ model: StaffProfile, as: 'StaffProfile' }] },
      { model: User, as: 'Organizer' },
    ],
    order: [['startAt', 'DESC']],
  });

  const latestMeetingByStaffId = {};
  historicalMeetings.forEach((m) => {
    const sid = Number(m.staffId);
    if (!latestMeetingByStaffId[sid]) latestMeetingByStaffId[sid] = m;
  });

  const staleWarnings = scopedUsers
    .filter((u) => normalizeUpper(u.role) === 'STAFF')
    .map((u) => {
      const latest = latestMeetingByStaffId[Number(u.id)] || null;
      const latestDate = latest ? safeDate(latest.startAt) : null;
      let daysSince = null;

      if (latestDate) {
        const diffMs = Date.now() - latestDate.getTime();
        daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      }

      return {
        userId: u.id,
        name: u.name,
        building: safeText(u.StaffProfile?.building),
        shift: safeText(u.StaffProfile?.shift),
        latestMeetingAt: latestDate,
        latestOrganizerName: latest?.Organizer?.name || '',
        daysSince,
        isStale: latestDate ? daysSince > 30 : true,
      };
    })
    .filter((x) => x.isStale)
    .sort((a, b) => {
      if (a.daysSince == null && b.daysSince == null) return a.name.localeCompare(b.name);
      if (a.daysSince == null) return -1;
      if (b.daysSince == null) return 1;
      return b.daysSince - a.daysSince;
    });

  return {
    viewer,
    month,
    year,
    selectedDay,
    filterType,
    filterShift,
    filterBuilding,
    filterSource,
    warningsOnly,
    filterOptions,
    stats,
    selectedDayMetrics,
    events,
    listEvents,
    calendarWeeks,
    buildingCounts,
    shiftCounts,
    viewerRole: viewer.role,
    staleWarnings,
  };
}

router.get('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const data = await loadScopedCalendarData(req);
  if (!data.viewer) return res.redirect('/login');
  return res.render('calendar', data);
});

router.get('/export.ics', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const data = await loadScopedCalendarData(req);
  if (!data.viewer) return res.redirect('/login');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Performance Tool//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
  ];

  data.events.forEach((e, idx) => {
    const start = safeDate(e.date);
    if (!start) return;

    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const uid = `${e.id || idx}@performance-tool`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${makeIcsDate(new Date())}`);
    lines.push(`DTSTART:${makeIcsDate(start)}`);
    lines.push(`DTEND:${makeIcsDate(end)}`);
    lines.push(`SUMMARY:${escapeIcsText(e.label)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(
      [
        `Type: ${e.type}`,
        e.staffName ? `Staff: ${e.staffName}` : '',
        e.organizerName ? `Organizer: ${e.organizerName}` : '',
        e.building ? `Building: ${e.building}` : '',
        e.shift ? `Shift: ${e.shift}` : '',
        e.notes ? `Notes: ${e.notes}` : '',
      ].filter(Boolean).join('\n')
    )}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="calendar-${data.year}-${String(data.month).padStart(2, '0')}.ics"`
  );
  return res.send(lines.join('\r\n'));
});

// ─────────────────────────────────────────────
// GET /calendar/certifications
// Show upcoming and expired certifications
// ─────────────────────────────────────────────
router.get('/certifications', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const viewer = await getViewer(req);
  if (!viewer) return res.redirect('/login');
  // Parse certificationFrequency string → months
  function freqToMonths(freq) {
    if (!freq) return null;
    const f = String(freq).toLowerCase().trim();
    if (f.includes('annual') || f === '1 year' || f === '12 month') return 12;
    if (f.includes('2 year') || f.includes('24 month')) return 24;
    if (f.includes('3 year') || f.includes('36 month')) return 36;
    if (f.includes('6 month')) return 6;
    if (f.includes('month')) {
      const m = f.match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    if (f.includes('year')) {
      const m = f.match(/(\d+)/);
      if (m) return parseInt(m[1], 10) * 12;
    }
    return null;
  }

  const allTraining = await Training.findAll({
    where: { certificationFrequency: { [Op.not]: null } },
    order: [['employeeName', 'ASC']],
  });

  const now = new Date();
  const soon = new Date(now); soon.setDate(now.getDate() + 60);

  const rows = [];
  for (const t of allTraining) {
    if (!t.endDate) continue;
    const months = freqToMonths(t.certificationFrequency);
    if (!months) continue;

    const completed = new Date(t.endDate);
    if (Number.isNaN(completed.getTime())) continue;

    const expiry = new Date(completed);
    expiry.setMonth(expiry.getMonth() + months);

    const daysUntil = Math.round((expiry - now) / 86400000);
    let state = 'ok';
    if (daysUntil < 0) state = 'expired';
    else if (daysUntil <= 60) state = 'expiring';

    rows.push({
      staffId: t.staffId,
      staffName: t.employeeName,
      employeeId: t.employeeId,
      courseName: t.courseName,
      completedDate: t.endDate,
      expiryDate: expiry.toISOString().slice(0, 10),
      daysUntil,
      state,
      certificationFrequency: t.certificationFrequency,
    });
  }

  // Sort: expired first, then expiring soonest, then ok
  rows.sort((a, b) => a.daysUntil - b.daysUntil);

  const expired = rows.filter(r => r.state === 'expired');
  const expiring = rows.filter(r => r.state === 'expiring');
  const current = rows.filter(r => r.state === 'ok');

  res.render('calendar/certifications', {
    expired,
    expiring,
    current,
    currentUserRole: viewer.role,
  });
});

export default router;