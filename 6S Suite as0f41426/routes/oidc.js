// routes/oidc.js
import express from 'express';
// Import as a namespace so it works whether openid-client is CJS or ESM
import * as OpenID from 'openid-client';
import { attachUserToLocals } from '../middleware/auth.js';
import { resolvePostLoginNext } from '../utils/postLoginNext.js';

const router = express.Router();

// Helper to get Issuer & generators from either ESM or CJS shape
function getOIDCExports() {
  const Issuer = OpenID.Issuer || OpenID.default?.Issuer;
  const generators = OpenID.generators || OpenID.default?.generators;
  return { Issuer, generators };
}

// Lazy-initialize the client (cached after first use)
let clientPromise = null;
async function getClient() {
  const { Issuer } = getOIDCExports();
  const ISSUER = process.env.OIDC_ISSUER;
  const CLIENT_ID = process.env.OIDC_CLIENT_ID;
  const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
  const REDIRECT_URI = process.env.OIDC_REDIRECT_URI;

  // If OIDC env isn’t configured, disable gracefully
  if (!ISSUER || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) return null;

  if (!Issuer) {
    // Library present but not exposing expected API
    throw new Error('openid-client could not be loaded (Issuer export missing). Check your installed version.');
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      const issuer = await Issuer.discover(ISSUER);
      return new issuer.Client({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uris: [REDIRECT_URI],
        response_types: ['code'],
      });
    })();
  }
  return clientPromise;
}

function mapRole(claims = {}) {
  const roleClaim = process.env.OIDC_ROLE_CLAIM || 'roles';
  const rawMap = process.env.OIDC_ROLE_MAP || '';
  let map = {};
  try { map = rawMap ? JSON.parse(rawMap) : {}; } catch {}
  const candidate = claims[roleClaim];
  const roles = Array.isArray(candidate) ? candidate : (candidate ? [candidate] : []);
  for (const r of roles) {
    const m = map[String(r)] || map[String(r).toLowerCase()];
    if (m) return String(m).toLowerCase();
  }
  return 'user';
}

router.get('/login', async (req, res, next) => {
  try {
    const client = await getClient();
    if (!client) return res.status(501).send('OIDC not configured');

    const { generators } = getOIDCExports();
    if (!generators) throw new Error('openid-client generators export missing');

    const state = generators.state();
    const nonce = generators.nonce();
    req.session.oidc = { state, nonce };
    const scopes = process.env.OIDC_SCOPES || 'openid profile email';

    const url = client.authorizationUrl({
      scope: scopes,
      state,
      nonce,
    });
    res.redirect(url);
  } catch (e) { next(e); }
});

router.get('/callback', attachUserToLocals, async (req, res, next) => {
  try {
    const client = await getClient();
    if (!client) return res.status(501).send('OIDC not configured');

    const params = client.callbackParams(req);
    const { state, nonce } = req.session.oidc || {};
    if (!state || state !== params.state) return res.status(400).send('State mismatch');

    const tokenSet = await client.callback(process.env.OIDC_REDIRECT_URI, params, { state, nonce });
    const claims = tokenSet.claims();

    const id = String(claims.email || claims.preferred_username || claims.sub || '').trim();
    if (!id) return res.status(400).send('Missing subject');

    const role = mapRole(claims);

    // Preserve the state values we'll need after regenerate(), then swap
    // session IDs so a pre-auth fixation attempt cannot re-use the old id.
    const nextUrl = resolvePostLoginNext(role, req.query.next || '');

    try {
      await new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
    } catch (e) {
      req.log?.warn?.({ e }, 'session regenerate failed during OIDC callback');
    }

    req.session.user = { id, role };
    req.session.authenticatedAt = new Date().toISOString();

    try { delete req.session.oidc; } catch {}

    try {
      await new Promise((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });
    } catch (e) {
      req.log?.error?.({ e }, 'session save failed after OIDC callback');
      return res.status(500).send('Login session could not be persisted');
    }

    res.redirect(nextUrl);
  } catch (e) { next(e); }
});

export default router;
