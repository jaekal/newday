// services/webhooksOutService.js
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHmac } from 'crypto';

let fetchFn = typeof fetch === 'function' ? fetch : null;
async function getFetch() {
  if (fetchFn) return fetchFn;
  const mod = await import('node-fetch');
  fetchFn = mod.default;
  return fetchFn;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const FILE = path.join(DATA_DIR, 'integrations_out.json');

async function ensure() {
  if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
  if (!fsSync.existsSync(FILE)) await fs.writeFile(FILE, '[]', 'utf8');
}
async function readAll() {
  await ensure();
  return JSON.parse(await fs.readFile(FILE, 'utf8'));
}
async function writeAll(arr) {
  await ensure();
  await fs.writeFile(FILE, JSON.stringify(arr, null, 2), 'utf8');
}

/* ───────────────────────── Delivery helpers ───────────────────────── */

async function deliverSlack(target, event, payload) {
  const url = target.config?.webhookUrl || target.config?.url;
  if (!url) throw new Error('Missing Slack webhookUrl');
  const text = `*${event}*\n\n\`${JSON.stringify(payload).slice(0, 1900)}\``;
  const doFetch = await getFetch();
  const resp = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) {
    const reason = await resp.text().catch(() => String(resp.status));
    throw new Error(`Slack webhook failed: ${resp.status} ${reason}`);
  }
}

async function deliverJira(target, event, payload) {
  const { baseUrl, email, apiToken, projectKey, issueTypeName = 'Task' } = target.config || {};
  if (!baseUrl || !email || !apiToken || !projectKey) throw new Error('Missing Jira config');

  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const doFetch = await getFetch();

  const summaryBase = payload?.title || payload?.task?.title || 'Event';
  const body = {
    fields: {
      project: { key: projectKey },
      summary: `[${event}] ${summaryBase}`,
      issuetype: { name: issueTypeName },
      description: JSON.stringify(payload, null, 2).slice(0, 30000),
    },
  };
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/issue`;
  const resp = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const reason = await resp.text().catch(() => String(resp.status));
    throw new Error(`Jira create issue failed: ${resp.status} ${reason}`);
  }

  // If this event carries a task object, persist linkage for future inbound sync
  try {
    const data = await resp.json();
    const key = data?.key || data?.id;
    const selfUrl = data?.self;
    const taskId = payload?.id || payload?.task?.id;
    if (key && taskId) {
      const { default: taskService } = await import('./taskService.js');
      await taskService.updateTask(taskId, {
        meta: { ...(payload?.meta || payload?.task?.meta || {}), jiraKey: key, jiraUrl: selfUrl },
      });
    }
  } catch {
    /* noop */
  }
}

async function deliverServiceNow(target, event, payload) {
  const { instance, user, password, table = 'incident' } = target.config || {};
  if (!instance || !user || !password) throw new Error('Missing ServiceNow config');

  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  const doFetch = await getFetch();
  const url = `${instance.replace(/\/$/, '')}/api/now/table/${encodeURIComponent(table)}`;

  const body = {
    short_description: `[${event}] ${payload?.title || payload?.task?.title || 'Event'}`,
    description: JSON.stringify(payload).slice(0, 10000),
  };

  const resp = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const reason = await resp.text().catch(() => String(resp.status));
    throw new Error(`ServiceNow create failed: ${resp.status} ${reason}`);
  }

  // Link ServiceNow record back to task metadata if available
  try {
    const data = await resp.json(); // { result: { sys_id, number, ... } }
    const rec = data?.result || data;
    const sysId = rec?.sys_id;
    const number = rec?.number;
    const taskId = payload?.id || payload?.task?.id;

    if (sysId && taskId) {
      const { default: taskService } = await import('./taskService.js');
      const instUrl = (target.config?.instance || '').replace(/\/$/, '');
      const recUrl = instUrl
        ? `${instUrl}/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${sysId}`)}`
        : '';

      await taskService.updateTask(taskId, {
        meta: {
          ...(payload?.meta || payload?.task?.meta || {}),
          snSysId: sysId,
          snNumber: number,
          snUrl: recUrl,
        },
      });
    }
  } catch {
    /* noop */
  }
}

function signIfNeeded(headers = {}, secret, bodyStr) {
  if (!secret) return headers;
  const mac = createHmac('sha256', String(secret)).update(bodyStr, 'utf8').digest('hex');
  return { ...headers, 'X-Webhook-Signature': `sha256=${mac}` };
}

async function deliverGeneric(target, event, payload) {
  const { url, headers = {}, secret } = target.config || {};
  if (!url) throw new Error('Missing webhook URL');

  const doFetch = await getFetch();
  const body = JSON.stringify({ event, payload });
  const hdrs = signIfNeeded(
    {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    secret,
    body
  );

  const resp = await doFetch(url, {
    method: 'POST',
    headers: hdrs,
    body,
  });

  if (!resp.ok) {
    const reason = await resp.text().catch(() => String(resp.status));
    throw new Error(`Generic webhook failed: ${resp.status} ${reason}`);
  }
}

async function deliver(target, event, payload) {
  switch ((target.type || '').toLowerCase()) {
    case 'slack':
      return deliverSlack(target, event, payload);
    case 'jira':
      return deliverJira(target, event, payload);
    case 'servicenow':
      return deliverServiceNow(target, event, payload);
    default:
      return deliverGeneric(target, event, payload);
  }
}

function redact(t) {
  const { config = {}, ...rest } = t;
  const c = { ...config };
  for (const k of Object.keys(c)) {
    if (/token|secret|password|apiKey/i.test(k)) c[k] = '***';
  }
  return { ...rest, config: c };
}

/* ───────────────────────── Public API ───────────────────────── */

export default {
  async list({ redacted = true } = {}) {
    const arr = await readAll();
    return redacted ? arr.map(redact) : arr;
  },

  async upsert(target) {
    const all = await readAll();
    const id = target.id || randomUUID();
    const idx = all.findIndex((t) => t.id === id);
    const next = {
      id,
      name: target.name || 'Integration',
      type: target.type || 'generic',
      enabled: !!target.enabled,
      subscribedEvents: Array.from(new Set(target.subscribedEvents || [])),
      config: target.config || {},
      createdAt: all[idx]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx === -1) all.push(next);
    else all[idx] = next;
    await writeAll(all);
    return next;
  },

  async remove(id) {
    const all = await readAll();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    all.splice(idx, 1);
    await writeAll(all);
    return true;
  },

  async emit(event, payload) {
    const all = await readAll();
    const targets = all.filter((t) => t.enabled && (t.subscribedEvents || []).includes(event));
    for (const t of targets) {
      try {
        await deliver(t, event, payload);
      } catch (e) {
        // Keep going even if one target fails
        console.warn('[webhooksOut] delivery failed', t.name, e?.message || e);
      }
    }
  },

  async test(id, event = 'test.event', payload = { ok: true }) {
    const all = await readAll();
    const t = all.find((x) => x.id === id);
    if (!t) throw new Error('Not found');
    await deliver(t, event, payload);
    return { delivered: true };
  },
};
