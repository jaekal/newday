/**
 * public/cf/management/management.js
 * Command Floor — Management page module.
 *
 * Operational rollups, 14-day pipeline charts, kiosk suggestions,
 * delayed work, and suite activity preview (audit log).
 */
'use strict';

import { startLiveClock, fmtTime } from '/cf/cf-shell.js';

const $ = (id) => document.getElementById(id);

let activeBuilding = (() => {
  try { return localStorage.getItem('suite.building.v1') || 'Bldg-350'; }
  catch { return 'Bldg-350'; }
})();

let managementMetrics = null;
let expirationSummary = { overdue: 0, soon: 0 };
let lastCommandInsights = null;

const COL = {
  todo: '#64748B',
  doing: '#0096B4',
  blocked: '#E36414',
  done: '#22C55E',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prepareCanvas(canvas, cssH) {
  const parent = canvas.parentElement;
  const w = Math.max(320, parent?.clientWidth || 600);
  const h = cssH || 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Stacked bars: one stack per day, four buckets bottom-up. */
function drawPipelineTrend(canvas, labels, series) {
  if (!canvas || !series) return;
  const todo = series.todo || [];
  const doing = series.doing || [];
  const blocked = series.blocked || [];
  const done = series.done || [];
  const n = Math.max(labels?.length || 0, todo.length, doing.length, blocked.length, done.length);
  if (!n) return;

  const { ctx, w, h } = prepareCanvas(canvas, 220);
  ctx.clearRect(0, 0, w, h);
  const padL = 36;
  const padR = 8;
  const padB = 28;
  const padT = 8;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const totals = [];
  for (let i = 0; i < n; i++) {
    totals.push((todo[i] || 0) + (doing[i] || 0) + (blocked[i] || 0) + (done[i] || 0));
  }
  const maxT = Math.max(1, ...totals);

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(padL, padT, chartW, chartH);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = padT + (chartH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
  }

  const slot = chartW / n;
  const barW = Math.max(4, slot * 0.62);

  const stacks = [
    { key: 'todo', color: COL.todo, arr: todo },
    { key: 'doing', color: COL.doing, arr: doing },
    { key: 'blocked', color: COL.blocked, arr: blocked },
    { key: 'done', color: COL.done, arr: done },
  ];

  for (let i = 0; i < n; i++) {
    const cx = padL + i * slot + slot / 2;
    let yBase = padT + chartH;
    for (const seg of stacks) {
      const v = seg.arr[i] || 0;
      if (!v) continue;
      const bh = (v / maxT) * chartH;
      ctx.fillStyle = seg.color;
      ctx.fillRect(cx - barW / 2, yBase - bh, barW, bh);
      yBase -= bh;
    }
  }

  ctx.fillStyle = '#64748B';
  ctx.font = '10px IBM Plex Sans, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1 && n > 10) continue;
    const lab = labels[i] || '';
    ctx.fillText(lab, padL + i * slot + slot / 2, h - 10);
  }

  ctx.textAlign = 'right';
  ctx.fillText(String(maxT), padL - 4, padT + 10);
}

/** Single horizontal stacked bar for bucket totals. */
function drawBucketMix(canvas, buckets) {
  if (!canvas || !buckets) return;
  const { ctx, w, h } = prepareCanvas(canvas, 180);
  ctx.clearRect(0, 0, w, h);
  const order = [
    { k: 'todo', c: COL.todo },
    { k: 'doing', c: COL.doing },
    { k: 'blocked', c: COL.blocked },
    { k: 'done', c: COL.done },
  ];
  let sum = 0;
  for (const { k } of order) sum += Number(buckets[k] || 0);
  if (sum < 1) {
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(16, h / 2 - 8, w - 32, 16);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '12px IBM Plex Sans, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No project tasks in scope', w / 2, h / 2 + 4);
    return;
  }

  let x = 16;
  const barH = 28;
  const totalW = w - 32;
  for (const { k, c } of order) {
    const v = Number(buckets[k] || 0);
    if (!v) continue;
    const segW = (v / sum) * totalW;
    ctx.fillStyle = c;
    ctx.fillRect(x, h / 2 - barH / 2, segW, barH);
    if (segW > 36) {
      ctx.fillStyle = '#fff';
      ctx.font = '11px IBM Plex Sans, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x + segW / 2, h / 2 + 4);
    }
    x += segW;
  }
}

/** Line chart for daily counts. */
function drawActivitySpark(canvas, labels, counts) {
  if (!canvas || !counts?.length) return;
  const { ctx, w, h } = prepareCanvas(canvas, 160);
  ctx.clearRect(0, 0, w, h);
  const padL = 32;
  const padR = 8;
  const padB = 22;
  const padT = 12;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const maxV = Math.max(1, ...counts);
  const n = counts.length;

  ctx.fillStyle = 'rgba(0, 180, 216, 0.12)';
  ctx.beginPath();
  ctx.moveTo(padL, padT + ch);
  for (let i = 0; i < n; i++) {
    const x = padL + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
    const y = padT + ch - (counts[i] / maxV) * ch;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(padL + cw, padT + ch);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#0096B4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = padL + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
    const y = padT + ch - (counts[i] / maxV) * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '10px IBM Plex Sans, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1 && n > 10) continue;
    const lab = labels[i] || '';
    ctx.fillText(lab, padL + (n === 1 ? cw / 2 : (i / (n - 1)) * cw), h - 6);
  }
  ctx.textAlign = 'right';
  ctx.fillText(String(maxV), padL - 4, padT + 10);
}

function updateDeepLinks() {
  const b = activeBuilding || 'Bldg-350';
  const q = encodeURIComponent(b);
  const links = {
    'mgmt-tools-link': `/cf/tools?building=${q}`,
    'mgmt-audits-link': `/projects?domain=audit&building=${q}`,
    'mgmt-projects-link': `/projects?qfilter=overdue&building=${q}`,
    'mgmt-cal-link': `/expiration?building=${q}`,
  };
  for (const [id, href] of Object.entries(links)) {
    const el = $(id);
    if (el) el.href = href;
  }

  const pressure = $('mgmtPressureStats');
  if (pressure) {
    pressure.querySelectorAll('[data-href]').forEach((a) => {
      const base = a.getAttribute('data-href');
      if (base) a.href = `${base}${base.includes('?') ? '&' : '?'}building=${q}`;
    });
  }
}

function renderKpiBars(metrics) {
  const tools = metrics?.totalTools ?? 0;
  const out = metrics?.checkedOut ?? 0;
  const audits = metrics?.openAudits ?? 0;
  const overdueP = metrics?.overdueProjects ?? 0;
  const cal = expirationSummary.overdue;

  const tPct = tools > 0 ? Math.min(100, (out / tools) * 100) : 0;
  const bt = $('bar-mgmt-tools');
  if (bt) bt.style.width = `${tPct}%`;
  const ba = $('bar-mgmt-audits');
  if (ba) ba.style.width = `${Math.min(100, audits * 10)}%`;
  const bp = $('bar-mgmt-projects');
  if (bp) bp.style.width = `${Math.min(100, overdueP * 10)}%`;
  const calPct = cal > 0 ? Math.min(100, cal * 5) : (expirationSummary.soon > 0 ? 40 : 0);
  const bc = $('bar-mgmt-cal');
  if (bc) bc.style.width = `${calPct}%`;
}

function renderPressureStrip(metrics) {
  const b = activeBuilding || 'Bldg-350';
  const q = encodeURIComponent(b);
  const wrap = $('mgmtPressureStats');
  if (!wrap) return;

  const blocked = metrics?.blockedTasks ?? 0;
  const openA = metrics?.openAudits ?? 0;
  const overdueA = metrics?.audits?.overdue ?? 0;
  const overdueP = metrics?.overdueProjects ?? 0;

  wrap.innerHTML = `
    <a class="cf-mgmt-stat" data-href="/projects?domain=project&bucket=blocked" href="/projects?domain=project&bucket=blocked&building=${q}" style="text-decoration:none;color:inherit">
      <div class="cf-mgmt-stat-n">${blocked}</div>
      <div class="cf-mgmt-stat-l">Blocked (projects + audits)</div>
    </a>
    <a class="cf-mgmt-stat" data-href="/projects?domain=audit" href="/projects?domain=audit&building=${q}" style="text-decoration:none;color:inherit">
      <div class="cf-mgmt-stat-n">${openA}</div>
      <div class="cf-mgmt-stat-l">Open audits</div>
    </a>
    <a class="cf-mgmt-stat" data-href="/projects?domain=audit&qfilter=overdue" href="/projects?domain=audit&qfilter=overdue&building=${q}" style="text-decoration:none;color:inherit">
      <div class="cf-mgmt-stat-n">${overdueA}</div>
      <div class="cf-mgmt-stat-l">Overdue audits</div>
    </a>
    <a class="cf-mgmt-stat" data-href="/projects?qfilter=overdue" href="/projects?qfilter=overdue&building=${q}" style="text-decoration:none;color:inherit">
      <div class="cf-mgmt-stat-n">${overdueP}</div>
      <div class="cf-mgmt-stat-l">Overdue projects</div>
    </a>
  `;
}

function renderDelayedTable(metrics) {
  const body = $('mgmtDelayedBody');
  if (!body) return;
  const rows = metrics?.delayedTickets || [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3" style="color:var(--cf-faint);font-size:12px">No delayed dated projects in this building.</td></tr>`;
    return;
  }
  const b = encodeURIComponent(activeBuilding || 'Bldg-350');
  body.innerHTML = rows.slice(0, 8).map((t) => {
    const href = `/projects?domain=project&q=${encodeURIComponent(t.id || '')}&building=${b}`;
    return `<tr>
      <td>${esc(t.dueDate || '—')}</td>
      <td><a href="${esc(href)}">${esc(t.title || t.id || 'Task')}</a></td>
      <td>${esc(t.bucket || '')}</td>
    </tr>`;
  }).join('');
}

function renderSuggestionsTable(lines) {
  const body = $('mgmtSugBody');
  if (!body) return;
  const items = Array.isArray(lines) ? lines.slice(-12).reverse() : [];
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="3" style="color:var(--cf-faint);font-size:12px">No kiosk suggestions on file.</td></tr>`;
    return;
  }
  const b = encodeURIComponent(activeBuilding || 'Bldg-350');
  body.innerHTML = items.map((s) => {
    const when = (s.at || '').replace('T', ' ').slice(0, 16);
    const sum = (s.text || '').slice(0, 80) + ((s.text || '').length > 80 ? '…' : '');
    const taskHref = `/projects?domain=project&q=${encodeURIComponent(s.id || '')}&building=${b}`;
    return `<tr>
      <td>${esc(when)}</td>
      <td><a href="${esc(taskHref)}">${esc(sum || 'Suggestion')}</a></td>
      <td>${esc(s.status || '—')}</td>
    </tr>`;
  }).join('');
}

function renderActivityList(preview) {
  const ul = $('mgmtActivityList');
  if (!ul) return;
  const items = Array.isArray(preview) ? preview : [];
  if (!items.length) {
    ul.innerHTML = '<li style="color:var(--cf-faint);padding:12px">No audit log entries in the last 7 days.</li>';
    return;
  }
  ul.innerHTML = items.map((it) => {
    const line = it.summary || it.action || it.path || 'Event';
    const who = it.actorName || it.actorId || '';
    const when = fmtTime(it.time || '');
    const meta = [when, who, it.module].filter(Boolean);
    return `<li>
      <div>${esc(line)}</div>
      <div class="cf-mgmt-activity-meta">${meta.map((p) => esc(p)).join(' · ')}</div>
    </li>`;
  }).join('');
}

function renderChartsFromMetrics(metrics) {
  const trend = metrics?.trend;
  if (trend?.labels && trend?.series) {
    drawPipelineTrend($('mgmtTrendCanvas'), trend.labels, trend.series);
  }
  const buckets = metrics?.buckets || metrics?.projects?.byBucket;
  if (buckets) {
    const sum = (buckets.todo || 0) + (buckets.doing || 0) + (buckets.blocked || 0) + (buckets.done || 0);
    const el = $('mgmtBucketTotal');
    if (el) el.textContent = `${sum} tasks`;
    drawBucketMix($('mgmtBucketCanvas'), buckets);
  }
}

async function loadCommandInsights() {
  try {
    const res = await fetch('/management/api/command-insights', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    lastCommandInsights = data;
    if (data.activityTrend?.labels && data.activityTrend?.counts) {
      drawActivitySpark($('mgmtActivitySparkCanvas'), data.activityTrend.labels, data.activityTrend.counts);
    }
    renderActivityList(data.preview);
  } catch {
    /* noop */
  }
}

async function loadKioskSuggestions() {
  try {
    const res = await fetch('/kiosk/suggestions', { credentials: 'include' });
    const lines = res.ok ? await res.json() : [];
    renderSuggestionsTable(lines);
  } catch {
    renderSuggestionsTable([]);
  }
}

async function loadDashboard() {
  try {
    const res = await fetch(
      `/management/api/metrics?building=${encodeURIComponent(activeBuilding)}`,
      { credentials: 'include' }
    );
    managementMetrics = res.ok ? await res.json() : null;
  } catch {
    managementMetrics = null;
  }

  try {
    const res = await fetch(
      `/expiration/api?days=30&building=${encodeURIComponent(activeBuilding)}`,
      { credentials: 'include' }
    );
    const data = res.ok ? await res.json() : [];
    const items = Array.isArray(data) ? data : [];
    expirationSummary = {
      overdue: items.filter((item) => item.status === 'overdue').length,
      soon: items.filter((item) => item.status === 'due-soon').length,
    };
  } catch {
    expirationSummary = { overdue: 0, soon: 0 };
  }

  $('mgmt-tools-out').textContent = `${managementMetrics?.checkedOut ?? 0}`;
  $('mgmt-audits-open').textContent = `${managementMetrics?.openAudits ?? 0}`;
  $('mgmt-projects-overdue').textContent = `${managementMetrics?.overdueProjects ?? 0}`;
  $('mgmt-cal-overdue').textContent = `${expirationSummary.overdue}`;

  $('mgmt-cal-note').textContent = expirationSummary.overdue > 0
    ? `${expirationSummary.overdue} overdue, ${expirationSummary.soon} due soon (30d).`
    : expirationSummary.soon > 0
      ? `${expirationSummary.soon} due soon (30d).`
      : 'No upcoming expiration pressure.';

  $('mgmtStamp').textContent = `updated ${fmtTime(new Date().toISOString())}`;
  renderKpiBars(managementMetrics);
  renderChartsFromMetrics(managementMetrics);
  renderPressureStrip(managementMetrics);
  renderDelayedTable(managementMetrics);
  updateDeepLinks();
}

function setupActivityAdminLink() {
  const a = $('mgmtActAdminLink');
  if (!a) return;
  fetch('/api/whoami', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const role = String(data?.user?.role || '').toLowerCase();
      if (role === 'admin') {
        a.href = '/admin/activity';
        a.style.display = '';
      } else {
        a.textContent = '7-day excerpt';
        a.removeAttribute('href');
        a.style.pointerEvents = 'none';
        a.style.color = 'var(--cf-faint)';
      }
    })
    .catch(() => {
      a.textContent = '7-day excerpt';
      a.removeAttribute('href');
    });
}

function updateUserAvatar() {
  const avatarEl = $('cfAvatar');
  if (!avatarEl) return;
  fetch('/api/whoami', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const name = data?.user?.name || data?.user?.username || '';
      const initials = name
        .split(/\s+/)
        .map((n) => n[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
      if (initials) avatarEl.textContent = initials;
    })
    .catch(() => {});
}

function connectSocket() {
  try {
    const socket = window.io?.('/', { withCredentials: true });
    if (!socket) return;
    ['assetsUpdated', 'toolsUpdated', 'projectsUpdated', 'expirationUpdated', 'kiosk:suggestion.created'].forEach((evt) => {
      socket.on(evt, () => {
        loadDashboard();
        loadCommandInsights();
        loadKioskSuggestions();
      });
    });
  } catch (err) {
    console.warn('[CF Management] socket unavailable:', err);
  }
}

function onResize() {
  if (managementMetrics) renderChartsFromMetrics(managementMetrics);
  if (lastCommandInsights?.activityTrend?.labels && lastCommandInsights?.activityTrend?.counts) {
    drawActivitySpark(
      $('mgmtActivitySparkCanvas'),
      lastCommandInsights.activityTrend.labels,
      lastCommandInsights.activityTrend.counts
    );
  }
}

function onBuildingChange() {
  try {
    const next = localStorage.getItem('suite.building.v1') || 'Bldg-350';
    if (next !== activeBuilding) {
      activeBuilding = next;
      loadDashboard();
    }
  } catch { /* noop */ }
}

async function initPage() {
  startLiveClock();
  updateUserAvatar();
  setupActivityAdminLink();
  await Promise.all([loadDashboard(), loadCommandInsights(), loadKioskSuggestions()]);
  connectSocket();

  window.addEventListener('resize', () => {
    clearTimeout(window.__cfMgmtResize);
    window.__cfMgmtResize = setTimeout(onResize, 150);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'suite.building.v1') onBuildingChange();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadDashboard();
      loadCommandInsights();
      loadKioskSuggestions();
    }
  });
}

initPage();
