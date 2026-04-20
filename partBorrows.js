// services/partBorrows.js — shared ledger + borrow/return actions for kiosk & /tools floor views
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import Joi from 'joi';

import { resolveEmployeeIdSet } from '../utils/employeeAliases.js';
import { withQueue } from '../utils/writeQueue.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data/kiosk');
export const PART_BORROW_PATH = path.join(DATA_DIR, 'part-borrows.jsonl');

export function normalizePartSn(value) {
  return String(value || '').trim().toUpperCase();
}

export function listOpenPartBorrows(lines) {
  const openById = new Map();
  for (const row of lines) {
    if (!row || typeof row !== 'object') continue;
    if (row.event === 'borrow' && row.id) {
      openById.set(String(row.id), { ...row });
    }
  }
  for (const row of lines) {
    if (!row || typeof row !== 'object') continue;
    if (row.event === 'return' && row.borrowId) {
      openById.delete(String(row.borrowId));
    }
  }
  return [...openById.values()];
}

export async function ensurePartBorrowFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PART_BORROW_PATH)) {
    await fsp.writeFile(PART_BORROW_PATH, '');
  }
}

export async function readPartBorrowLines() {
  await ensurePartBorrowFile();
  try {
    const txt = await fsp.readFile(PART_BORROW_PATH, 'utf8');
    return txt.trim()
      ? txt.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  } catch {
    return [];
  }
}

export async function appendPartBorrowRecord(record) {
  await ensurePartBorrowFile();
  await withQueue(
    PART_BORROW_PATH,
    () => fsp.appendFile(PART_BORROW_PATH, JSON.stringify(record) + '\n'),
    { timeoutMs: 10_000, label: 'jsonl-append:part-borrows' }
  );
}

/**
 * @param {object} value — validated partBorrowCreateSchema body
 * @param {object} user — req.session.user
 * @param {string} actor — operator id string
 * @param {*} io — socket io
 */
export async function createPartBorrow({ value, user, actor, io }) {
  const partNorm = normalizePartSn(value.partSn);
  if (!partNorm) {
    return { status: 400, body: { message: 'Part serial is required' } };
  }

  const lines = await readPartBorrowLines();
  const open = listOpenPartBorrows(lines);
  const conflict = open.find((b) => normalizePartSn(b.partSn) === partNorm);
  if (conflict) {
    return {
      status: 409,
      body: {
        message: 'This part serial already has an open borrow on file',
        conflictBorrowId: conflict.id,
        conflictOperatorId: conflict.operatorId,
      },
    };
  }

  const borrowedAt = new Date().toISOString();
  let expectedReturnAt = '';
  if (value.expectedReturnHours != null) {
    const d = new Date(borrowedAt);
    d.setHours(d.getHours() + Number(value.expectedReturnHours));
    expectedReturnAt = d.toISOString();
  }

  const rec = {
    event: 'borrow',
    id: randomUUID(),
    operatorId: actor,
    operatorName: String(user.name || user.username || user.id || actor).trim(),
    username: String(user.username || user.id || '').trim(),
    techId: String(user.techId || '').trim(),
    building: String(user.building || '').trim(),
    targetServerSn: String(value.targetServerSn).trim(),
    donorServerSn: String(value.donorServerSn || '').trim(),
    partSn: String(value.partSn).trim(),
    partSnNorm: partNorm,
    purpose: value.purpose,
    notes: String(value.notes || '').trim(),
    expectedReturnAt,
    borrowedAt,
  };

  await appendPartBorrowRecord(rec);
  io?.emit?.('kiosk:part.borrow', rec);

  return { status: 201, body: { ok: true, borrow: rec } };
}

/**
 * @param {object} value — validated partBorrowReturnSchema body
 * @param {string} actor
 * @param {object} sessionUser — req.session.user
 * @param {*} io
 */
export async function returnPartBorrow({ value, actor, sessionUser, io, allowedPurposes }) {
  const bidRaw = String(value.borrowId || '').trim();
  const snRaw = String(value.partSn || '').trim();
  if (!bidRaw && !snRaw) {
    return { status: 400, body: { message: 'Select an active borrow or enter the part serial.' } };
  }
  if (bidRaw) {
    const { error: idErr } = Joi.string().uuid().validate(bidRaw);
    if (idErr) {
      return { status: 400, body: { message: 'Invalid borrow id.' } };
    }
  }

  const sessionIds = [
    sessionUser?.techId,
    sessionUser?.id,
    sessionUser?.username,
  ].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  const acceptedIds = await resolveEmployeeIdSet([actor, ...sessionIds]);

  const normalizeMatch = (v) => String(v || '').trim().toLowerCase();
  const matchesTech = (v) => acceptedIds.has(normalizeMatch(v));

  const lines = await readPartBorrowLines();
  const open = listOpenPartBorrows(lines);

  let borrow = null;
  const bid = String(value.borrowId || '').trim();
  if (bid) {
    borrow = open.find((b) => String(b.id) === bid) || null;
  }
    if (!borrow && String(value.partSn || '').trim()) {
      const pn = normalizePartSn(value.partSn);
      let candidates = open.filter(
        (b) => normalizePartSn(b.partSn) === pn && matchesTech(b.operatorId)
      );
      if (Array.isArray(allowedPurposes) && allowedPurposes.length) {
        candidates = candidates.filter((b) =>
          allowedPurposes.includes(String(b.purpose || '').trim())
        );
      }
      if (candidates.length === 1) borrow = candidates[0];
    if (candidates.length > 1) {
      return {
        status: 409,
        body: {
          message:
            'Multiple open borrows match this part serial — select the borrow in the list or contact a lead.',
        },
      };
    }
  }

  if (!borrow) {
    return {
      status: 404,
      body: {
        message: 'No matching open borrow found (check serial or pick an active borrow).',
      },
    };
  }

    if (!matchesTech(borrow.operatorId)) {
      return {
        status: 403,
        body: { message: 'This borrow is assigned to a different operator.' },
      };
    }

    if (Array.isArray(allowedPurposes) && allowedPurposes.length) {
      const p = String(borrow.purpose || '').trim();
      if (!allowedPurposes.includes(p)) {
        return {
          status: 403,
          body: {
            message:
              'This borrow is not a golden-sample checkout. Use the Technician Kiosk to return it.',
          },
        };
      }
    }

    const returnedAt = new Date().toISOString();
  const durationMs = (() => {
    try {
      const t0 = new Date(borrow.borrowedAt || borrow.at || returnedAt).getTime();
      return Math.max(0, Date.now() - t0);
    } catch {
      return null;
    }
  })();

  const ret = {
    event: 'return',
    id: randomUUID(),
    borrowId: borrow.id,
    operatorId: actor,
    condition: value.condition,
    notes: String(value.notes || '').trim(),
    returnedAt,
    durationMs,
  };

  await appendPartBorrowRecord(ret);
  io?.emit?.('kiosk:part.return', { ...ret, borrow });

  return { status: 201, body: { ok: true, return: ret, borrow } };
}

export async function listOpenGoldenSampleBorrows() {
  const lines = await readPartBorrowLines();
  return listOpenPartBorrows(lines).filter((b) => b.purpose === 'golden_sample');
}
