// services/toolService.js
import path from 'path';
import { fileURLToPath } from 'url';
import { loadJSON, saveJSON, readModifyWriteJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import { Parser } from 'json2csv';
import { csvSafeObject } from '../utils/csv.js';
import { Asset, ToolAuditLog } from '../models/index.js';
import { s, lc } from '../utils/text.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* Paths (prefer config, fallback to lowercase ./data) */
const TOOL_PATH        = PATHS?.TOOL_PATH        || path.join(__dirname, '../data/tools.json');
// tools_audit.json retired — writes go to SQLite tool_audit_logs table via ToolAuditLog model

/* Helpers */
const STATUSES = new Set(['in inventory', 'being used']);
const allowedFieldsEdit = new Set([
  'slot', 'torque', 'classification', 'description', 'model',
  'calibrationStatus', 'calibrationDate', 'nextCalibrationDue', 'status', 'building'
]);
const csvFields = [
  'serialNumber', 'slot', 'torque', 'classification', 'description', 'model',
  'calibrationStatus', 'status', 'calibrationDate', 'nextCalibrationDue',
  'operatorId', 'timestamp', 'building', 'createdAt', 'updatedAt'
];

function nowIso() { return new Date().toISOString(); }

function normalizeStatus(v) {
  const x = lc(v);
  return STATUSES.has(x) ? (x === 'being used' ? 'being used' : 'in inventory') : 'in inventory';
}

/** Convert Excel serial (days since 1899-12-30), epoch millis, or ISO-ish to ISO string */
function toIsoDateFlexible(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n)) {
    // epoch millis?
    if (n > 10_000_000_000) {
      const d = new Date(n);
      return isNaN(+d) ? '' : d.toISOString();
    }
    // Excel serial
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + n * 86400000);
    return isNaN(+d) ? '' : d.toISOString();
  }
  const d = new Date(v);
  return isNaN(+d) ? '' : d.toISOString();
}

function normalizeTool(raw = {}) {
  const calibrationStatusRaw = raw.calibrationStatus ?? raw.calibrationstatus;
  const calibrationDateRaw   = raw.calibrationDate   ?? raw.lastCalibrationDate ?? raw.LastCalibrationDate;
  const nextDueRaw           = raw.nextCalibrationDue ?? raw.NextCalibrationDue;

  const tool = { ...raw };
  tool.serialNumber       = s(tool.serialNumber || tool.serial || tool.SerialNumber || '');
  tool.slot               = s(tool.slot);
  tool.torque             = s(tool.torque);
  tool.classification     = s(tool.classification);
  tool.description        = s(tool.description);
  tool.model              = s(tool.model);

  tool.calibrationStatus  = s(calibrationStatusRaw);
  tool.calibrationDate    = s(calibrationDateRaw);
  tool.nextCalibrationDue = toIsoDateFlexible(nextDueRaw ?? '');

  tool.status             = normalizeStatus(tool.status || 'in inventory');
  tool.operatorId         = s(tool.operatorId);
  tool.timestamp          = s(tool.timestamp);
  tool.building           = s(tool.building) || 'Bldg-350';
  tool.createdAt          = tool.createdAt ? s(tool.createdAt) : nowIso();
  tool.updatedAt          = tool.updatedAt ? s(tool.updatedAt) : tool.createdAt;

  return tool;
}

function mapToolToAsset(tool = {}) {
  const serialNumber = s(tool.serialNumber);
  const toolType = s(tool.toolType) || 'Tool';
  const classification = s(tool.classification);
  const torque = s(tool.torque);
  const notes = s(tool.description);
  const bits = [toolType ? `Type: ${toolType}` : '', notes].filter(Boolean);

  return {
    tagNumber: serialNumber,
    name: s(tool.model) || toolType || `Tool ${serialNumber}`,
    description: bits.join(' | '),
    category: 'Floor Tool',
    location: tool.slot ? `Slot ${s(tool.slot)}` : '',
    building: s(tool.building) || 'Bldg-350',
    status: lc(tool.status) === 'being used' ? 'Checked Out' : 'Available',
    itemType: 'equipment',
    equipmentClass: toolType,
    managedSource: 'tools',
    serialNumber,
    torque,
    toolClassification: classification.toLowerCase(),
    lastCalibrationDate: s(tool.calibrationDate).slice(0, 10) || null,
    nextCalibrationDue: s(tool.nextCalibrationDue).slice(0, 10) || null,
    calibrationIntervalDays: null,
    checkedOutBy: lc(tool.status) === 'being used' ? (s(tool.operatorId) || null) : null,
    checkedOutAt: lc(tool.status) === 'being used' ? (s(tool.timestamp) || null) : null,
  };
}

async function syncManagedAssetFromTool(tool) {
  const payload = mapToolToAsset(tool);
  if (!payload.tagNumber) return;
  const current = await Asset.findOne({ where: { tagNumber: payload.tagNumber } });
  if (current) await current.update(payload);
  else await Asset.create(payload);
}

async function removeManagedAssetForTool(serialNumber) {
  const serial = s(serialNumber);
  if (!serial) return;
  await Asset.destroy({ where: { tagNumber: serial, managedSource: 'tools' } });
}

function diff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (before[k] !== after[k]) out.push({ field: k, from: before[k], to: after[k] });
  }
  return out;
}

async function writeAudit({ action, serialNumber, actor, changes, operatorId }) {
  try {
    await ToolAuditLog.log({
      serialNumber: serialNumber || '',
      action:       action || 'unknown',
      actor:        actor  || 'system',
      operatorId:   operatorId || null,
      changes:      Array.isArray(changes) ? changes : [],
      time:         nowIso(),
    });
  } catch (e) {
    // Non-fatal: log failure should never break the checkout/return flow
    console.warn('[toolService] writeAudit failed:', e?.message || e);
  }
}

// ───────────────────────────────────────────────────────────
// Programmatic helpers shared with scans and routes
// ───────────────────────────────────────────────────────────
export async function checkoutToolBySerial({ serial, operatorId, actor = 'system', io }) {
  const serialNumber = s(serial);
  const operator = lc(operatorId);
  if (!serialNumber) throw new Error('serial required');
  if (!operator) throw new Error('operatorId required');

  let updated = null, before = null;
  await readModifyWriteJSON(TOOL_PATH, (current) => {
    const tools = (Array.isArray(current) ? current : []).map(normalizeTool);
    const idx = tools.findIndex(t => lc(t.serialNumber) === lc(serialNumber));
    if (idx === -1) throw new Error('Tool not found');
    if (lc(tools[idx].status) === 'being used') throw new Error('Already checked out');

    before = { ...tools[idx] };
    tools[idx].status     = 'being used';
    tools[idx].operatorId = operator;
    tools[idx].timestamp  = nowIso();
    tools[idx].updatedAt  = nowIso();
    updated = tools[idx];
    return tools;
  }, null, []);

  await syncManagedAssetFromTool(updated);
  io?.publish?.toolsUpdated?.({ serialNumbers: [updated.serialNumber], reason: 'checkout' });

  await writeAudit({
    action: 'checkout',
    serialNumber: updated.serialNumber,
    actor,
    operatorId: operator,
    changes: diff(before, updated)
  });

  try {
    const mod = await import('./webhooksOutService.js');
    await mod.default.emit('tool.checkout', { serialNumber: updated.serialNumber, operatorId: operator });
  } catch {}

  return { tool: updated };
}

export async function returnToolBySerial({ serial, actor = 'system', io }) {
  const serialNumber = s(serial);
  let updated = null, before = null;
  await readModifyWriteJSON(TOOL_PATH, (current) => {
    const tools = (Array.isArray(current) ? current : []).map(normalizeTool);
    const idx = tools.findIndex(t => lc(t.serialNumber) === lc(serialNumber));
    if (idx === -1) throw new Error('Tool not found');
    if (lc(tools[idx].status) !== 'being used') throw new Error('Tool not checked out');

    before = { ...tools[idx] };
    tools[idx].status     = 'in inventory';
    tools[idx].operatorId = '';
    tools[idx].timestamp  = '';
    tools[idx].updatedAt  = nowIso();
    updated = tools[idx];
    return tools;
  }, null, []);

  await syncManagedAssetFromTool(updated);
  io?.publish?.toolsUpdated?.({ serialNumbers: [updated.serialNumber], reason: 'return' });

  await writeAudit({
    action: 'return',
    serialNumber: updated.serialNumber,
    actor,
    changes: diff(before, updated)
  });

  try {
    const mod = await import('./webhooksOutService.js');
    await mod.default.emit('tool.return', { serialNumber: updated.serialNumber });
  } catch {}

  return { tool: updated };
}

// ───────────────────────────────────────────────────────────
// Service API
// ───────────────────────────────────────────────────────────
export default {
  async getAllTools(req, res, next) {
    try {
      const building = (req.query?.building || '').trim();
      let tools = (await loadJSON(TOOL_PATH, [])).map(normalizeTool);
      if (building && building !== 'all') {
        tools = tools.filter(t => (t.building || 'Bldg-350') === building);
      }
      tools.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
      res.json(tools);
    } catch (err) { next(err); }
  },

  async getTool(req, res, next) {
    try {
      const serial = s(req.params.serialNumber);
      const tools = await loadJSON(TOOL_PATH, []);
      const idx = tools.findIndex(t => lc(t.serialNumber || t.serial || t.SerialNumber) === lc(serial));
      if (idx === -1) return res.status(404).json({ message: 'Tool not found' });
      res.json(normalizeTool(tools[idx]));
    } catch (err) { next(err); }
  },

  addTool: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const body = req.body || {};
      const serial = s(body.serialNumber);
      if (!serial) return res.status(400).json({ message: 'serialNumber required' });

      const now = nowIso();
      const tool = normalizeTool({
        serialNumber: serial,
        slot: body.slot,
        torque: body.torque,
        classification: body.classification,
        description: body.description,
        model: body.model,
        calibrationStatus: body.calibrationStatus,
        calibrationDate: body.calibrationDate,
        nextCalibrationDue: body.nextCalibrationDue,
        status: normalizeStatus('in inventory'),
        operatorId: '',
        timestamp: '',
        createdAt: now,
        updatedAt: now
      });

      let conflict = false;
      await readModifyWriteJSON(TOOL_PATH, (current) => {
        const tools = (Array.isArray(current) ? current : []).map(normalizeTool);
        if (tools.findIndex(t => lc(t.serialNumber) === lc(serial)) !== -1) {
          conflict = true;
          return current;
        }
        tools.push(tool);
        return tools;
      }, null, []);
      if (conflict) return res.status(409).json({ message: 'Tool exists' });

      await syncManagedAssetFromTool(tool);

      await writeAudit({ action: 'add', serialNumber: tool.serialNumber, actor, changes: diff({}, tool) });

      try {
        const mod = await import('./webhooksOutService.js');
        await mod.default.emit('tool.added', tool);
      } catch {}

      io?.publish?.toolsUpdated?.({ serialNumbers: [tool.serialNumber], reason: 'add' });
      res.status(201).json({ message: 'Tool added', tool });
    } catch (err) { next(err); }
  },

  editTool: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const serial = s(req.params.serialNumber);
      const body = req.body || {};

      let result = { ok: false, status: 0, body: null, before: null, normalized: null, renamed: false };
      await readModifyWriteJSON(TOOL_PATH, (current) => {
        const tools = (Array.isArray(current) ? current : []).map(normalizeTool);
        const idx = tools.findIndex(t => lc(t.serialNumber) === lc(serial));
        if (idx === -1) { result = { status: 404, body: { message: 'Tool not found' } }; return current; }

        const beforeSnap = { ...tools[idx] };
        const newSerial = s(body.newSerialNumber);
        const isRename = Boolean(newSerial && lc(newSerial) !== lc(serial));
        if (isRename) {
          if (tools.findIndex(t => lc(t.serialNumber) === lc(newSerial)) !== -1) {
            result = { status: 409, body: { message: 'New serialNumber already exists' } };
            return current;
          }
          tools[idx].serialNumber = newSerial;
        }

        for (const [k, v] of Object.entries(body)) {
          if (allowedFieldsEdit.has(k)) {
            if (k === 'status') tools[idx][k] = normalizeStatus(v);
            else if (k === 'nextCalibrationDue') tools[idx][k] = toIsoDateFlexible(v);
            else tools[idx][k] = s(v);
          }
        }

        const normalizedTool = normalizeTool({ ...tools[idx], status: tools[idx].status, updatedAt: nowIso() });
        tools[idx] = normalizedTool;
        result = { ok: true, before: beforeSnap, normalized: normalizedTool, renamed: isRename };
        return tools;
      }, null, []);

      if (result.status) return res.status(result.status).json(result.body);
      const { before, normalized, renamed } = result;
      await syncManagedAssetFromTool(normalized);

      const changes = diff(before, normalized);
      if (renamed) {
        changes.push({ field: 'serialNumber', from: before.serialNumber, to: normalized.serialNumber });
      }

      await writeAudit({ action: 'edit', serialNumber: normalized.serialNumber, actor, changes });

      try {
        const mod = await import('./webhooksOutService.js');
        await mod.default.emit('tool.updated', normalized);
      } catch {}

      io?.publish?.toolsUpdated?.({ serialNumbers: [normalized.serialNumber], reason: 'edit' });
      res.json({ message: 'Tool updated', tool: normalized });
    } catch (err) { next(err); }
  },

  deleteTool: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const serial = s(req.params.serialNumber);

      let removed = null;
      await readModifyWriteJSON(TOOL_PATH, (current) => {
        const tools = (Array.isArray(current) ? current : []).map(normalizeTool);
        const idx = tools.findIndex(t => lc(t.serialNumber) === lc(serial));
        if (idx === -1) return current;
        removed = tools.splice(idx, 1)[0];
        return tools;
      }, null, []);
      if (!removed) return res.status(404).json({ message: 'Tool not found' });
      await removeManagedAssetForTool(removed.serialNumber);

      await writeAudit({ action: 'delete', serialNumber: removed.serialNumber, actor, changes: diff(removed, {}) });

      try {
        const mod = await import('./webhooksOutService.js');
        await mod.default.emit('tool.deleted', removed);
      } catch {}

      io?.publish?.toolsUpdated?.({ serialNumbers: [removed.serialNumber], reason: 'delete' });
      res.json({ message: 'Tool deleted', serialNumber: removed.serialNumber });
    } catch (err) { next(err); }
  },

  // UPDATED: use programmatic helpers so routes and scans share logic
  checkoutTool: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const serial = s(req.params.serialNumber);
      const { operatorId } = req.body || {};
      const result = await checkoutToolBySerial({ serial, operatorId, actor, io });
      res.json({ message: 'Checked out', tool: result.tool });
    } catch (err) { next(err); }
  },

  returnTool: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const serial = s(req.params.serialNumber);
      const result = await returnToolBySerial({ serial, actor, io });
      res.json({ message: 'Returned', tool: result.tool });
    } catch (err) { next(err); }
  },

  bulkCheckout: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const { serialNumbers, operatorId } = req.body || {};
      const operator = lc(operatorId);
      if (!Array.isArray(serialNumbers) || !operator) {
        return res.status(400).json({ message: 'Missing serialNumbers or operatorId' });
      }

      let tools = [], updated = [], skipped = [], notFound = [], audits = [];
      await readModifyWriteJSON(TOOL_PATH, (current) => {
        const toolsList = (Array.isArray(current) ? current : []).map(normalizeTool);
        const upd = [], skp = [], nf = [], aud = [];

        for (const snRaw of serialNumbers) {
          const sn = s(snRaw);
          const idx = toolsList.findIndex(t => lc(t.serialNumber) === lc(sn));
          if (idx === -1) { nf.push(sn); continue; }
          if (lc(toolsList[idx].status) === 'being used') { skp.push(sn); continue; }

          const beforeSnap = { ...toolsList[idx] };
          toolsList[idx].status     = 'being used';
          toolsList[idx].operatorId = operator;
          toolsList[idx].timestamp  = nowIso();
          toolsList[idx].updatedAt  = nowIso();
          upd.push(toolsList[idx].serialNumber);
          aud.push({
            action: 'checkout',
            serialNumber: toolsList[idx].serialNumber,
            actor,
            operatorId: operator,
            changes: diff(beforeSnap, toolsList[idx]),
          });
        }

        tools = toolsList; updated = upd; skipped = skp; notFound = nf; audits = aud;
        return upd.length ? toolsList : current;
      }, null, []);

      for (const a of audits) await writeAudit(a);

      if (updated.length) {
        for (const serial of updated) {
          const tool = tools.find(t => lc(t.serialNumber) === lc(serial));
          if (tool) await syncManagedAssetFromTool(tool);
        }
        io?.publish?.toolsUpdated?.({ serialNumbers: updated, reason: 'bulk_checkout' });
      }

      res.json({ message: 'Bulk checkout complete', updatedCount: updated.length, updated, skipped, notFound });
    } catch (err) { next(err); }
  },

  bulkReturn: (io) => async (req, res, next) => {
    try {
      const actor = req.session?.user?.id ?? 'system';
      const { serialNumbers } = req.body || {};
      if (!Array.isArray(serialNumbers)) {
        return res.status(400).json({ message: 'Missing serialNumbers' });
      }

      let tools = [], updated = [], skipped = [], notFound = [], audits = [];
      await readModifyWriteJSON(TOOL_PATH, (current) => {
        const toolsList = (Array.isArray(current) ? current : []).map(normalizeTool);
        const upd = [], skp = [], nf = [], aud = [];

        for (const snRaw of serialNumbers) {
          const sn = s(snRaw);
          const idx = toolsList.findIndex(t => lc(t.serialNumber) === lc(sn));
          if (idx === -1) { nf.push(sn); continue; }
          if (lc(toolsList[idx].status) !== 'being used') { skp.push(sn); continue; }

          const beforeSnap = { ...toolsList[idx] };
          toolsList[idx].status     = 'in inventory';
          toolsList[idx].operatorId = '';
          toolsList[idx].timestamp  = '';
          toolsList[idx].updatedAt  = nowIso();
          upd.push(toolsList[idx].serialNumber);
          aud.push({
            action: 'return',
            serialNumber: toolsList[idx].serialNumber,
            actor,
            changes: diff(beforeSnap, toolsList[idx]),
          });
        }

        tools = toolsList; updated = upd; skipped = skp; notFound = nf; audits = aud;
        return upd.length ? toolsList : current;
      }, null, []);

      for (const a of audits) await writeAudit(a);

      if (updated.length) {
        for (const serial of updated) {
          const tool = tools.find(t => lc(t.serialNumber) === lc(serial));
          if (tool) await syncManagedAssetFromTool(tool);
        }
        io?.publish?.toolsUpdated?.({ serialNumbers: updated, reason: 'bulk_return' });
      }

      res.json({ message: 'Bulk return complete', updatedCount: updated.length, updated, skipped, notFound });
    } catch (err) { next(err); }
  },

  async exportToolsCSV(_req, res, next) {
    try {
      const tools = (await loadJSON(TOOL_PATH, [])).map(normalizeTool);
      const parser = new Parser({ fields: csvFields });

      const csv = parser.parse(
        tools.map(t => {
          const row = {};
          for (const f of csvFields) row[f] = t[f] ?? '';
          // Harden against CSV injection
          return csvSafeObject(row);
        })
      );

      res.header('Content-Type', 'text/csv');
      res.attachment('tools_export.csv').send(csv);
    } catch (err) { next(err); }
  },
};
