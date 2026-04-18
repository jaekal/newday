import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// Optional: post ZPL to a print proxy (e.g., local service)
let fetchFn = typeof fetch === 'function' ? fetch : null;
async function getFetch() {
  if (fetchFn) return fetchFn;
  const mod = await import('node-fetch');
  fetchFn = mod.default;
  return fetchFn;
}

const LABEL_DIRS = [
  path.resolve('config/labels'),
  path.resolve('config'),
].filter((p) => fsSync.existsSync(p));

const QUEUE_DIR = path.resolve('data/print_queue');

function compile(template, data = {}) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const parts = String(key).split('.');
    let v = data;
    for (const p of parts) v = v?.[p];
    return v == null ? '' : String(v);
  });
}

async function loadTemplateById(id) {
  if (!id) return null;
  for (const dir of LABEL_DIRS) {
    const p = path.join(dir, `${id}.zpl`);
    if (fsSync.existsSync(p)) return fs.readFile(p, 'utf8');
  }
  return null;
}

export async function buildZpl({ templateId, template, data = {}, copies = 1 }) {
  const tpl = template || (await loadTemplateById(templateId));
  if (!tpl) throw new Error('Label template not found');
  const one = compile(tpl, data);
  const count = Math.max(1, Number(copies) || 1);
  return Array(count).fill(one).join('\n');
}

export async function queueAndMaybeProxy(zpl) {
  await fs.mkdir(QUEUE_DIR, { recursive: true });
  const file = path.join(QUEUE_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}.zpl`);
  await fs.writeFile(file, zpl, 'utf8');

  let proxied = false;
  const target = process.env.PRINT_PROXY_URL || '';
  if (target) {
    try {
      const doFetch = await getFetch();
      const res = await doFetch(target, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: zpl });
      proxied = res.ok;
    } catch {}
  }
  return { file, proxied };
}
