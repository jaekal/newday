// src/services/staff/staffProfileTrainingService.js
import { Training } from '../../models/index.js';
import {
  computeTrainingRecordMeta,
  computeCourseOverallStatus,
  courseStatusPresentation,
  courseCategoryFromType,
  categoryPresentation,
  formatDateISO,
} from '../../utils/trainingStatus.js';

export async function buildTrainingSummary({ profile }) {
  let trainingRecords = [];
  let trainingStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    current: 0,
    expiring: 0,
    expired: 0,
  };
  let trainingGrouped = [];

  if (!profile?.employeeId) {
    return { trainingRecords, trainingStats, trainingGrouped };
  }

  trainingRecords = await Training.findAll({
    where: { employeeId: profile.employeeId },
    order: [['startDate', 'DESC'], ['courseName', 'ASC']],
  });

  trainingStats.total = trainingRecords.length;

  const groups = new Map();
  const now = new Date();

  for (const t of trainingRecords) {
    const meta = computeTrainingRecordMeta(t, { now, expiringSoonDays: 60 });

    if (meta.status === 'IN_PROGRESS') trainingStats.inProgress += 1;
    else if (meta.status === 'NOT_STARTED') trainingStats.notStarted += 1;
    else if (['CURRENT', 'COMPLETED'].includes(meta.status)) trainingStats.completed += 1;

    if (meta.status === 'CURRENT') trainingStats.current += 1;
    if (meta.status === 'EXPIRING') trainingStats.expiring += 1;
    if (meta.status === 'EXPIRED') trainingStats.expired += 1;

    const courseName = (t.courseName || 'Unknown Course').trim();
    const courseType = (t.courseType || '').trim();
    const key = `${courseName}||${courseType}`;

    if (!groups.has(key)) {
      const category = courseCategoryFromType(courseType);
      const catPresent = categoryPresentation(category);

      groups.set(key, {
        courseName,
        courseType,
        category,
        categoryLabel: catPresent.label,
        categoryChipClass: catPresent.chipClass,
        records: [],
      });
    }

    groups.get(key).records.push({
      id: t.id,
      raw: t,
      meta,
      startDateISO: formatDateISO(meta.startDate),
      endDateISO: formatDateISO(meta.endDate),
      completionDateISO: formatDateISO(meta.completionDate),
      dueDateISO: formatDateISO(meta.dueDate),
    });
  }

  trainingGrouped = Array.from(groups.values()).map((g) => {
    g.records.sort((a, b) => {
      const ad = a.meta.completionDate || a.meta.startDate || new Date(0);
      const bd = b.meta.completionDate || b.meta.startDate || new Date(0);
      return bd.getTime() - ad.getTime();
    });

    const metas = g.records.map((r) => r.meta);
    const overallStatus = computeCourseOverallStatus(metas);
    const present = courseStatusPresentation(overallStatus);
    const best = g.records.find((r) => r.meta.completionDate) || g.records[0] || null;

    return {
      courseName: g.courseName,
      courseType: g.courseType,
      category: g.category,
      categoryLabel: g.categoryLabel,
      categoryChipClass: g.categoryChipClass,
      overallStatus,
      overallLabel: present.label,
      overallBadgeClass: present.badgeClass,
      lastCompleted: best ? (best.completionDateISO || best.endDateISO || best.startDateISO) : null,
      nextDue: best ? best.dueDateISO : null,
      daysLeft: best ? best.meta.daysLeft : null,
      frequency: best ? best.raw.certificationFrequency || null : null,
      records: g.records,
    };
  });

  const statusRank = (s) => {
    if (s === 'EXPIRED') return 1;
    if (s === 'EXPIRING') return 2;
    if (s === 'IN_PROGRESS') return 3;
    if (s === 'NOT_STARTED') return 4;
    if (s === 'CURRENT') return 5;
    if (s === 'COMPLETED') return 6;
    return 7;
  };

  const categoryRank = (c) => {
    if (c === 'REQUIRED') return 1;
    if (c === 'ROLE_BASED') return 2;
    if (c === 'OPTIONAL') return 3;
    return 4;
  };

  trainingGrouped.sort((a, b) => {
    const ra = statusRank(a.overallStatus);
    const rb = statusRank(b.overallStatus);
    if (ra !== rb) return ra - rb;

    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;

    return a.courseName.localeCompare(b.courseName);
  });

  return {
    trainingRecords,
    trainingStats,
    trainingGrouped,
  };
}