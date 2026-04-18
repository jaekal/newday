// services/notifier.js
// Unified notification service for low-stock alerts (Email + Microsoft Teams).
// Safe when SMTP or Teams are not configured — it will no-op with helpful logs.

import nodemailer from 'nodemailer';

// Prefer Node 18+ global fetch; fall back to node-fetch if needed
let fetchFn = typeof fetch === 'function' ? fetch : null;
async function getFetch() {
  if (fetchFn) return fetchFn;
  // Lazy import to avoid hard dep when not needed
  const mod = await import('node-fetch');
  fetchFn = mod.default;
  return fetchFn;
}

// Env flags
const emailEnabled =
  Boolean(process.env.EMAIL_HOST) &&
  Boolean(process.env.EMAIL_FROM);

const teamsEnabled = Boolean(process.env.TEAMS_WEBHOOK);
const slackEnabled = Boolean(process.env.SLACK_WEBHOOK_URL);


// Create transporter only if email is enabled
let transporter = null;
if (emailEnabled) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth:
      process.env.EMAIL_USER && process.env.EMAIL_PASS
        ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        : undefined,
  });

  // Verify once on startup; don't crash app if SMTP is unreachable
  transporter.verify().catch((e) => {
    console.warn('[notifier] Mail transport verify failed:', e?.message || e);
  });
}

// Internal helper to normalize recipients
function getRecipients() {
  const raw = process.env.ALERT_RECIPIENTS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Compose basic text body lines for items
function formatLowStockLines(items = []) {
  return items
    .map(
      (i) =>
        `• ${i.ItemCode} (${i.Description || ''}) — OnHand=${i.OnHandQty ?? '?'} Safety=${i.SafetyLevelQty ?? '?'}`
    )
    .join('\n');
}

/**
 * Send a low-inventory alert email.
 * Safe to call even if email is not configured; will no-op.
 * @param {Array} lowItems
 */
export async function sendLowInventoryAlert(lowItems = []) {
  if (!emailEnabled) return;
  if (!Array.isArray(lowItems) || lowItems.length === 0) return;

  const recipients = getRecipients();
  if (!recipients.length) {
    console.warn('[notifier] EMAIL enabled but ALERT_RECIPIENTS is empty — skipping email send.');
    return;
  }

  const subject = `⚠️ Inventory Below Safety Level (${lowItems.length})`;
  const text = formatLowStockLines(lowItems);

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: recipients.join(','),
      subject,
      text,
    });
  } catch (e) {
    console.warn('[notifier] Failed to send email:', e?.message || e);
  }
}

/**
 * Backwards-compatible function used by jobs and routes.
 * Sends via Email and/or Teams if configured.
 * @param {Array} items
 */
export async function notifyLowStock(items = []) {
  if (!Array.isArray(items) || items.length === 0) return;

  // Email
  if (emailEnabled) {
    await sendLowInventoryAlert(items);
  }

  // Teams
  if (teamsEnabled) {
    try {
      const text = `**Low stock alert (${items.length})**\n\n${formatLowStockLines(items)}`;
      const doFetch = await getFetch();
      await doFetch(process.env.TEAMS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.warn('[notifier] Teams webhook failed:', e?.message || e);
    }
  }
}

// Slack webhook
  if (slackEnabled) {
    try {
      const text = `*Low stock alert (${items.length})*\n\n${formatLowStockLines(items)}`;
      const doFetch = await getFetch();
      await doFetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      console.warn('[notifier] Slack webhook failed:', e?.message || e);
    }
  }

/**
 * Generic email helper (optional utility).
 * Safe no-op when email is disabled.
 */
export async function sendEmail({ to, subject, text, html }) {
  if (!emailEnabled) return;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });
  } catch (e) {
    console.warn('[notifier] sendEmail failed:', e?.message || e);
  }
}
