/**
 * public/notifications/bell.js
 * ─────────────────────────────
 * Notification bell that persists alerts across all modules.
 *
 * Listens to Socket.IO events already emitted by the server:
 *   toolsUpdated, inventoryUpdated, auditUpdated, projectsUpdated, assetsUpdated
 *
 * Also polls /management/api/metrics to detect new overdue/low-stock conditions.
 *
 * Usage — add to any page AFTER socket.io loads:
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/notifications/bell.js"></script>
 *
 * The bell button is automatically appended to .suite-actions inside .suite-topbar,
 * or as a fixed bottom-right FAB if no topbar is found.
 */

(function () {
  'use strict';

  if (document.getElementById('suite-notif-bell')) return;

  /* ─── Storage key ────────────────────────────────────────────────── */
  const STORE_KEY = 'suite_notifications_v1';
  const MAX_NOTIFICATIONS = 80;

  /* ─── Persistence ────────────────────────────────────────────────── */
  function loadNotifications() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveNotifications(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_NOTIFICATIONS))); }
    catch {}
  }

  let _notifs = loadNotifications();
  let _panelOpen = false;

  /* ─── Styles ─────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    #suite-notif-bell {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      width: 2rem; height: 2rem; border-radius: var(--radius-sm, .4rem);
      border: 1px solid var(--border, #ddd);
      background: transparent; cursor: pointer; color: var(--fg-muted, #888);
      font-size: .95rem; transition: background .15s, color .15s;
    }
    #suite-notif-bell:hover { background: var(--surface-strong, #f8f8f8); color: var(--fg, #111); }

    #suite-notif-badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 16px; height: 16px; padding: 0 4px;
      background: var(--danger, #e53e3e); color: var(--accent-contrast);
      border-radius: 999px; font-size: .68rem; font-weight: 800;
      display: none; align-items: center; justify-content: center;
      line-height: 1;
    }
    #suite-notif-badge.visible { display: flex; }

    #suite-notif-panel {
      position: absolute; top: calc(100% + .5rem); right: 0;
      width: 360px; max-width: 95vw;
      background: var(--surface-strong, #fff); color: var(--fg, #111);
      border: 1px solid var(--border, #ddd); border-radius: .75rem;
      box-shadow: 0 16px 48px rgba(0,0,0,.22);
      z-index: 9000; display: none; flex-direction: column;
      overflow: hidden;
    }
    #suite-notif-panel.open { display: flex; }

    .sn-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: .65rem 1rem;
      border-bottom: 1px solid var(--border, #ddd);
      font-weight: 700; font-size: .95rem;
    }
    .sn-clear {
      font-size: .78rem; font-weight: 600; color: var(--danger, #e53e3e);
      border: none; background: transparent; cursor: pointer; padding: .2rem .4rem;
      border-radius: .3rem;
    }
    .sn-clear:hover { background: var(--danger-bg, #fff0f0); }

    .sn-list { overflow-y: auto; max-height: 380px; }

    .sn-item {
      display: flex; align-items: flex-start; gap: .6rem;
      padding: .65rem 1rem;
      border-bottom: 1px solid var(--border, #eee);
      cursor: pointer; transition: background .1s;
    }
    .sn-item:last-child { border-bottom: none; }
    .sn-item:hover { background: var(--row-hover, rgba(59,130,246,.07)); }
    .sn-item.unread { background: var(--info-bg, #e8f4fd); }
    .sn-item.unread:hover { background: var(--row-hover, rgba(59,130,246,.12)); }

    .sn-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: .1rem; color: var(--fg-muted, #888); }
    .sn-icon svg { display: block; }
    .sn-icon-emoji { font-size: 1.15rem; line-height: 1; }
    .sn-body { flex: 1; min-width: 0; }
    .sn-title { font-size: .87rem; font-weight: 600; }
    .sn-desc  { font-size: .8rem; color: var(--fg-muted, #888); margin-top: .1rem; }
    .sn-time  { font-size: .73rem; color: var(--fg-muted, #999); margin-top: .2rem; }

    .sn-empty { padding: 2rem; text-align: center; color: var(--fg-muted, #888); font-size: .9rem; }

    /* FAB fallback if no topbar */
    .suite-notif-fab {
      position: fixed; bottom: 1.25rem; right: 1.25rem; z-index: 8999;
    }
    .suite-notif-fab #suite-notif-panel {
      bottom: calc(100% + .5rem); top: auto; right: 0;
    }
  `;
  document.head.appendChild(style);

  /* ─── Bell button DOM ────────────────────────────────────────────── */
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-flex;';

  const bell = document.createElement('button');
  bell.id = 'suite-notif-bell';
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notifications');
  bell.setAttribute('title', 'Notifications');
  bell.innerHTML = window.suiteIcons
    ? window.suiteIcons.icons.bell(18)
    : '<span class="sn-icon-emoji" aria-hidden="true">🔔</span>';

  const badge = document.createElement('span');
  badge.id = 'suite-notif-badge';
  badge.textContent = '0';
  bell.appendChild(badge);

  const panel = document.createElement('div');
  panel.id = 'suite-notif-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Notification panel');
  panel.innerHTML = `
    <div class="sn-panel-header">
      <span>Notifications</span>
      <button class="sn-clear" id="sn-mark-read">Mark all read</button>
    </div>
    <div class="sn-list" id="sn-list"></div>
  `;

  wrapper.appendChild(bell);
  wrapper.appendChild(panel);

  /* ─── Mount: prefer .suite-actions in topbar, else fixed FAB ────── */
  function mount() {
    const actions = document.querySelector('.suite-topbar .suite-actions');
    if (actions) {
      actions.insertBefore(wrapper, actions.querySelector('.theme-select') || null);
    } else {
      wrapper.classList.add('suite-notif-fab');
      document.body.appendChild(wrapper);
    }
  }

  /* ─── Render panel list ──────────────────────────────────────────── */
  function relativeTime(isoStr) {
    const diff = Date.now() - new Date(isoStr).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(isoStr).toLocaleDateString();
  }

  function renderPanel() {
    const list = document.getElementById('sn-list');
    if (!list) return;

    const unread = _notifs.filter(n => !n.read).length;

    // Update badge
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }

    // Render list
    if (_notifs.length === 0) {
      list.innerHTML = '<div class="sn-empty">No notifications yet</div>';
      return;
    }

    list.innerHTML = '';
    for (const n of _notifs) {
      const item = document.createElement('div');
      item.className = `sn-item${n.read ? '' : ' unread'}`;
      item.innerHTML = `
        <span class="sn-icon">${formatNotifIcon(n)}</span>
        <div class="sn-body">
          <div class="sn-title">${escHtml(n.title)}</div>
          ${n.desc ? `<div class="sn-desc">${escHtml(n.desc)}</div>` : ''}
          <div class="sn-time">${relativeTime(n.at)}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        n.read = true;
        saveNotifications(_notifs);
        renderPanel();
        if (n.href) window.location.href = n.href;
        else closePanel();
      });
      list.appendChild(item);
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"]/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  function formatNotifIcon(n) {
    if (!n) return window.suiteIcons ? window.suiteIcons.icons.bell(18) : '<span class="sn-icon-emoji">🔔</span>';
    if (n.iconHtml && String(n.iconHtml).indexOf('<svg') === 0) return n.iconHtml;
    if (window.suiteIcons && n.iconKey) return window.suiteIcons.notification(n.iconKey);
    const raw = n.icon;
    if (raw && String(raw).indexOf('<svg') === 0) return raw;
    if (window.suiteIcons && typeof raw === 'string' && /^(tool|inventory|audit|projects|assets|warning|blocked)$/i.test(raw)) {
      return window.suiteIcons.notification(raw);
    }
    return `<span class="sn-icon-emoji" aria-hidden="true">${escHtml(raw || '🔔')}</span>`;
  }

  /* ─── Add a notification ──────────────────────────────────────────── */
  function addNotification({ title, desc, icon, href, dedupKey }) {
    // Dedup: if same dedupKey exists and is recent (<5 min), skip
    if (dedupKey) {
      const existing = _notifs.find(n => n.dedupKey === dedupKey);
      if (existing && (Date.now() - new Date(existing.at).getTime()) < 300_000) return;
      if (existing) _notifs = _notifs.filter(n => n.dedupKey !== dedupKey);
    }
    _notifs.unshift({ title, desc, icon: icon || '🔔', href, dedupKey, at: new Date().toISOString(), read: false });
    _notifs = _notifs.slice(0, MAX_NOTIFICATIONS);
    saveNotifications(_notifs);
    renderPanel();
  }

  function markAllRead() {
    if (!_notifs.length) return;
    _notifs = _notifs.map((n) => ({ ...n, read: true }));
    saveNotifications(_notifs);
    renderPanel();
  }

  /* ─── Panel open/close ──────────────────────────────────────────── */
  function openPanel() {
    _panelOpen = true;
    panel.classList.add('open');
  }
  function closePanel() {
    _panelOpen = false;
    panel.classList.remove('open');
  }

  bell.addEventListener('click', e => {
    e.stopPropagation();
    _panelOpen ? closePanel() : openPanel();
  });

  document.addEventListener('click', e => {
    if (_panelOpen && !wrapper.contains(e.target)) closePanel();
  });

  panel.addEventListener('click', (e) => {
    const markBtn = e.target.closest('#sn-mark-read');
    if (!markBtn) return;
    e.preventDefault();
    e.stopPropagation();
    markAllRead();
  });

  /* ─── Socket.IO listeners ────────────────────────────────────────── */
  function wireSocket() {
    const io = window.io;
    if (!io) return;
    let socket;
    try { socket = io({ withCredentials: true }); } catch { return; }

    socket.on('toolsUpdated', payload => {
      const serials = payload?.serialNumbers?.join(', ') || 'tool';
      const reason  = payload?.reason || 'updated';
      addNotification({
        title: `Tool ${reason}`,
        desc: serials,
        iconKey: 'tool',
        href: '/screwdriver/screwdriver.html',
        dedupKey: `tool:${serials}:${reason}`,
      });
    });

    socket.on('inventoryUpdated', payload => {
      addNotification({
        title: 'Inventory updated',
        desc: payload?.ItemCode || '',
        iconKey: 'inventory',
        href: '/inventory/Inventory.html',
        dedupKey: `inventory:${payload?.ItemCode || Date.now()}`,
      });
    });

    socket.on('auditUpdated', () => {
      addNotification({
        title: 'Audit record updated',
        iconKey: 'audit',
        href: '/projects?domain=audit',
        dedupKey: `audit:${Math.floor(Date.now() / 30_000)}`,
      });
    });

    socket.on('projectsUpdated', () => {
      addNotification({
        title: 'Project board updated',
        iconKey: 'projects',
        href: '/projects',
        dedupKey: `projects:${Math.floor(Date.now() / 30_000)}`,
      });
    });

    socket.on('assetsUpdated', () => {
      addNotification({
        title: 'Asset catalog updated',
        iconKey: 'assets',
        href: '/asset-catalog',
        dedupKey: `assets:${Math.floor(Date.now() / 30_000)}`,
      });
    });
  }

  /* ─── Metric polling (overdue, low-stock) ─────────────────────────── */
  let _lastOverdue  = null;
  let _lastBlocked  = null;

  async function pollMetrics() {
    try {
      const r = await fetch('/management/api/metrics', { credentials: 'include' });
      if (!r.ok) return;
      const m = await r.json();

      const overdue = m.audits?.overdue || 0;
      if (overdue > 0 && overdue !== _lastOverdue) {
        _lastOverdue = overdue;
        addNotification({
          title: `${overdue} overdue audit${overdue > 1 ? 's' : ''}`,
          desc: 'Click to view audits board',
          iconKey: 'warning',
          href: '/projects?domain=audit',
          dedupKey: `overdue-audits:${overdue}`,
        });
      }

      const blocked = m.projects?.byBucket?.blocked || 0;
      if (blocked > 0 && blocked !== _lastBlocked) {
        _lastBlocked = blocked;
        addNotification({
          title: `${blocked} blocked Kanban task${blocked > 1 ? 's' : ''}`,
          desc: 'Click to view projects board',
          iconKey: 'blocked',
          href: '/projects',
          dedupKey: `blocked-tasks:${blocked}`,
        });
      }
    } catch {}
  }

  /* ─── Boot ───────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { mount(); renderPanel(); wireSocket(); });
  } else {
    mount(); renderPanel(); wireSocket();
  }

  // Poll metrics every 90 seconds
  pollMetrics();
  setInterval(pollMetrics, 90_000);

  // Expose for external use
  window.suiteNotifications = { add: addNotification, open: openPanel, close: closePanel };
})();

