import express from 'express';
import crypto from 'crypto';
import taskService from '../services/taskService.js';

const router = express.Router();

// Capture raw body for HMAC verification when needed
const jsonWithRaw = express.json({
  verify: (req, _res, buf) => {
    // Keep a raw copy for signature verification
    req.rawBody = buf;
  }
});
router.use(jsonWithRaw);

// Never cache webhook endpoints
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Health/ping for external systems
router.get('/ping', (_req, res) => res.json({ ok: true }));

// ----- Auth helpers -----
function safeEqualStr(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  if (A.length === 0 || B.length === 0) return false;
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function readBearer(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : '';
}

function verifySharedSecret(req) {
  const shared = process.env.INBOUND_SHARED_SECRET || '';
  if (!shared) return false; // not configured
  const provided =
    String(req.headers['x-shared-secret'] || '') ||
    String(req.query.token || '') ||
    readBearer(req);
  return safeEqualStr(shared, provided);
}

function verifyHmac(req) {
  const secret = process.env.INBOUND_HMAC_SECRET || '';
  if (!secret) return false; // not configured
  const sigHeader =
    String(req.headers['x-hub-signature-256'] || req.headers['x-signature'] || '');
  if (!sigHeader) return false;

  // Accept "sha256=<hex>" or bare <hex>
  const provided = sigHeader.startsWith('sha256=')
    ? sigHeader.slice(7)
    : sigHeader;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || Buffer.from(''))
    .digest('hex');

  return safeEqualStr(expectedHex, provided);
}

function isAuthorized(req) {
  // Deny by default. Inbound webhooks must be authenticated with a shared
  // secret OR an HMAC. If neither is configured, we only accept the request
  // when the node is running in development AND INBOUND_ALLOW_UNSIGNED=1 is
  // explicitly opt-in. This prevents a fresh deploy from silently accepting
  // unauthenticated task mutations from the public internet.
  const anyConfigured = Boolean(
    process.env.INBOUND_SHARED_SECRET || process.env.INBOUND_HMAC_SECRET
  );
  if (anyConfigured) {
    return verifySharedSecret(req) || verifyHmac(req);
  }

  const isProd = String(process.env.NODE_ENV || 'development') === 'production';
  const allowUnsigned = /^(1|true|yes)$/i.test(String(process.env.INBOUND_ALLOW_UNSIGNED || ''));
  return !isProd && allowUnsigned;
}

// Helper: mark task bucket based on external status
async function setTaskBucketByStatus(taskId, status) {
  const s = String(status || '').toLowerCase();
  let bucket = 'todo';
  if (/(done|closed|resolved|complete|completed)/.test(s)) bucket = 'done';
  else if (/(in[-\s]?progress|doing|work|investigating|active)/.test(s)) bucket = 'doing';
  else if (/(blocked|on[-\s]?hold|waiting|pending)/.test(s)) bucket = 'blocked';
  else if (/(reopened|open|new)/.test(s)) bucket = 'todo';
  await taskService.updateTask(taskId, { bucket });
}

// ───────────────── Jira ─────────────────
router.post('/jira', async (req, res) => {
  if (!isAuthorized(req)) return res.status(403).json({ message: 'Forbidden' });

  const body = req.body || {};
  // Atlassian Cloud Issue event-ish structures
  const issue = body.issue || body.data?.issue || {};
  const key = issue.key || issue.id;
  const fields = issue.fields || {};
  const statusName = fields.status?.name || body.transition?.to_status || body.issue_event_type_name;

  if (!key) return res.status(400).json({ message: 'Missing issue key/id' });

  try {
    const all = await taskService.getAll();
    const match = all.find(t => String(t?.meta?.jiraKey || '') === String(key));
    if (!match) return res.json({ ok: true, note: 'no-linked-task' });

    await setTaskBucketByStatus(match.id, statusName);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'error' });
  }
});

// ─────────────── ServiceNow ───────────────
router.post('/servicenow', async (req, res) => {
  if (!isAuthorized(req)) return res.status(403).json({ message: 'Forbidden' });

  const body = req.body || {};
  const rec = body.record || body;
  const sysId = rec.sys_id || rec.id;
  if (!sysId) return res.status(400).json({ message: 'Missing sys_id/id' });

  const stateRaw = String(rec.state ?? rec.status ?? '').toLowerCase();
  // Map common SN numeric states: 1 New, 2 In Progress, 3 On Hold, 6 Resolved, 7 Closed
  const stateName = stateRaw.match(/^\d+$/)
    ? ({ '1': 'new', '2': 'in progress', '3': 'on hold', '6': 'resolved', '7': 'closed' }[stateRaw] || stateRaw)
    : stateRaw;

  try {
    const all = await taskService.getAll();
    const match = all.find(t => String(t?.meta?.snSysId || '') === String(sysId));
    if (!match) return res.json({ ok: true, note: 'no-linked-task' });

    await setTaskBucketByStatus(match.id, stateName);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'error' });
  }
});

// ─────────────── Generic ───────────────
router.post('/generic', async (req, res) => {
  if (!isAuthorized(req)) return res.status(403).json({ message: 'Forbidden' });

  // Accept { match: { metaKey:'jiraKey', value:'ABC-123' }, set: { bucket:'done', dueDate:'...', meta:{...} } }
  const { match = {}, set = {} } = req.body || {};
  const metaKey = String(match.metaKey || '').trim();
  const value = String(match.value || '').trim();

  if (!metaKey || !value) {
    return res.status(400).json({ message: 'match.metaKey and match.value are required' });
  }

  // Only allow known bucket values if provided
  const allowedBuckets = new Set(['todo', 'doing', 'done', 'blocked', 'backlog']);
  const patch = {};

  if (set.bucket) {
    const b = String(set.bucket).toLowerCase();
    if (!allowedBuckets.has(b)) return res.status(400).json({ message: `Invalid bucket '${set.bucket}'` });
    patch.bucket = b;
  }
  if (set.dueDate) patch.dueDate = set.dueDate;
  if (set.meta && typeof set.meta === 'object') patch.meta = set.meta;

  try {
    const all = await taskService.getAll();
    const m = all.find(t => metaKey && String(t?.meta?.[metaKey] || '') === value);
    if (!m) return res.json({ ok: true, note: 'no-linked-task' });

    // Merge meta if provided
    if (patch.meta) patch.meta = { ...(m.meta || {}), ...patch.meta };

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    await taskService.updateTask(m.id, patch);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e?.message || 'error' });
  }
});

export default (_io, _app) => router;
