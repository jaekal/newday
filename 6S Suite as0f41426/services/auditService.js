// services/auditsService.js
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';

const DATA_DIRS = [path.resolve('data'), path.resolve('Data')].filter(p => fsSync.existsSync(p));
const FILE = ['audits.json','Audits.json']
  .map(f => path.join(DATA_DIRS[0] || '.', f))
  .find(p => fsSync.existsSync(p)) || path.join(DATA_DIRS[0] || 'data', 'audits.json');

const DEFAULT = {
  config: {
    daily: [
      { id:'6s-sweep', label:'Sweep area clean (6S Shine)' },
      { id:'wip-labeled', label:'WIP labeled and in WIP zones' },
      { id:'trash-emptied', label:'Trash & recycling emptied' },
    ],
    weekly: [
      { id:'shadow-board', label:'Shadow boards complete and labeled' },
      { id:'ppe-stock', label:'PPE stock verified' },
      { id:'safety-inspection', label:'Safety inspection walk' },
    ]
  },
  submissions: []
};

async function read() {
  try {
    const raw = await fs.readFile(FILE,'utf8');
    const json = JSON.parse(raw);
    // merge defaults for config keys if missing
    return { ...DEFAULT, ...json, config: { ...DEFAULT.config, ...(json.config || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}
async function write(data) {
  await fs.mkdir(path.dirname(FILE), { recursive:true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), 'utf8');
}
function now() { return new Date().toISOString(); }

export default {
  async getChecklist(period='daily') {
    const d = await read();
    return (d.config?.[period] || []).map(x => ({ ...x }));
  },

  async submit({ period, shift, responses }, user) {
    const d = await read();
    d.submissions.push({
      id: `${period}-${Date.now()}`,
      period,
      shift: shift || '',
      by: user?.id || 'system',
      at: now(),
      responses: responses.map(r => ({ id:r.id, ok: !!r.ok, note: r.note || '' }))
    });
    await write(d);
    return { ok:true };
  },

  async history() {
    const d = await read();
    return d.submissions.slice().reverse();
  }
};
