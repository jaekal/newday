// src/routes/meetings.js
import express from 'express';
import { Op } from 'sequelize';
import { User, StaffProfile, Meeting, ReviewAssignment } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

async function getViewer(req) {
  if (!req.session?.userId) return null;
  return User.findByPk(req.session.userId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
}

function sameScope(viewer, staffUser) {
  if (!viewer || !staffUser) return false;
  if (viewer.role === 'ADMIN') return true;

  const vp = viewer.StaffProfile || null;
  const sp = staffUser.StaffProfile || null;

  const vb = (vp?.building || '').trim();
  const vs = (vp?.shift || '').trim();

  if (!vb && !vs) return true;
  if (!sp) return false;

  const sb = (sp.building || '').trim();
  const ss = (sp.shift || '').trim();

  if (vb && sb && vb !== sb) return false;
  if (vs && ss && vs !== ss) return false;
  return true;
}

async function leadCanMeetWith(viewerId, staffId) {
  const a = await ReviewAssignment.findOne({
    where: { reviewerId: viewerId, staffId, active: true },
  });
  return !!a;
}

// GET /meetings — redirect to calendar filtered to meetings
router.get('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), (req, res) => {
  const now = new Date();
  return res.redirect(`/calendar?type=ONE_ON_ONE&month=${now.getMonth() + 1}&year=${now.getFullYear()}`);
});

// GET /meetings/list — legacy full list (kept for direct access)
router.get('/list', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const viewer = await getViewer(req);
  if (!viewer) return res.redirect('/login');

  const isAdmin = viewer.role === 'ADMIN' || viewer.role === 'SENIOR_MANAGER';

  const whereClause = isAdmin
    ? {}
    : { organizerId: viewer.id };

  const meetings = await Meeting.findAll({
    where: whereClause,
    include: [
      { model: User, as: 'Staff', attributes: ['id', 'name'], include: [{ model: StaffProfile, as: 'StaffProfile' }] },
      { model: User, as: 'Organizer', attributes: ['id', 'name'] },
    ],
    order: [['startAt', 'DESC']],
    limit: 200,
  });

  res.render('meetings/list', { meetings, currentUser: viewer });
});

// GET /meetings/new
router.get('/new', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const viewer = await getViewer(req);
  if (!viewer) return res.redirect('/login');

  const staffId = req.query.staffId ? Number(req.query.staffId) : null;
  const type = req.query.type || 'ONE_ON_ONE';

  let staff = null;
  if (staffId) staff = await User.findByPk(staffId, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });

  // Permission check (if staff selected)
  if (staff) {
    if (viewer.role === 'LEAD') {
      const ok = await leadCanMeetWith(viewer.id, staff.id);
      if (!ok) return res.status(403).send('You can only schedule 1:1 meetings for staff assigned to you.');
    } else if (viewer.role !== 'ADMIN') {
      if (!sameScope(viewer, staff)) return res.status(403).send('You can only schedule meetings for staff in your scope.');
    }
  }

  // default to tomorrow at 10:00
  const now = new Date();
  const defaultDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0);
  const defaultDateStr = defaultDate.toISOString().slice(0, 10);
  const hours = String(defaultDate.getHours()).padStart(2, '0');
  const mins = String(defaultDate.getMinutes()).padStart(2, '0');
  const defaultTimeStr = `${hours}:${mins}`;

  res.render('meetings/new', {
    currentUser: viewer,
    staff,
    type,
    defaultDateStr,
    defaultTimeStr,
    error: null,
    form: {
      date: defaultDateStr,
      time: defaultTimeStr,
      durationMinutes: '30',
      notes: '',
    },
  });
});

// POST /meetings
router.post('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD']), async (req, res) => {
  const viewer = await getViewer(req);
  if (!viewer) return res.redirect('/login');

  const { staffId, type, date, time, durationMinutes, notes, focus, tone } = req.body;
  const staffIdNum = Number(staffId);

  const staff = await User.findByPk(staffIdNum, { include: [{ model: StaffProfile, as: 'StaffProfile' }] });
  if (!staff) return res.status(400).send('Invalid staff member selected.');

  // Permission check
  if (viewer.role === 'LEAD') {
    const ok = await leadCanMeetWith(viewer.id, staff.id);
    if (!ok) return res.status(403).send('You can only schedule 1:1 meetings for staff assigned to you.');
  } else if (viewer.role !== 'ADMIN') {
    if (!sameScope(viewer, staff)) return res.status(403).send('You can only schedule meetings for staff in your scope.');
  }

  if (!date || !time) {
    return res.status(400).render('meetings/new', {
      currentUser: viewer,
      staff,
      type: type || 'ONE_ON_ONE',
      defaultDateStr: date || '',
      defaultTimeStr: time || '',
      error: 'Date and time are required.',
      form: { date, time, durationMinutes, notes },
    });
  }

  const start = new Date(`${date}T${time}:00`);
  let duration = parseInt(durationMinutes, 10);
  if (!Number.isFinite(duration) || duration <= 0) duration = 30;
  const end = new Date(start.getTime() + duration * 60 * 1000);

  try {
    const VALID_FOCUS = ['performance','coaching','recognition','alignment','concern'];
    const VALID_TONE  = ['supportive','direct','curious','motivating','candid','collaborative'];

    await Meeting.create({
      type: type || 'ONE_ON_ONE',
      staffId: staffIdNum,
      organizerId: viewer.id,
      startAt: start,
      endAt: end,
      notes: notes || null,
      focus: VALID_FOCUS.includes(focus) ? focus : null,
      tone:  VALID_TONE.includes(tone)   ? tone  : null,
    });

    return res.redirect(`/staff/${staffIdNum}`);
  } catch (err) {
    console.error('MEETING CREATE ERROR:', err);
    return res.status(500).render('meetings/new', {
      currentUser: viewer,
      staff,
      type: type || 'ONE_ON_ONE',
      defaultDateStr: date,
      defaultTimeStr: time,
      error: 'Error creating meeting. Please try again.',
      form: { date, time, durationMinutes, notes },
    });
  }
});

export default router;
