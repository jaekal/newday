// src/middleware/csrf.js
// Lightweight session-based CSRF protection (no external deps).
// Uses the "synchronizer token" pattern: a random token is stored in the session
// and must be echoed back in every state-changing request body.

import { randomBytes } from 'crypto';

const TOKEN_BYTE_LENGTH = 24; // 32 base64 chars — plenty of entropy

/**
 * attachCsrfToken (use on EVERY response)
 * Generates a token for the session if one doesn't exist, then exposes it to
 * all EJS templates via res.locals.csrfToken.
 */
export function attachCsrfToken(req, res, next) {
  if (!req.session) return next(); // safety guard — session not initialised yet

  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
  }

  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/**
 * verifyCsrfToken (use on POST/PUT/PATCH/DELETE routes)
 * Rejects the request with 403 if the submitted _csrf token doesn't match the
 * one stored in the session.
 *
 * Safe methods (GET, HEAD, OPTIONS) are skipped automatically so you can safely
 * apply this globally after session middleware.
 */
export function verifyCsrfToken(req, res, next) {
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
  if (SAFE_METHODS.includes(req.method)) return next();

  const sessionToken = req.session?.csrfToken;
  const bodyToken    = req.body?._csrf || req.headers['x-csrf-token'];

  if (!sessionToken || !bodyToken || sessionToken !== bodyToken) {
    console.warn('CSRF VALIDATION FAILED →', {
      method: req.method,
      path: req.path,
      ip: req.ip,
      at: new Date().toISOString(),
    });

    // If the request expects HTML (form submission), re-render login with an error.
    // Otherwise respond with JSON.
    const acceptsHtml = (req.headers.accept || '').includes('text/html');
    if (acceptsHtml) {
      return res.status(403).render('auth/login', {
        error: 'Your session expired or the form was tampered with. Please try again.',
      });
    }

    return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
  }

  next();
}
