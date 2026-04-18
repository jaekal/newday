// utils/errorHandler.js
import path from 'path';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';

const isProd = (process.env.NODE_ENV || 'development') === 'production';

// Stack/detail leakage gate. Default: exposed in development only.
// Can be forced off in dev (`DEBUG_ERRORS=0`) or on in non-prod (`DEBUG_ERRORS=1`).
// Production always keeps this off regardless.
const DEBUG_ERRORS = (() => {
  const v = String(process.env.DEBUG_ERRORS ?? '').toLowerCase();
  if (isProd) return false;
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return !isProd;
})();

// Compute the repo root once so we can strip it from stack traces. Even in
// dev, leaking "C:\Users\someone\OneDrive\Projects\..." in a browser tab is
// bad hygiene.
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

function sanitizeStack(stack) {
  if (!stack) return '';
  const lines = String(stack).split('\n').slice(0, 8);
  return lines
    .map((line) => line
      .split(REPO_ROOT).join('<app>')
      .split(REPO_ROOT.replace(/\\/g, '/')).join('<app>'))
    .join('\n');
}

function wantsJson(req) {
  const accept = String(req.headers?.accept || '');
  return accept.includes('application/json') ||
         req.xhr === true ||
         String(req.headers['content-type'] || '').includes('application/json');
}

function hasSentry() {
  try { return !!Sentry?.getCurrentHub?.().getClient(); }
  catch { return false; }
}

function sanitizeValidationDetails(details = []) {
  try {
    return details.map(d => ({
      message: d.message,
      path: Array.isArray(d.path) ? d.path.join('.') : d.path,
      type: d.type,
      context: d.context ? Object.keys(d.context).filter(k => k !== 'value') : undefined,
    }));
  } catch {
    return undefined;
  }
}

function toPublicError(err) {
  let status  = err.status || err.statusCode || 500;
  let code    = err.code || 'ERR_UNEXPECTED';
  let message = err.publicMessage || err.message || 'Unexpected error';
  let details;

  // Body parser JSON error
  if (err instanceof SyntaxError && 'body' in err) {
    status = 400; code = 'INVALID_JSON'; message = 'Malformed JSON body.';
  }

  // Payload too large
  if (err.type === 'entity.too.large') {
    status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request payload too large.';
  }

  // Joi
  if (err.isJoi || (Array.isArray(err.details) && err.details.length)) {
    status = 400; code = 'VALIDATION_FAILED'; message = 'One or more fields failed validation.';
    details = sanitizeValidationDetails(err.details);
  }

  // Multer
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      status = 413; code = 'UPLOAD_TOO_LARGE'; message = 'Uploaded file is too large.'; break;
    case 'LIMIT_FILE_TYPES':
      status = 400; code = 'INVALID_FILE_TYPE'; message = 'Invalid file type.'; break;
    default:
      // keep
      break;
  }

  // CSRF (if enabled elsewhere)
  if (err.code === 'EBADCSRFTOKEN') {
    status = 403; code = 'CSRF_TOKEN_INVALID'; message = 'Invalid or missing CSRF token.';
  }

  // Sequelize mapping
  if (err?.name === 'SequelizeUniqueConstraintError') {
    status = 409; code = 'UNIQUE_VIOLATION'; message = 'A unique field conflicts with an existing record.';
    details = err.errors?.map(e => ({ path: e.path, message: e.message, value: e.value }));
  }
  if (err?.name === 'SequelizeValidationError') {
    status = 400; code = 'MODEL_VALIDATION_FAILED'; message = 'Model validation failed.';
    details = err.errors?.map(e => ({ path: e.path, message: e.message, value: e.value }));
  }

  if (!Number.isFinite(status) || status < 400 || status > 599) status = 500;
  return { status, code, message, details };
}

export default function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = toPublicError(err);
  const reqId = req.id || req.headers['x-request-id'];

  const logPayload = { err, code, status, reqId, url: req.originalUrl, method: req.method };
  if (status >= 500) {
    req.log?.error(logPayload, 'Unhandled error');
    if (hasSentry()) {
      try {
        Sentry.captureException(err, {
          level: 'error',
          extra: {
            url: req.originalUrl,
            method: req.method,
            userId: req.session?.user?.id,
            role: req.session?.user?.role,
            reqId,
          },
        });
      } catch {}
    }
  } else {
    req.log?.warn(logPayload, 'Handled client error');
  }

  if (res.headersSent) return;

  if (req.method === 'HEAD') {
    res.status(status).end();
    return;
  }

  if (wantsJson(req)) {
    const body = { error: { code, message, requestId: reqId } };
    if (details) body.error.details = details;
    if (DEBUG_ERRORS && err?.stack) {
      body.error.stack = sanitizeStack(err.stack).split('\n');
    }
    res.status(status).json(body);
    return;
  }

  const accept = String(req.headers?.accept || '');
  const wantsHtml = accept.includes('text/html');
  if (wantsHtml) {
    const escape = (s) => String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const stackHtml = DEBUG_ERRORS && err?.stack
      ? `<pre style="white-space:pre-wrap">${escape(sanitizeStack(err.stack))}</pre>`
      : '';
    res
      .status(status)
      .type('html')
      .send(`<!doctype html>
<meta charset="utf-8">
<title>${status} ${escape(code)}</title>
<h1>${status} — ${escape(code)}</h1>
<p>${escape(message)}</p>
${reqId ? `<p><small>Request-Id: ${escape(reqId)}</small></p>` : ''}
${stackHtml}`);
    return;
  }

  res
    .status(status)
    .type('text/plain')
    .send(`${status} ${code}\n${message}${reqId ? `\nRequest-Id: ${reqId}` : ''}`);
}
