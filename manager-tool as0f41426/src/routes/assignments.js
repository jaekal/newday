import express from 'express';
import { Op } from 'sequelize';
import { User, ReviewAssignment, StaffProfile, ManagerScope } from '../models/index.js';
import { ensureRole } from '../middleware/auth.js';

const router = express.Router();

router.use(ensureRole(['ADMIN', 'SENIOR_MANAGER', 'MANAGER', 'SUPERVISOR']));

async function getViewer(req) {
  if (!req.session || !req.session.userId) return null;

  return User.findByPk(req.session.userId, {
    include: [
      { model: StaffProfile, as: 'StaffProfile' },
      { model: ManagerScope, as: 'ManagerScopes' },
    ],
  });
}

function norm(v) {
  return String(v ?? '').trim();
}

function normalizePersonKey(v) {
  return norm(v).toLowerCase().replace(/\s+/g, ' ');
}

function toUpper(v) {
  return norm(v).toUpperCase();
}

function isManagerRole(role) {
  return toUpper(role) === 'MANAGER' || toUpper(role) === 'SENIOR_MANAGER';
}

function getViewerScope(viewer) {
  if (!viewer) {
    return { scoped: false, shift: null, buildings: new Set(), label: { buildingText: 'N/A', shiftText: 'N/A' } };
  }

  const role = toUpper(viewer.role);
  if (role === 'ADMIN') {
    return { scoped: false, shift: null, buildings: new Set(), label: { buildingText: 'All', shiftText: 'All' } };
  }

  if (role === 'MANAGER' || role === 'SENIOR_MANAGER') {
    const scopes = Array.isArray(viewer.ManagerScopes) ? viewer.ManagerScopes : [];
    const buildings = new Set(scopes.map((s) => norm(s.building)).filter(Boolean));
    const shifts = [...new Set(scopes.map((s) => norm(s.shift)).filter(Boolean))];
    const shift = shifts.length ? shifts[0] : null;
    const scoped = !!(shift && buildings.size > 0);

    return {
      scoped,
      shift,
      buildings,
      label: {
        buildingText: buildings.size ? [...buildings].join(', ') : 'N/A',
        shiftText: shift || 'N/A',
      },
    };
  }

  if (role === 'SUPERVISOR') {
    const profile = viewer.StaffProfile || null;
    const building = norm(profile?.building);
    const shift = norm(profile?.shift);
    const scoped = !!(building || shift);

    return {
      scoped,
      shift: shift || null,
      buildings: building ? new Set([building]) : new Set(),
      label: {
        buildingText: building || 'N/A',
        shiftText: shift || 'N/A',
      },
    };
  }

  return { scoped: false, shift: null, buildings: new Set(), label: { buildingText: 'N/A', shiftText: 'N/A' } };
}

function isTargetWithinViewerScope(viewerScope, targetProfile) {
  if (!viewerScope?.scoped) return true;
  if (!targetProfile) return false;

  const building = norm(targetProfile.building);
  const shift = norm(targetProfile.shift);

  if (!building && !shift) return false;

  if (viewerScope.buildings && viewerScope.buildings.size > 0) {
    if (!building || !viewerScope.buildings.has(building)) return false;
  }

  if (viewerScope.shift) {
    if (!shift || shift !== viewerScope.shift) return false;
  }

  return true;
}

function viewerIsScoped(viewerRole) {
  const role = toUpper(viewerRole);
  return role === 'MANAGER' || role === 'SENIOR_MANAGER' || role === 'SUPERVISOR';
}

function getSelectableReviewerRoles(viewerRole) {
  const role = toUpper(viewerRole);
  if (role === 'ADMIN') return ['LEAD', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'ADMIN'];
  if (role === 'SENIOR_MANAGER' || role === 'MANAGER') return ['LEAD', 'SUPERVISOR', 'MANAGER'];
  return ['LEAD'];
}

function getAssignableRolesForReviewerRole(reviewerRole) {
  const role = toUpper(reviewerRole);
  switch (role) {
    case 'LEAD':
      return ['STAFF'];
    case 'SUPERVISOR':
      return ['STAFF', 'LEAD'];
    case 'MANAGER':
    case 'SENIOR_MANAGER':
      return ['STAFF', 'LEAD', 'SUPERVISOR'];
    case 'ADMIN':
      return ['STAFF', 'LEAD', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER'];
    default:
      return ['STAFF'];
  }
}

function parseDateOnly(value) {
  const raw = norm(value);
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function parseBulkNames(raw) {
  return [...new Set(
    String(raw || '')
      .split(/[\r\n,;]+/)
      .map((part) => norm(part))
      .filter(Boolean)
  )];
}

function filterCandidatesForReviewer(allCandidates, reviewer, viewerPlain, viewerScope) {
  const reviewerProfile = reviewer?.StaffProfile || null;
  const reviewerBuilding = norm(reviewerProfile?.building);
  const reviewerShift = norm(reviewerProfile?.shift);

  let scopedCandidates = [...allCandidates];

  if (reviewerBuilding || reviewerShift) {
    scopedCandidates = scopedCandidates.filter((candidate) => {
      const profile = candidate.StaffProfile || null;
      if (!profile) return false;

      const building = norm(profile.building);
      const shift = norm(profile.shift);

      if (reviewerBuilding && building !== reviewerBuilding) return false;
      if (reviewerShift && shift !== reviewerShift) return false;
      return true;
    });
  }

  if (viewerIsScoped(viewerPlain.role) && viewerScope.scoped) {
    scopedCandidates = scopedCandidates.filter((candidate) =>
      isTargetWithinViewerScope(viewerScope, candidate.StaffProfile || null)
    );
  }

  return scopedCandidates;
}

function buildCandidateLookup(candidates) {
  const lookup = new Map();

  for (const candidate of candidates) {
    const keys = [
      candidate.name,
      candidate.username,
      candidate.StaffProfile?.employeeId,
    ]
      .map(normalizePersonKey)
      .filter(Boolean);

    for (const key of keys) {
      if (!lookup.has(key)) lookup.set(key, []);
      lookup.get(key).push(candidate);
    }
  }

  return lookup;
}

router.get('/', async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const viewerPlain = viewer.get({ plain: true });
    const viewerScope = getViewerScope(viewerPlain);

    if (isManagerRole(viewerPlain.role) && !viewerScope.scoped) {
      return res.render('assignments/index', {
        viewer: viewerPlain,
        viewerProfile: viewerPlain.StaffProfile || null,
        viewerScope,
        reviewers: [],
        selectedReviewer: null,
        staffList: [],
        assignedIds: new Set(),
        assignedAssignmentMap: new Map(),
        error: 'No manager scope assigned. Ask an admin to assign your building(s) and shift.',
      });
    }

    const selectableReviewerRoles = getSelectableReviewerRoles(viewerPlain.role);
    const allReviewers = await User.findAll({
      where: { role: { [Op.in]: selectableReviewerRoles } },
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
      order: [['name', 'ASC']],
    });

    let reviewers = allReviewers;
    if (viewerIsScoped(viewerPlain.role) && viewerScope.scoped) {
      reviewers = allReviewers.filter((reviewer) =>
        isTargetWithinViewerScope(viewerScope, reviewer.StaffProfile || null)
      );
    }

    const reviewerId = req.query.leadId ? Number(req.query.leadId) : null;

    let selectedReviewer = null;
    let staffList = [];
    let assignedIds = new Set();
    let assignedAssignmentMap = new Map();

    if (reviewerId) {
      selectedReviewer = await User.findByPk(reviewerId, {
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
      });

      if (!selectedReviewer) return res.status(400).send('Invalid reviewer selected.');

      const allowedReviewerRoles = new Set(selectableReviewerRoles);
      if (!allowedReviewerRoles.has(toUpper(selectedReviewer.role))) {
        return res.status(403).send('You do not have access to manage assignments for this reviewer.');
      }

      if (viewerIsScoped(viewerPlain.role) && viewerScope.scoped) {
        const ok = isTargetWithinViewerScope(viewerScope, selectedReviewer.StaffProfile || null);
        if (!ok) {
          return res.status(403).send('You do not have access to manage assignments for this reviewer.');
        }
      }

      const assignableRoles = getAssignableRolesForReviewerRole(selectedReviewer.role);
      const allCandidates = await User.findAll({
        where: {
          id: { [Op.ne]: selectedReviewer.id },
          role: { [Op.in]: assignableRoles },
        },
        include: [{ model: StaffProfile, as: 'StaffProfile' }],
        order: [['name', 'ASC']],
      });

      staffList = filterCandidatesForReviewer(
        allCandidates,
        selectedReviewer,
        viewerPlain,
        viewerScope
      );

      const assignments = await ReviewAssignment.findAll({
        where: { reviewerId: selectedReviewer.id, active: true },
      });

      assignedIds = new Set(assignments.map((assignment) => assignment.staffId));
      assignedAssignmentMap = new Map(
        assignments.map((assignment) => [assignment.staffId, assignment.get({ plain: true })])
      );
    }

    res.render('assignments/index', {
      viewer: viewerPlain,
      viewerProfile: viewerPlain.StaffProfile || null,
      viewerScope,
      reviewers,
      selectedReviewer,
      staffList,
      assignedIds,
      assignedAssignmentMap,
      error: null,
    });
  } catch (err) {
    console.error('ASSIGNMENTS GET ERROR:', err);
    res.status(500).send('Error loading assignments page');
  }
});

router.post('/', async (req, res) => {
  try {
    const viewer = await getViewer(req);
    if (!viewer) return res.redirect('/login');

    const viewerPlain = viewer.get({ plain: true });
    const viewerScope = getViewerScope(viewerPlain);

    if (isManagerRole(viewerPlain.role) && !viewerScope.scoped) {
      return res.status(403).send('No manager scope assigned. Ask an admin to assign your building(s) and shift.');
    }

    const reviewerId = Number(req.body.leadId);
    if (!reviewerId) return res.status(400).send('No reviewer selected.');

    const reviewer = await User.findByPk(reviewerId, {
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
    });
    if (!reviewer) return res.status(400).send('Invalid reviewer selected.');

    const selectableReviewerRoles = getSelectableReviewerRoles(viewerPlain.role);
    const allowedReviewerRoles = new Set(selectableReviewerRoles);
    if (!allowedReviewerRoles.has(toUpper(reviewer.role))) {
      return res.status(403).send('You do not have access to manage assignments for this reviewer.');
    }

    if (viewerIsScoped(viewerPlain.role) && viewerScope.scoped) {
      const ok = isTargetWithinViewerScope(viewerScope, reviewer.StaffProfile || null);
      if (!ok) {
        return res.status(403).send('You do not have access to manage assignments for this reviewer.');
      }
    }

    const dueDateRaw = norm(req.body.dueDate);
    const dueDate = dueDateRaw ? parseDateOnly(dueDateRaw) : null;
    if (dueDateRaw && !dueDate) {
      return res.status(400).send('Invalid due date. Use YYYY-MM-DD.');
    }

    const rawStaffIds = req.body.staffIds;
    let selectedIds = [];
    if (Array.isArray(rawStaffIds)) {
      selectedIds = rawStaffIds.map((id) => Number(id)).filter(Number.isFinite);
    } else if (typeof rawStaffIds === 'string' && rawStaffIds.trim()) {
      const singleId = Number(rawStaffIds.trim());
      if (Number.isFinite(singleId)) selectedIds = [singleId];
    }

    const assignableRoles = getAssignableRolesForReviewerRole(reviewer.role);
    const allCandidates = await User.findAll({
      where: {
        id: { [Op.ne]: reviewer.id },
        role: { [Op.in]: assignableRoles },
      },
      include: [{ model: StaffProfile, as: 'StaffProfile' }],
      order: [['name', 'ASC']],
    });

    const scopedCandidates = filterCandidatesForReviewer(
      allCandidates,
      reviewer,
      viewerPlain,
      viewerScope
    );

    const selectedSet = new Set(
      selectedIds.filter((id) => scopedCandidates.some((candidate) => candidate.id === id))
    );

    const bulkNames = parseBulkNames(req.body.bulkStaffNames);
    const candidateLookup = buildCandidateLookup(scopedCandidates);
    const unmatchedNames = [];
    const ambiguousNames = [];

    for (const name of bulkNames) {
      const matches = candidateLookup.get(normalizePersonKey(name)) || [];
      if (!matches.length) {
        unmatchedNames.push(name);
        continue;
      }
      if (matches.length > 1) {
        ambiguousNames.push(name);
        continue;
      }
      selectedSet.add(matches[0].id);
    }

    if (unmatchedNames.length || ambiguousNames.length) {
      const issues = [];
      if (unmatchedNames.length) issues.push(`No match found for: ${unmatchedNames.join(', ')}`);
      if (ambiguousNames.length) issues.push(`Multiple matches found for: ${ambiguousNames.join(', ')}`);
      return res.status(400).send(issues.join('. '));
    }

    const existingForReviewer = await ReviewAssignment.findAll({
      where: { reviewerId },
    });

    for (const staffId of selectedSet) {
      const existingRow = existingForReviewer.find((row) => row.staffId === staffId);

      if (existingRow) {
        existingRow.active = true;
        if (dueDateRaw) {
          existingRow.dueDate = dueDate;
        }
        await existingRow.save();
      } else {
        await ReviewAssignment.create({
          reviewerId,
          staffId,
          dueDate,
          active: true,
        });
      }
    }

    for (const row of existingForReviewer) {
      if (!selectedSet.has(row.staffId) && row.active) {
        row.active = false;
        await row.save();
      }
    }

    res.redirect(`/assignments?leadId=${reviewerId}`);
  } catch (err) {
    console.error('ASSIGNMENTS POST ERROR:', err);
    res.status(500).send('Error saving assignments: ' + (err.message || 'Unknown error'));
  }
});

export default router;
