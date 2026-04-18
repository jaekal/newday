import express from 'express';
import path from 'path';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleCheck.js';
import { getBuildingOptions, assignedBuildingFor, normalizeBuilding, buildingLabel } from '../utils/buildings.js';
import { s } from '../utils/text.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INSPECTION_PATH = path.join(__dirname, '../data/kiosk/inspection-reports.jsonl');

const escCsv = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

async function readJsonLines(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return txt.trim()
      ? txt.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
  } catch {
    return [];
  }
}

function canSeeBuilding(user, building) {
  const role = s(user?.role).toLowerCase();
  if (role === 'admin' || role === 'management') return true;
  const assigned = assignedBuildingFor(user);
  const normalized = normalizeBuilding(building, { allowBlank: true });
  return !assigned || !normalized || assigned === normalized;
}

function normalizeDateOnly(value) {
  const raw = s(value);
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  return raw;
}

function inDateRange(value, dateFrom, dateTo) {
  const stamp = s(value);
  if (!stamp) return false;
  const day = stamp.slice(0, 10);
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
}

function filterItems(items, req) {
  const role = s(req.session?.user?.role).toLowerCase();
  const requestedBuilding = normalizeBuilding(req.query.building, { allowBlank: true });
  const assignedBuilding = assignedBuildingFor(req.session?.user);
  const effectiveBuilding = role === 'admin' || role === 'management'
    ? requestedBuilding
    : (requestedBuilding && canSeeBuilding(req.session?.user, requestedBuilding) ? requestedBuilding : assignedBuilding);
  const requestedShift = s(req.query.shift);
  const requestedTechId = s(req.query.techId).toLowerCase();
  const requestedSku = s(req.query.sku || req.query.rackModel).toLowerCase();
  const dateFrom = normalizeDateOnly(req.query.dateFrom);
  const dateTo = normalizeDateOnly(req.query.dateTo);
  const q = s(req.query.q).toLowerCase();

  const filtered = items.filter((item) => {
    const itemBuilding = normalizeBuilding(item.building, { allowBlank: true });
    if (effectiveBuilding && itemBuilding !== effectiveBuilding) return false;
    if (requestedShift && String(item.shift || '') !== requestedShift) return false;
    if (requestedTechId && !s(item.techId || item.operatorId).toLowerCase().includes(requestedTechId)) return false;
    if (requestedSku && !s(item.rackModel).toLowerCase().includes(requestedSku)) return false;
    if ((dateFrom || dateTo) && !inDateRange(item.submittedAt, dateFrom, dateTo)) return false;
    if (!q) return true;
    const haystack = [
      item.operatorName,
      item.operatorId,
      item.techId,
      item.area,
      item.stage,
      item.index,
      item.rackSn,
      item.rackModel,
    ].map((v) => s(v).toLowerCase()).join(' ');
    return haystack.includes(q);
  });

  filtered.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

  return {
    items: filtered,
    filters: {
      building: effectiveBuilding || '',
      shift: requestedShift || '',
      techId: s(req.query.techId),
      sku: s(req.query.sku || req.query.rackModel),
      dateFrom,
      dateTo,
      q,
    },
    options: {
      buildings: getBuildingOptions().map((item) => ({
        ...item,
        label: buildingLabel(item.value),
      })),
      canViewAllBuildings: role === 'admin' || role === 'management',
      assignedBuilding: assignedBuilding || '',
    },
  };
}

function detailToCsv(item) {
  const row = {
    id: item.id,
    submittedAt: item.submittedAt,
    operatorName: item.operatorName,
    operatorId: item.operatorId,
    techId: item.techId,
    username: item.username,
    building: item.building,
    shift: item.shift,
    area: item.area,
    stage: item.stage,
    index: item.index,
    rackSn: item.rackSn,
    rackModel: item.rackModel,
    cablesOrganized: item.responses?.cablesOrganized,
    looseCablePositions: item.responses?.looseCablePositions,
    looseCableTypes: Array.isArray(item.responses?.looseCableTypes) ? item.responses.looseCableTypes.join('; ') : '',
    cablesUndamaged: item.responses?.cablesUndamaged,
    damagedCablePositions: item.responses?.damagedCablePositions,
    damagedCableTypes: Array.isArray(item.responses?.damagedCableTypes) ? item.responses.damagedCableTypes.join('; ') : '',
    coversInstalled: item.responses?.coversInstalled,
    incorrectCoverPositions: item.responses?.incorrectCoverPositions,
    coversUndamaged: item.responses?.coversUndamaged,
    damagedCoverPositions: item.responses?.damagedCoverPositions,
    thumbscrewsTight: item.responses?.thumbscrewsTight,
    looseThumbscrewPositions: item.responses?.looseThumbscrewPositions,
    screwsInstalled: item.responses?.screwsInstalled,
    missingScrewPositions: item.responses?.missingScrewPositions,
    otherIssues: item.responses?.otherIssues,
  };
  const headers = Object.keys(row);
  return `${headers.join(',')}\n${headers.map((key) => escCsv(row[key])).join(',')}\n`;
}

function itemsToCsv(items) {
  const headers = [
    'id',
    'submittedAt',
    'operatorName',
    'operatorId',
    'techId',
    'building',
    'shift',
    'area',
    'stage',
    'index',
    'rackSn',
    'rackModel',
    'cablesOrganized',
    'looseCablePositions',
    'looseCableTypes',
    'cablesUndamaged',
    'damagedCablePositions',
    'damagedCableTypes',
    'coversInstalled',
    'incorrectCoverPositions',
    'coversUndamaged',
    'damagedCoverPositions',
    'thumbscrewsTight',
    'looseThumbscrewPositions',
    'screwsInstalled',
    'missingScrewPositions',
    'otherIssues',
  ];
  const rows = items.map((item) => headers.map((key) => {
    if (key === 'looseCableTypes') return escCsv(Array.isArray(item.responses?.looseCableTypes) ? item.responses.looseCableTypes.join('; ') : '');
    if (key === 'damagedCableTypes') return escCsv(Array.isArray(item.responses?.damagedCableTypes) ? item.responses.damagedCableTypes.join('; ') : '');
    if (key in (item.responses || {})) return escCsv(item.responses[key]);
    return escCsv(item[key]);
  }).join(','));
  return `${headers.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

export default function inspectionsRouter() {
  const router = express.Router();

  router.get('/', requireAuth, requireRole('lead', 'management'), (_req, res) => {
    res.sendFile(path.join(__dirname, '../views/inspections.html'));
  });

  router.get('/api', requireAuth, requireRole('lead', 'management'), async (req, res, next) => {
    try {
      const all = await readJsonLines(INSPECTION_PATH);
      res.json(filterItems(all, req));
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/export', requireAuth, requireRole('lead', 'management'), async (req, res, next) => {
    try {
      const all = await readJsonLines(INSPECTION_PATH);
      const { items } = filterItems(all, req);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="inspection-reports-${stamp}.csv"`);
      res.send(itemsToCsv(items));
    } catch (e) {
      next(e);
    }
  });

  router.get('/api/:id/export', requireAuth, requireRole('lead', 'management'), async (req, res, next) => {
    try {
      const id = s(req.params.id);
      const all = await readJsonLines(INSPECTION_PATH);
      const item = all.find((entry) => s(entry.id) === id);
      if (!item) {
        return res.status(404).json({ message: 'Inspection report not found' });
      }
      if (!canSeeBuilding(req.session?.user, item.building)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const stamp = s(item.submittedAt).slice(0, 10) || 'inspection';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="inspection-${id}-${stamp}.csv"`);
      res.send(detailToCsv(item));
    } catch (e) {
      next(e);
    }
  });

  return router;
}
