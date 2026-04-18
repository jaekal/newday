// public/js/expiration/main.js
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

// Optional live updates if Socket.IO client is present
const socket = window.io?.();
socket?.on?.('auditUpdated', () => load().catch(()=>{}));

const daysSel = $('#days');
const typeSel = $('#type');
const listEl  = $('#list');
const calEl   = $('#calendar');
const kOver   = $('#k-overdue');
const kDue    = $('#k-due');
const kOk     = $('#k-ok');
const kTot    = $('#k-total');
const btnRef  = $('#refresh');

async function fetchJSON(u) {
  const r = await fetch(u, { credentials: 'include', headers: { 'Accept':'application/json' } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function esc(s){ return (s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function fmt(dISO){ return dISO ? new Date(dISO).toLocaleDateString() : '-'; }
function daysLeft(dISO){
  if (!dISO) return null;
  const ms = new Date(dISO) - Date.now();
  return Math.ceil(ms / 86400000);
}

function renderKpis(data) {
  const c = { overdue:0, 'due-soon':0, ok:0 };
  for (const it of data) if (c[it.status] != null) c[it.status]++;
  kOver.textContent = `Overdue: ${c.overdue}`;
  kDue.textContent  = `Due Soon: ${c['due-soon']}`;
  kOk.textContent   = `OK: ${c.ok}`;
  kTot.textContent  = `Total: ${data.length}`;
}

function itemRow(it){
  const li = document.createElement('div');
  li.className = 'item';
  const dLeft = daysLeft(it.dueDate);
  const leftTxt = dLeft == null ? '' : ` • ${dLeft}d`;
  const typeIc =
    typeof window !== 'undefined' && window.suiteIcons?.expirationTypeIcon
      ? `<span style="display:inline-flex;vertical-align:middle;margin-right:5px">${window.suiteIcons.expirationTypeIcon(it.type === 'tool', 14)}</span>`
      : '';
  li.innerHTML = `
    <div>
      <div><strong>${typeIc}${esc(it.label)}</strong></div>
      <div class="meta">
        ${it.type === 'tool'
          ? `Slot: ${esc(it.meta?.slot || '-')}&nbsp;•&nbsp;Torque: ${esc(it.meta?.torque || '-')}`
          : `Cat: ${esc(it.meta?.category || '-')}&nbsp;•&nbsp;Loc: ${esc(it.meta?.location || '-')}`}
      </div>
    </div>
    <div class="text-right">
      <div>${fmt(it.dueDate)}${leftTxt}</div>
      <div class="pill ${esc(it.status)}" style="display:inline-block;margin-top:.25rem">${esc(it.status)}</div>
    </div>
  `;
  return li;
}

function renderList(data) {
  listEl.innerHTML = '';
  // soonest first; unknowns last
  const sorted = data.slice().sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  for (const it of sorted) listEl.appendChild(itemRow(it));
}

function monthLabel(key){
  const [y, m] = key.split('-').map(Number);
  return new Date(y, (m||1)-1, 1).toLocaleString([], { month:'long', year:'numeric' });
}

function renderCalendar(map, filterType) {
  calEl.innerHTML = '';
  const keys = Object.keys(map).sort();
  for (const key of keys) {
    const monthItems = filterType ? map[key].filter(x => x.type === filterType) : map[key];
    if (!monthItems.length) continue;

    const sec = document.createElement('section');
    sec.className = 'month';
    const h = document.createElement('h3'); h.textContent = monthLabel(key);
    sec.appendChild(h);

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none'; ul.style.padding = '0'; ul.style.margin = '0';

    const sorted = monthItems.slice().sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    for (const it of sorted) {
      const li = document.createElement('li');
      li.className = 'item';
      const dLeft = daysLeft(it.dueDate);
      const calTypeIc =
        typeof window !== 'undefined' && window.suiteIcons?.expirationTypeIcon
          ? `<span style="display:inline-flex;vertical-align:middle;margin-right:5px">${window.suiteIcons.expirationTypeIcon(it.type === 'tool', 13)}</span>`
          : '';
      li.innerHTML = `
        <div class="flex justify-between items-center w-full">
          <div>${fmt(it.dueDate)} — ${calTypeIc}${esc(it.label)}</div>
          <div>
            <span class="pill ${esc(it.status)}">${esc(it.status)}</span>
            ${dLeft == null ? '' : `<span class="meta" style="margin-left:.4rem">${dLeft}d</span>`}
          </div>
        </div>`;
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    calEl.appendChild(sec);
  }
}

async function load() {
  btnRef?.setAttribute('disabled','disabled');

  const days  = Number(daysSel?.value || 90);
  const type  = typeSel?.value || '';

  const all = await fetchJSON(`/expiration/api?days=${encodeURIComponent(days)}`);
  const filtered = type ? all.filter(x => x.type === type) : all;

  renderList(filtered);
  renderKpis(filtered);

  // calendar months tied to selection (approx)
  const months = Math.max(1, Math.ceil(days / 30));
  const cal = await fetchJSON(`/expiration/api/calendar?months=${encodeURIComponent(months)}`);
  renderCalendar(cal, type);

  btnRef?.removeAttribute('disabled');
}

daysSel?.addEventListener('change', () => load().catch(()=>{}));
typeSel?.addEventListener('change', () => load().catch(()=>{}));
btnRef?.addEventListener('click', async () => {
  try { await fetch('/expiration/refresh', { method:'POST', credentials:'include' }); } catch {}
  load().catch(()=>{});
});

document.addEventListener('DOMContentLoaded', () => load().catch(console.error));
