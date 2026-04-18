// services/apiKeysService.js
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { randomUUID, randomBytes, createHash } from 'crypto';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.resolve(__dirname, '../data');
const FILE       = path.join(DATA_DIR, 'api_keys.json');

async function ensure() {
  if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
  if (!fsSync.existsSync(FILE)) await fs.writeFile(FILE, '[]', 'utf8');
}
async function readAll() {
  await ensure();
  const raw = await fs.readFile(FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // If the file is corrupted, back it up and start fresh
    try { await fs.writeFile(FILE + '.corrupt', raw, 'utf8'); } catch {}
    await fs.writeFile(FILE, '[]', 'utf8');
    return [];
  }
}
async function writeAll(arr) {
  await ensure();
  await fs.writeFile(FILE, JSON.stringify(arr, null, 2), 'utf8');
}

function hashKey(k) {
  return createHash('sha256').update(String(k || ''), 'utf8').digest('hex');
}

function sanitizeScopes(scopes = []) {
  return Array.from(new Set(scopes.map(s => String(s).trim()).filter(Boolean)));
}

function redactRecord(rec) {
  // Hide sensitive material in UI-facing listings
  const { secret, keyHash, ...rest } = rec || {};
  return { ...rest, secret: '***' };
}

export default {
  /** Raw list (includes secret/keyHash). Prefer listRedacted() for UIs. */
  async list() {
    return readAll();
  },

  /** Redacted list for admin UIs (no keyHash; masked secret). */
  async listRedacted() {
    const all = await readAll();
    return all.map(redactRecord);
  },

  /** Create a key; returns {record, key, secret} (key/secret shown once) */
  async create({ name, scopes = [] } = {}) {
    const key    = `ak_${randomBytes(24).toString('base64url')}`;
    const secret = randomBytes(32).toString('hex');

    const rec = {
      id: randomUUID(),
      name: String(name || 'Unnamed'),
      keyHash: hashKey(key),
      secret, // used for HMAC verification; stored here, protect the file
      scopes: sanitizeScopes(scopes),
      revoked: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };

    const all = await readAll();
    all.push(rec);
    await writeAll(all);

    // Return the cleartext key/secret once so caller can display/copy them
    return { record: rec, key, secret };
  },

  async revoke(id) {
    const all = await readAll();
    const i = all.findIndex(x => x.id === id);
    if (i === -1) return false;
    all[i].revoked = true;
    await writeAll(all);
    return true;
  },

  async rotateSecret(id) {
    const all = await readAll();
    const i = all.findIndex(x => x.id === id);
    if (i === -1) throw new Error('Not found');
    all[i].secret = crypto.randomBytes(32).toString('hex');
    await writeAll(all);
    return { id, secret: all[i].secret };
  },

  async verifyKey(rawKey) {
    const h = hashKey(rawKey);
    const all = await readAll();
    const rec = all.find(x => x.keyHash === h);
    return rec || null;
  },

  async touch(id) {
    const all = await readAll();
    const i = all.findIndex(x => x.id === id);
    if (i === -1) return;
    all[i].lastUsedAt = new Date().toISOString();
    await writeAll(all);
  },
};
