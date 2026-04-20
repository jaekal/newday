// routes/kiosk.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Joi from 'joi';
import { randomUUID } from 'crypto';

import idempotency from '../middleware/idempotency.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { requireRole } from '../middleware/roleCheck.js';
import taskService from '../services/taskService.js';
import {
  createPartBorrow,
  readPartBorrowLines,
  returnPartBorrow,
  listOpenPartBorrows,
  ensurePartBorrowFile,
} from '../services/partBorrows.js';
import { resolveEmployeeIdSet } from '../utils/employeeAliases.js';
import { withQueue } from '../utils/writeQueue.js';

// Serialize JSONL appends per file. Without this, two concurrent POSTs to
// /kiosk/suggestions can interleave their writes and produce a malformed
// line that breaks every subsequent parser until someone fixes it by hand.
async function appendJsonLine(filePath, record) {
  await withQueue(
    filePath,
    () => fsp.appendFile(filePath, JSON.stringify(record) + '\n'),
    { timeoutMs: 10_000, label: `jsonl-append:${filePath}` }
  );
}

// List endpoints expose aggregated operator-submitted content (free text,
// tickets, inspection reports). Limit to management/lead/admin only —
// plain kiosk operators only see their own via /my-items.
const requireManagementRead = requireRole('admin', 'lead', 'management');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base data dirs
const DATA_DIR   = path.join(__dirname, '../data/kiosk');
const SUG_PATH   = path.join(DATA_DIR, 'suggestions.jsonl');
const TCK_PATH   = path.join(DATA_DIR, 'tickets.jsonl');
const INSPECTION_PATH = path.join(DATA_DIR, 'inspection-reports.jsonl');
const UPLOAD_DIR = path.join(DATA_DIR, 'attachments');

/* --------- Known tool validation sources --------- */
const ROOT_DATA  = path.join(__dirname, '../data');
const TOOLS_FILE = process.env.TOOLS_FILE || path.join(ROOT_DATA, 'tools.json');
const ASSET_FILE = process.env.ASSET_CATALOG_FILE || path.join(ROOT_DATA, 'asset-catalog.json');

const CAND_KEYS = [
  'code','Code','ItemCode','serial','Serial','SerialNumber','serialNumber',
  'ToolSerial','SN','Barcode','SKU'
];

async function readSafeJSON(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readJsonLines(file) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return txt.trim()
      ? txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  } catch {
    return [];
  }
}

function takeStringsFromArray(arr) {
  const out = new Set();
  for (const it of arr || []) {
    if (typeof it === 'string') {
      out.add(it.trim());
      continue;
    }
    if (it && typeof it === 'object') {
      for (const k of CAND_KEYS) {
        const v = it[k];
        if (v && typeof v === 'string') out.add(v.trim());
      }
    }
  }
  return out;
}

function extractSerials(obj) {
  if (!obj) return new Set();
  if (Array.isArray(obj)) return takeStringsFromArray(obj);

  const keys = ['tools','items','assets','serials','data'];
  for (const k of keys) {
    if (Array.isArray(obj[k])) return takeStringsFromArray(obj[k]);
  }

  const out = new Set();
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const s of takeStringsFromArray(v)) out.add(s);
    }
  }
  return out;
}

async function checkKnownTool(code) {
  const k = String(code || '').trim();
  if (!k) return { known: false, sources: [] };

  const [toolsJson, assetJson] = await Promise.all([
    readSafeJSON(TOOLS_FILE),
    readSafeJSON(ASSET_FILE),
  ]);

  const toolsSet = extractSerials(toolsJson);
  const assetSet = extractSerials(assetJson);

  const inTools = toolsSet.has(k);
  const inAsset = assetSet.has(k);

  return {
    known: inTools || inAsset,
    sources: [inTools && 'tools', inAsset && 'assetCatalog'].filter(Boolean),
  };
}

/* --------- Files & uploads --------- */
async function ensureFiles() {
  await fsp.mkdir(DATA_DIR,   { recursive: true });
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });

  if (!fs.existsSync(SUG_PATH)) {
    await fsp.writeFile(SUG_PATH, '');
  }
  if (!fs.existsSync(TCK_PATH)) {
    await fsp.writeFile(TCK_PATH, '');
  }
  if (!fs.existsSync(INSPECTION_PATH)) {
    await fsp.writeFile(INSPECTION_PATH, '');
  }
  await ensurePartBorrowFile();
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

/* --------- Logged-in user helper --------- */
function getActor(req) {
  const u = req.session?.user || {};
  return String(
    u.techId ||          // preferred if present
    u.employeeId ||
    u.id ||
    u.username ||
    u.email ||
    u.name ||
    'anonymous'
  ).trim();
}

/* --------- Schemas --------- */
// Suggestion now accepts some optional UX fields as well
const suggestionSchema = Joi.object({
  category:      Joi.string().trim().allow(''),
  text:          Joi.string().trim().min(1).required(),
  severity:      Joi.string().trim().allow('', 'Low', 'Medium', 'High'),
  location:      Joi.string().trim().allow(''),
  wantFollowUp:  Joi.boolean().optional(),
  anonymous:     Joi.boolean().optional(),
  contactMethod: Joi.string().trim().allow(''),
});

const TICKET_CATEGORIES = ['Materials', 'Equipment', 'Facilities', 'IT', 'Safety', 'Other'];

const ticketSchema = Joi.object({
  category: Joi.string().trim().valid(...TICKET_CATEGORIES).required(),
  priority: Joi.string().trim().valid('Normal', 'Urgent', 'Critical').required(),
  description: Joi.string().trim().min(1).required(),
  whereArea: Joi.string().trim().max(120).allow(''),
  rowSlot: Joi.string().trim().max(120).allow(''),
  rackRef: Joi.string().trim().max(120).allow(''),
  orderRef: Joi.string().trim().max(120).allow(''),
  deviceLabel: Joi.string().trim().max(120).allow(''),
});

function buildTicketDetailFields(value) {
  return {
    whereArea: String(value.whereArea || '').trim(),
    rowSlot: String(value.rowSlot ?? value.stationId ?? '').trim(),
    rackRef: String(value.rackRef || '').trim(),
    orderRef: String(value.orderRef || '').trim(),
    deviceLabel: String(value.deviceLabel || '').trim(),
  };
}

/** Appends optional kiosk fields for searchability and handoff. */
function appendTicketDetailsFooter(userDescription, d) {
  const lines = [];
  if (d.whereArea) lines.push(`Area: ${d.whereArea}`);
  if (d.rowSlot) lines.push(`Row / slot: ${d.rowSlot}`);
  if (d.rackRef) lines.push(`Rack: ${d.rackRef}`);
  if (d.orderRef) lines.push(`Order / WO: ${d.orderRef}`);
  if (d.deviceLabel) lines.push(`Device / accessory: ${d.deviceLabel}`);
  if (!lines.length) return String(userDescription || '').trim();
  return `${String(userDescription || '').trim()}\n\n--- Details ---\n${lines.join('\n')}`;
}

const inspectionSchema = Joi.object({
  operatorId: Joi.string().trim().allow(''),
  shift: Joi.number().integer().min(1).max(3).required(),
  area: Joi.string().trim().valid('SLT Queue', 'SLT', 'Inventory Queue', 'RLT Queue', 'RLT', 'Hi-Pot').required(),
  stage: Joi.string()
    .trim()
    .valid('Initial Inspection', 'New assignment', 'Start of shift', 'Completed rack')
    .required(),
  index: Joi.string().trim().required(),
  rackSn: Joi.string().trim().pattern(/^\d{12}$/).required(),
  rackModel: Joi.string().trim().valid(
    'Bonsai24 MP',
    'GarfieldCV1',
    'Gen 7.0 GPU Compute T4',
    'GEN8.0 XDIRECT',
    'GEN8.1 COMPUTE FPGA STP',
    'GEN8.1 Dedicated Compute DSC',
    'GEN8.2 XArchive Single Frame',
    'GEN8.3 XArchive Single Frame',
    'GEN9.0 GPU Compute MI300X',
    'GEN9.0 XArchive Single Frame',
    'GEN9.1 XArchive Single Frame',
    'GEN9.3 GPU Compute H200',
    'GEN10.0 HPC Compute MI300C',
    'Hopper01K',
    'Hopper03K',
    'Hopper03K NSK4.0',
    'Hopper05K',
    'Hopper68EK',
    'Hopper68EK EVT2',
    'Hopper79 MI355',
    'Hopper79 S&V',
    'Webber1816 Patagonia'
  ).required(),
  responses: Joi.object({
    cablesOrganized: Joi.string().valid('yes', 'no').required(),
    looseCablePositions: Joi.string().allow(''),
    looseCableTypes: Joi.array().items(Joi.string().valid('QSFP', 'RJ45', 'Power', 'Bridge')).default([]),
    cablesUndamaged: Joi.string().valid('yes', 'no').required(),
    damagedCablePositions: Joi.string().allow(''),
    damagedCableTypes: Joi.array().items(Joi.string().valid('QSFP', 'RJ45', 'Power', 'Bridge')).default([]),
    coversInstalled: Joi.string().valid('yes', 'no').required(),
    incorrectCoverPositions: Joi.string().allow(''),
    coversUndamaged: Joi.string().valid('yes', 'no').required(),
    damagedCoverPositions: Joi.string().allow(''),
    thumbscrewsTight: Joi.string().valid('yes', 'no').required(),
    looseThumbscrewPositions: Joi.string().allow(''),
    screwsInstalled: Joi.string().valid('yes', 'no').required(),
    missingScrewPositions: Joi.string().allow(''),
    otherIssues: Joi.string().allow(''),
  }).required(),
});

const partBorrowCreateSchema = Joi.object({
  targetServerSn: Joi.string().trim().min(1).max(120).required(),
  donorServerSn: Joi.string().trim().allow('').max(120),
  partSn: Joi.string().trim().min(1).max(120).required(),
  purpose: Joi.string()
    .trim()
    .valid('golden_sample', 'cross_server_validation', 'other')
    .required(),
  notes: Joi.string().trim().allow('').max(2000),
  expectedReturnHours: Joi.number().integer().min(1).max(720).allow(null),
});

const partBorrowReturnSchema = Joi.object({
  borrowId: Joi.string().trim().allow(''),
  partSn: Joi.string().trim().allow('').max(120),
  condition: Joi.string().trim().valid('Good', 'Damaged', 'Consumed', 'Not returned — logged').required(),
  notes: Joi.string().trim().allow('').max(2000),
});

export default function kioskRouter(io /*, app */) {
  const router = express.Router();

  /* ---------- Validation endpoints ---------- */
  router.get('/validate/tool/:code', apiLimiter, async (req, res, next) => {
    try {
      const { code } = req.params;
      const result = await checkKnownTool(code);
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  /** Whether this rack SN already has an "Initial Inspection" on file (any prior report). */
  router.get('/inspection-rack/:rackSn/initial-status', apiLimiter, async (req, res, next) => {
    try {
      await ensureFiles();
      const rackSn = String(req.params.rackSn || '').trim();
      if (!/^\d{12}$/.test(rackSn)) {
        return res.status(400).json({ message: 'Rack SN must be exactly 12 digits' });
      }
      const lines = await readJsonLines(INSPECTION_PATH);
      const hasInitialInspection = lines.some(
        (row) =>
          String(row.rackSn || '').trim() === rackSn &&
          String(row.stage || '').trim() === 'Initial Inspection'
      );
      res.json({ rackSn, hasInitialInspection });
    } catch (e) {
      next(e);
    }
  });

  /* ---------- Suggestions ---------- */
  router.post(
    '/suggestions',
    apiLimiter,
    idempotency(),
    express.json(),     // kiosk sends JSON here
    async (req, res, next) => {
      try {
        await ensureFiles();

        const base = req.body || {};

        // Be forgiving about field names in case front-end changed
        const toValidate = {
          category:      base.category,
          text:          base.text ?? base.description ?? base.suggestion ?? '',
          severity:      base.severity,
          location:      base.location,
          wantFollowUp:  base.wantFollowUp,
          anonymous:     base.anonymous,
          contactMethod: base.contactMethod,
        };

        const { error, value } = suggestionSchema.validate(toValidate, {
          abortEarly: false,
          allowUnknown: true,   // tolerate extra payload keys
        });

        if (error) {
          return res.status(400).json({
            message: 'Invalid input',
            details: error.details,
            bodySample: {
              hasText: !!toValidate.text,
              textLen: (toValidate.text || '').length,
            },
          });
        }

        const actor = getActor(req);

        const rec = {
          id:         randomUUID(),
          operatorId: actor,
          category:   value.category || '',
          text:       value.text,
          severity:   value.severity || '',
          location:   value.location || '',
          wantFollowUp: !!value.wantFollowUp,
          anonymous:    !!value.anonymous,
          contactMethod: value.contactMethod || '',
          status:     'received',
          at:         new Date().toISOString(),
        };

        await appendJsonLine(SUG_PATH, rec);
        io?.emit?.('kiosk:suggestion.created', rec);

        // Intentionally not mirrored to Projects — suggestions live in
        // data/kiosk/suggestions.jsonl and Command Floor /management metrics only.

        res.status(201).json({ ok: true, suggestion: rec });
      } catch (e) {
        next(e);
      }
    }
  );

  /* ---------- Tickets (with optional image) ---------- */
  router.post(
    '/tickets',
    apiLimiter,
    idempotency(),
    upload.single('image'),   // multipart/form-data
    async (req, res, next) => {
      try {
        await ensureFiles();
        const base = req.body || {};

        const { error, value } = ticketSchema.validate(
          {
            category: base.category,
            priority: base.priority,
            description: base.description ?? base.text ?? '',
            whereArea: base.whereArea,
            rowSlot: base.rowSlot ?? base.stationId,
            rackRef: base.rackRef,
            orderRef: base.orderRef,
            deviceLabel: base.deviceLabel,
          },
          {
            abortEarly: false,
            allowUnknown: true,
          }
        );

        if (error) {
          return res.status(400).json({
            message: 'Invalid input',
            details: error.details,
          });
        }

        const actor = getActor(req);

        let attachment = null;
        if (req.file) {
          attachment = {
            originalName: req.file.originalname || 'attachment',
            mime:         req.file.mimetype,
            size:         req.file.size,
            path:         path.relative(DATA_DIR, req.file.path),
          };
        }

        const details = buildTicketDetailFields(value);
        const fullDescription = appendTicketDetailsFooter(value.description, details);

        const rec = {
          id: randomUUID(),
          operatorId: actor,
          category: value.category,
          priority: value.priority,
          description: fullDescription,
          whereArea: details.whereArea,
          rowSlot: details.rowSlot,
          rackRef: details.rackRef,
          orderRef: details.orderRef,
          deviceLabel: details.deviceLabel,
          attachment,
          status: 'submitted',
          at: new Date().toISOString(),
        };

        await appendJsonLine(TCK_PATH, rec);
        io?.emit?.('kiosk:ticket.created', rec);

        let createdTask = null;
        try {
          const firstLine = String(value.description || '')
            .split('\n')
            .map((s) => s.trim())
            .find(Boolean) || '';
          const short = firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
          const taskTitle = short
            ? `Ticket: ${rec.category} — ${short}`
            : `Kiosk Ticket: ${rec.category} (${rec.priority})`;

          createdTask = await taskService.addKioskTicket({
            id: rec.id,
            title: taskTitle,
            description: fullDescription,
            meta: {
              kioskId: rec.id,
              operatorId: rec.operatorId,
              category: rec.category,
              priority: rec.priority,
              attachment: attachment ? { ...attachment } : undefined,
              source: 'kiosk',
              triage: {
                whereArea: details.whereArea,
                rowSlot: details.rowSlot,
                rackRef: details.rackRef,
                orderRef: details.orderRef,
                deviceLabel: details.deviceLabel,
              },
            },
          });
          io?.publish?.projectsUpdated?.({ id: createdTask.id, reason: 'kiosk_ticket' });
        } catch {
          // ignore
        }

        const taskId = createdTask?.id || null;
        res.status(201).json({
          ok: true,
          ticket: rec,
          taskId,
          projectUrl: taskId ? `/projects?q=${encodeURIComponent(taskId)}` : null,
        });
      } catch (e) {
        next(e);
      }
    }
  );

  router.post(
    '/inspection-reports',
    apiLimiter,
    idempotency(),
    express.json(),
    async (req, res, next) => {
      try {
        await ensureFiles();

        const { error, value } = inspectionSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: false,
        });

        if (error) {
          return res.status(400).json({
            message: 'Invalid inspection report input',
            details: error.details,
          });
        }

        const user = req.session?.user || {};
        const actor = getActor(req);

        const rec = {
          id: randomUUID(),
          reportType: 'rack_inspection',
          submittedAt: new Date().toISOString(),
          operatorId: actor,
          operatorName: String(user.name || user.username || user.id || actor).trim(),
          username: String(user.username || user.id || '').trim(),
          techId: String(user.techId || '').trim(),
          building: String(user.building || '').trim(),
          shift: value.shift,
          area: value.area,
          stage: value.stage,
          index: value.index,
          rackSn: value.rackSn,
          rackModel: value.rackModel,
          responses: value.responses,
        };

        await appendJsonLine(INSPECTION_PATH, rec);
        io?.emit?.('kiosk:inspection.created', rec);

        res.status(201).json({ ok: true, inspection: rec });
      } catch (e) {
        next(e);
      }
    }
  );

  /* ---------- Part borrows (golden sample & cross-server validation) ---------- */
  router.post(
    '/part-borrows',
    apiLimiter,
    idempotency(),
    express.json(),
    async (req, res, next) => {
      try {
        await ensureFiles();

        const { error, value } = partBorrowCreateSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: false,
        });

        if (error) {
          return res.status(400).json({
            message: 'Invalid part borrow request',
            details: error.details,
          });
        }

        const user = req.session?.user || {};
        const actor = getActor(req);
        const result = await createPartBorrow({ value, user, actor, io });
        res.status(result.status).json(result.body);
      } catch (e) {
        next(e);
      }
    }
  );

  router.post(
    '/part-borrows/return',
    apiLimiter,
    idempotency(),
    express.json(),
    async (req, res, next) => {
      try {
        await ensureFiles();

        const { error, value } = partBorrowReturnSchema.validate(req.body || {}, {
          abortEarly: false,
          allowUnknown: false,
        });

        if (error) {
          return res.status(400).json({
            message: 'Invalid part return',
            details: error.details,
          });
        }

        const actor = getActor(req);
        const result = await returnPartBorrow({
          value,
          actor,
          sessionUser: req.session?.user || {},
          io,
        });
        res.status(result.status).json(result.body);
      } catch (e) {
        next(e);
      }
    }
  );

  /* ---------- Optional list endpoints (management/lead/admin only) ---------- */
  router.get('/suggestions', requireManagementRead, apiLimiter, async (_req, res, next) => {
    try {
      await ensureFiles();
      const txt = await fsp.readFile(SUG_PATH, 'utf8');
      const lines = txt.trim()
        ? txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      res.json(lines.slice(-500));
    } catch (e) {
      next(e);
    }
  });

  router.get('/tickets', requireManagementRead, apiLimiter, async (_req, res, next) => {
    try {
      await ensureFiles();
      const txt = await fsp.readFile(TCK_PATH, 'utf8');
      const lines = txt.trim()
        ? txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : [];
      res.json(lines.slice(-500));
    } catch (e) {
      next(e);
    }
  });

  router.get('/inspection-reports', requireManagementRead, apiLimiter, async (_req, res, next) => {
    try {
      await ensureFiles();
      const lines = await readJsonLines(INSPECTION_PATH);
      res.json(lines.slice(-500));
    } catch (e) {
      next(e);
    }
  });

  router.get('/my-items', apiLimiter, async (req, res, next) => {
    try {
      await ensureFiles();

      const requestedTechId = String(req.query.techId || '').trim().toLowerCase();
      const sessionIds = [
        req.session?.user?.techId,
        req.session?.user?.id,
        req.session?.user?.username,
      ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
      const acceptedIds = await resolveEmployeeIdSet([requestedTechId, ...sessionIds]);

      const [suggestions, tickets, inspections, borrowLines, tasks] = await Promise.all([
        readJsonLines(SUG_PATH),
        readJsonLines(TCK_PATH),
        readJsonLines(INSPECTION_PATH),
        readPartBorrowLines(),
        taskService.getAll(),
      ]);

      const kioskTasks = tasks.filter((t) => String(t.source || '').toLowerCase() === 'kiosk');
      const taskByKioskId = new Map(
        kioskTasks
          .map((t) => [String(t.meta?.kioskId || '').trim(), t])
          .filter(([id]) => id)
      );

      const normalizeMatch = (value) => String(value || '').trim().toLowerCase();
      const matchesTech = (value) => acceptedIds.has(normalizeMatch(value));

      const matchedSuggestions = suggestions
        .filter((item) => matchesTech(item.operatorId))
        .map((item) => {
          const task = taskByKioskId.get(String(item.id || '').trim());
          return {
            ...item,
            type: 'suggestion',
            title: item.category ? `Suggestion: ${item.category}` : 'Suggestion',
            status: task?.bucket || item.status || 'received',
            taskId: task?.id || '',
          };
        });

      const matchedTickets = tickets
        .filter((item) => matchesTech(item.operatorId))
        .map((item) => {
          const task = taskByKioskId.get(String(item.id || '').trim());
          return {
            ...item,
            type: 'ticket',
            title: item.category ? `Ticket: ${item.category}` : 'Ticket',
            status: task?.bucket || item.status || 'submitted',
            taskId: task?.id || '',
          };
        });

      const matchedInspections = inspections
        .filter((item) => matchesTech(item.operatorId) || matchesTech(item.techId) || matchesTech(item.username))
        .map((item) => ({
          ...item,
          type: 'inspection',
          title: `Inspection: ${item.area || 'Area'} · Rack ${item.rackSn || ''}`.trim(),
          status: 'submitted',
          at: item.submittedAt || item.at,
        }));

      const openBorrows = listOpenPartBorrows(borrowLines);
      const matchedPartBorrows = openBorrows
        .filter((b) => matchesTech(b.operatorId) || matchesTech(b.techId) || matchesTech(b.username))
        .map((item) => ({
          ...item,
          type: 'partBorrow',
          title: `Part borrow: ${item.partSn || ''} → ${item.targetServerSn || ''}`.trim(),
          status: 'out',
          at: item.borrowedAt,
        }));

      res.json({
        suggestions: matchedSuggestions,
        tickets: matchedTickets,
        inspections: matchedInspections,
        partBorrows: matchedPartBorrows,
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}
