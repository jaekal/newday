// services/projectsService.js
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { randomUUID } from 'crypto';

const DATA_DIRS = [
  path.resolve('data'),
  path.resolve('Data')
].filter(p => fsSync.existsSync(p));

const FILE = ['projects.json','Projects.json']
  .map(f => path.join(DATA_DIRS[0] || '.', f))
  .find(p => fsSync.existsSync(p)) || path.join(DATA_DIRS[0] || 'data', 'projects.json');

async function read() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function write(arr) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(arr, null, 2), 'utf8');
}

function now() { return new Date().toISOString(); }

export default {
  async list() {
    const items = await read();
    // Stable order: lane buckets, then createdAt
    const order = { backlog:0, todo:1, 'in-progress':2, blocked:3, done:4 };
    return items.slice().sort((a,b) =>
      (order[a.lane] - order[b.lane]) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    );
  },

  async create(payload, userId) {
    const items = await read();
    const item = {
      id: randomUUID(),
      title: payload.title,
      description: payload.description || '',
      lane: payload.lane || 'backlog',
      assignee: payload.assignee || '',
      priority: payload.priority || 'normal',
      dueDate: payload.dueDate || '',
      status: 'open',
      createdBy: userId || 'system',
      createdAt: now(),
      updatedAt: now(),
      history: [],
    };
    items.push(item);
    await write(items);
    return item;
  },

  async update(id, patch, userId) {
    const items = await read();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) throw new Error('Not found');
    const before = items[idx];
    const after = { ...before, ...patch, updatedAt: now() };
    after.history = (before.history || []).concat([{
      at: now(),
      by: userId || 'system',
      changes: Object.keys(patch),
    }]);
    items[idx] = after;
    await write(items);
    return after;
  },

  async remove(id, userId) {
    const items = await read();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return;
    const removed = items.splice(idx, 1)[0];
    await write(items);
    return { removedId: removed?.id, by: userId || 'system', at: now() };
  }
};
