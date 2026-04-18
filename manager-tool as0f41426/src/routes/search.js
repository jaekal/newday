// src/routes/search.js
import express from 'express';
import { Op } from 'sequelize';
import { ensureRole } from '../middleware/auth.js';
import { getViewer } from '../services/staff/staffAccessService.js';
import {
  User,
  StaffProfile,
  Goal,
  Incident,
  MonthlyReview,
} from '../models/index.js';

const router = express.Router();

router.get('/', ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR', 'LEAD', 'STAFF']), async (req, res) => {
  const viewer = await getViewer(req);
  if (!viewer) return res.redirect('/login');

  const q = String(req.query.q || '').trim().slice(0, 100);

  if (!q || q.length < 2 || q.length > 100) {
    return res.render('search/results', {
      q,
      results: null,
      currentUserRole: viewer.role,
    });
  }

  const like = { [Op.like]: `%${q}%` };

  const [staffResults, goalResults, incidentResults, reviewResults] = await Promise.all([
    // Staff: search by name, username, employeeId
    User.findAll({
      where: {
        [Op.or]: [
          { name: like },
          { username: like },
          { email: like },
        ],
        role: { [Op.notIn]: ['ADMIN'] },
      },
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
      limit: 10,
    }),

    // Goals: title or description
    Goal.findAll({
      where: {
        [Op.or]: [
          { title: like },
          { description: like },
        ],
      },
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name'] }],
      limit: 8,
    }),

    // Incidents: title or details
    Incident.findAll({
      where: {
        [Op.or]: [
          { title: like },
          { details: like },
        ],
      },
      include: [{ model: User, as: 'Staff', attributes: ['id', 'name'] }],
      order: [['incidentDate', 'DESC']],
      limit: 8,
    }),

    // Reviews: comment search
    MonthlyReview.findAll({
      where: { comment: like },
      include: [
        { model: User, as: 'Staff', attributes: ['id', 'name'] },
        { model: User, as: 'Submitter', attributes: ['id', 'name'] },
      ],
      order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
      limit: 6,
    }),
  ]);

  res.render('search/results', {
    q,
    results: { staffResults, goalResults, incidentResults, reviewResults },
    currentUserRole: viewer.role,
  });
});

export default router;
