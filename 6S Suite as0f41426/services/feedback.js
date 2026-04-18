import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const SUG_FILE = path.join(DATA_DIR, 'suggestions.json');
const TKT_FILE = path.join(DATA_DIR, 'tickets.json');

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
ensure();

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function write(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

export function addSuggestion({ operatorId, category = '', text }) {
  const row = {
    id: crypto.randomUUID(),
    time: Date.now(),
    operatorId: String(operatorId || '').trim(),
    category: String(category || '').trim(),
    text: String(text || '').trim()
  };
  const arr = read(SUG_FILE, []);
  arr.push(row);
  write(SUG_FILE, arr);
  return row;
}

export function addTicket({ operatorId, category = 'Other', priority = 'Normal', description, imagePath = '' }) {
  const row = {
    id: crypto.randomUUID(),
    time: Date.now(),
    operatorId: String(operatorId || '').trim(),
    category: String(category || 'Other').trim(),
    priority: String(priority || 'Normal').trim(),
    description: String(description || '').trim(),
    imagePath
  };
  const arr = read(TKT_FILE, []);
  arr.push(row);
  write(TKT_FILE, arr);
  return row;
}
