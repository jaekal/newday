// src/services/staff/staffProfileAssignmentService.js
import { RackAssignment } from '../../models/index.js';

export async function buildAssignmentSummary({ staffId }) {
  let assignmentDailySummary = [];
  let assignmentStats = {
    totalDays: 0,
    totalRacks: 0,
    avgRacksPerDay: null,
    maxRacksInSingleDay: 0,
    lastAssignedDate: null,
  };

  const rackAssignments = await RackAssignment.findAll({
    where: { staffId },
    order: [['assignmentDate', 'DESC']],
  });

  if (rackAssignments?.length) {
    const byDate = new Map();
    rackAssignments.forEach((rec) => {
      const dateKey = rec.assignmentDate;
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(rec);
    });

    let totalRacks = 0;
    let totalDays = 0;
    let maxRacks = 0;
    let lastDate = null;

    for (const [dateKey, rows] of byDate.entries()) {
      let rackCountSum = 0;
      const combinedRackList = [];
      let area = null;
      let shift = null;

      rows.forEach((r) => {
        if (r.rackCount != null && !Number.isNaN(r.rackCount)) rackCountSum += r.rackCount;
        if (r.rackList) combinedRackList.push(String(r.rackList));
        if (!area && r.area) area = r.area;
        if (!shift && r.shift) shift = r.shift;
      });

      totalDays += 1;
      totalRacks += rackCountSum;
      if (rackCountSum > maxRacks) maxRacks = rackCountSum;
      if (!lastDate || dateKey > lastDate) lastDate = dateKey;

      assignmentDailySummary.push({
        assignmentDate: dateKey,
        rackCount: rackCountSum,
        rackList: combinedRackList.join(' | '),
        area,
        shift,
      });
    }

    assignmentDailySummary.sort((a, b) =>
      a.assignmentDate < b.assignmentDate ? 1 : a.assignmentDate > b.assignmentDate ? -1 : 0
    );

    assignmentStats.totalDays = totalDays;
    assignmentStats.totalRacks = totalRacks;
    assignmentStats.maxRacksInSingleDay = maxRacks;
    assignmentStats.lastAssignedDate = lastDate;

    if (totalDays > 0) {
      assignmentStats.avgRacksPerDay = Math.round((totalRacks / totalDays) * 10) / 10;
    }
  }

  const maxAssignmentRows = 10;
  const assignmentRows = Array.isArray(assignmentDailySummary)
    ? assignmentDailySummary.slice(0, maxAssignmentRows)
    : [];

  return {
    assignmentDailySummary,
    assignmentRows,
    maxAssignmentRows,
    assignmentStats,
  };
}