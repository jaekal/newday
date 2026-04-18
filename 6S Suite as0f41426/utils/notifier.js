// utils/notifier.js
import crypto from 'crypto';

// ---------- Config helpers ----------
const bool = (v, d = false) => {
  if (v == null) return d;
  const s = String(v).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
};

const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  secure: bool(process.env.SMTP_SECURE, false),
  from: process.env.ALERT_EMAIL_FROM || 'no-reply@localhost',
};

const DEFAULT_TO = process.env.ALERT_EMAIL_TO || ''; // comma-separated
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL || '';

const RL_WINDOW_SEC = Number(process.env.NOTIFY_RATE_LIMIT_WINDOW_SEC || 6 * 60 * 60); // 6h
const RL_MAX_PER_WINDOW = Number(process.env.NOTIFY_RATE_LIMIT_MAX || 1);
const RL_NAMESPACE = process.env.NOTIFY_RATE_LIMIT_NS || (process.env.APP_INSTANCE || process.env.HOSTNAME || 'default');

// ---------- In-memory rate limiter ----------
/**
 * Memory store: key -> { count, resetAt }
 */
const RL_STORE = new Map();

/**
 * Build a stable, collision-resistant key for notifications so we don’t spam.
 * Combines:
 *  - namespace (instance id)
 *  - channel (email/slack/teams)
 *  - subject
 *  - recipients (for email)
 *  - list of ItemCodes (sorted, unique)
 *  - time bucket (now // window)
 */
function generateRateKey({ channel, subject = '', recipients = [], items = [], windowSec = RL_WINDOW_SEC }) {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const codes = Array.from(
    new Set(
      (items || [])
        .map(i => String(i?.ItemCode || i?.code || '').trim())
        .filter(Boolean)
    )
  ).sort();

  const payload = JSON.stringify({
    ns: RL_NAMESPACE,
    channel,
    subject,
    recipients: (recipients || []).map(s => String(s).trim().toLowerCase()).sort(),
    codes,
    bucket,
  });

  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `${channel}:${bucket}:${hash}`;
}

/**
 * Returns true if we should send (i.e., not rate-limited).
 * Increments counter when allowed.
 */
function shouldSend(key, { max = RL_MAX_PER_WINDOW, windowSec = RL_WINDOW_SEC } = {}) {
  const now = Date.now();
  const rec = RL_STORE.get(key);
  if (!rec || now >= rec.resetAt) {
    RL_STORE.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  if (rec.count < max) {
    rec.count += 1;
    return true;
  }
  return false;
}

// ---------- Email ----------
async function getMailer() {
  try {
    // Lazy import nodemailer so the app runs even if it's not installed
    const mod = await import('nodemailer');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Send an email. If nodemailer is not available or SMTP is not configured,
 * logs a warning and resolves (non-fatal).
 */
export async function sendEmail({ to = DEFAULT_TO, subject = '', text = '', html = '' } = {}) {
  const recipients = String(to || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.warn('[notifier] sendEmail skipped: no recipients configured (ALERT_EMAIL_TO).');
    return { ok: false, skipped: true, reason: 'no_recipients' };
  }

  const mailer = await getMailer();
  if (!mailer || !SMTP.host || !SMTP.user) {
    console.warn('[notifier] SMTP not configured or nodemailer not installed; printing mail instead.');
    console.log('--- EMAIL Fallback ---');
    console.log('To:', recipients.join(', '));
    console.log('Subject:', subject);
    console.log('Text:', text);
    if (html) console.log('HTML:\n', html);
    console.log('----------------------');
    return { ok: true, simulated: true };
  }

  const transporter = mailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.secure,
    auth: { user: SMTP.user, pass: SMTP.pass },
  });

  await transporter.sendMail({
    from: SMTP.from,
    to: recipients,
    subject,
    text: text || html?.replace(/<[^>]+>/g, ' ').trim() || '',
    html,
  });

  return { ok: true };
}

// ---------- Webhooks ----------
async function postWebhook(url, payload) {
  if (!url) return { ok: false, skipped: true, reason: 'no_webhook' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('[notifier] webhook error:', err);
    return { ok: false, error: String(err) };
  }
}

async function sendSlackDigest(lowItems, subject) {
  if (!SLACK_WEBHOOK_URL) return { ok: false, skipped: true };
  const byBuilding = {};
  lowItems.forEach(i => {
    const bldg = i.Building || 'Bldg-350';
    if (!byBuilding[bldg]) byBuilding[bldg] = [];
    byBuilding[bldg].push(i);
  });
  const lines = Object.entries(byBuilding).flatMap(([bldg, items]) => [
    `*🏢 ${bldg}*`,
    ...items.map(i =>
      `• *${i.ItemCode}* – ${i.Description || ''} (OnHand: ${i.OnHandQty}, Safety: ${i.SafetyLevelQty})`
    ),
  ]);
  return postWebhook(SLACK_WEBHOOK_URL, { text: `*${subject}*\n${lines.join('\n')}` });
}

async function sendTeamsDigest(lowItems, subject) {
  if (!TEAMS_WEBHOOK_URL) return { ok: false, skipped: true };
  const facts = lowItems.map(i => ({
    name: i.ItemCode,
    value: `${i.Description || ''} (OnHand: ${i.OnHandQty}, Safety: ${i.SafetyLevelQty})`,
  }));
  const payload = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: subject,
    themeColor: 'FF9900',
    sections: [{ activityTitle: subject, facts }],
  };
  return postWebhook(TEAMS_WEBHOOK_URL, payload);
}

// ---------- Public helpers for low-inventory ----------
export async function sendLowInventoryDigest(lowItems = []) {
  if (!Array.isArray(lowItems) || lowItems.length === 0) return { ok: true, skipped: true };

  // Group by building for clearer alerts
  const byBuilding = {};
  lowItems.forEach(i => {
    const bldg = i.Building || 'Bldg-350';
    if (!byBuilding[bldg]) byBuilding[bldg] = [];
    byBuilding[bldg].push(i);
  });
  const buildingNames = Object.keys(byBuilding).sort().join(', ');
  const subject = `Low Inventory Alert — ${buildingNames} (${lowItems.length} item${lowItems.length !== 1 ? 's' : ''})`;

  const recipients = String(DEFAULT_TO || '').split(',').map(s => s.trim()).filter(Boolean);

  const keyEmail = generateRateKey({ channel: 'email', subject, recipients, items: lowItems });
  const keySlack = generateRateKey({ channel: 'slack', subject, items: lowItems });
  const keyTeams = generateRateKey({ channel: 'teams', subject, items: lowItems });

  // Email — grouped by building
  if (shouldSend(keyEmail)) {
    const text = Object.entries(byBuilding).map(([bldg, items]) =>
      `── ${bldg} ──\n` + items.map(i =>
        `  ${i.ItemCode} — ${i.Description || ''} | OnHand: ${i.OnHandQty} | Safety: ${i.SafetyLevelQty}`
      ).join('\n')
    ).join('\n\n');

    const buildingSections = Object.entries(byBuilding).map(([bldg, items]) => `
      <tr style="background:#F0F4F8">
        <td colspan="4" style="padding:8px 6px 4px;font-weight:700;font-size:13px;color:#1E293B;border-top:2px solid #CBD5E1">
          🏢 ${bldg}
        </td>
      </tr>
      ${items.map(i => `
        <tr>
          <td style="font-family:monospace">${i.ItemCode}</td>
          <td>${i.Description || ''}</td>
          <td style="text-align:center;color:${Number(i.OnHandQty) === 0 ? '#DC2626' : '#D97706'};font-weight:700">${i.OnHandQty}</td>
          <td style="text-align:center">${i.SafetyLevelQty}</td>
        </tr>
      `).join('')}
    `).join('');

    const html = `
      <div style="font-family:sans-serif;max-width:640px">
        <h3 style="color:#1E293B;margin-bottom:4px">${subject}</h3>
        <p style="color:#64748B;font-size:13px;margin-top:0">Generated ${new Date().toLocaleString()}</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
          <thead style="background:#1E293B;color:#fff">
            <tr>
              <th style="text-align:left">Item Code</th>
              <th style="text-align:left">Description</th>
              <th>On Hand</th>
              <th>Safety Level</th>
            </tr>
          </thead>
          <tbody>
            ${buildingSections}
          </tbody>
        </table>
      </div>
    `;
    await sendEmail({ to: recipients.join(','), subject, text, html });
  } else {
    console.log('[notifier] Email digest suppressed by rate limit.');
  }

  // Slack
  if (shouldSend(keySlack)) {
    await sendSlackDigest(lowItems, subject);
  } else {
    console.log('[notifier] Slack digest suppressed by rate limit.');
  }

  // Teams
  if (shouldSend(keyTeams)) {
    await sendTeamsDigest(lowItems, subject);
  } else {
    console.log('[notifier] Teams digest suppressed by rate limit.');
  }

  return { ok: true };
}

/**
 * Backwards-compat shim (older code may call this name).
 */
export async function notifyLowInventory(items) {
  return sendLowInventoryDigest(items);
}

// For tests/ops: allow clearing the in-memory limiter.
export function _resetRateLimiter() {
  RL_STORE.clear();
}
