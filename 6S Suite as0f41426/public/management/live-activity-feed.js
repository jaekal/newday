// Live activity list + detail pane for Management Dashboard only.
(function () {
  'use strict';

  var DASHBOARD_HREF = '/management/portal.html';
  var BLDG_KEY = 'suite.building.v1';

  function getBuilding() {
    return localStorage.getItem(BLDG_KEY) || 'Bldg-350';
  }

  var feedEl = document.getElementById('feedList');

  if (!feedEl) return;

  var feedItems = [];

  var FEED_COLORS = {
    tools: '#67b8d4',
    esd: '#0ea5e9',
    projects: '#8b5cf6',
    audit: '#6366f1',
    assets: '#7c3aed',
    people: '#a78bfa',
    ok: '#22d3ee',
    crit: '#e11d6a',
  };

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function prettyLabel(value) {
    return String(value || '')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, function (m) {
        return m.toUpperCase();
      });
  }
  function formatWhen(value) {
    var dt = value ? new Date(value) : new Date();
    if (Number.isNaN(dt.getTime())) dt = new Date();
    return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function formatStamp(value) {
    var dt = value ? new Date(value) : new Date();
    if (Number.isNaN(dt.getTime())) dt = new Date();
    return dt.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  function capList(list, max) {
    var items = (Array.isArray(list) ? list : [])
      .filter(Boolean)
      .map(String);
    if (!items.length) return '';
    if (items.length <= max) return items.join(', ');
    return items.slice(0, max).join(', ') + ' +' + (items.length - max) + ' more';
  }
  function singularOrPlural(count, single, plural) {
    return count === 1 ? single : plural || single + 's';
  }
  function safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }
  function buildModuleHref(module) {
    var currentBuilding = getBuilding();
    var routes = {
      tools: '/screwdriver/screwdriver.html?building=' + encodeURIComponent(currentBuilding),
      inventory: '/inventory/Inventory.html?building=' + encodeURIComponent(currentBuilding),
      assets: '/asset-catalog',
      projects: '/projects?building=' + encodeURIComponent(currentBuilding),
      audit: '/projects?domain=audit&building=' + encodeURIComponent(currentBuilding),
      employees: '/admin/user-management',
      esd: '/screwdriver/screwdriver.html?building=' + encodeURIComponent(currentBuilding),
    };
    return routes[module] || DASHBOARD_HREF;
  }
  function makeEntry(config) {
    var details = Array.isArray(config.details)
      ? config.details.filter(function (detail) {
          return detail && detail.value != null && String(detail.value).trim() !== '';
        })
      : [];
    return {
      title: config.title || 'Activity detected',
      summary: config.summary || 'A live event was received from the suite.',
      module: config.module || 'suite',
      moduleLabel: config.moduleLabel || prettyLabel(config.module || 'suite'),
      actionLabel: config.actionLabel || 'Activity',
      eventName: config.eventName || 'event',
      color: config.color || FEED_COLORS.ok,
      occurredAt: config.occurredAt || new Date().toISOString(),
      href: config.href || buildModuleHref(config.module),
      hrefLabel: config.hrefLabel || 'Open affected area',
      meta:
        config.meta ||
        prettyLabel(config.module || 'suite') + ' · ' + formatWhen(config.occurredAt),
      details: details,
      raw: config.raw || {},
    };
  }
  function describeEvent(eventName, payload) {
    var p = payload && typeof payload === 'object' ? payload : {};
    var occurredAt = p.at || p.timestamp || new Date().toISOString();
    if (eventName === 'connect') {
      return makeEntry({
        eventName: eventName,
        title: 'Live activity feed connected',
        summary:
          'The dashboard rejoined the real-time socket feed and is listening for new suite events.',
        module: 'suite',
        moduleLabel: 'Suite',
        actionLabel: 'Connected',
        color: FEED_COLORS.ok,
        occurredAt: occurredAt,
        href: DASHBOARD_HREF,
        hrefLabel: 'Stay on dashboard',
        details: [
          {
            label: 'Action taken',
            value:
              'Subscribed to tools, projects, audits, inventory, assets, and people events.',
          },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'disconnect') {
      return makeEntry({
        eventName: eventName,
        title: 'Live activity feed disconnected',
        summary:
          'The socket connection dropped, so fresh events may pause until the dashboard reconnects.',
        module: 'suite',
        moduleLabel: 'Suite',
        actionLabel: 'Disconnected',
        color: '#64748b',
        occurredAt: occurredAt,
        href: DASHBOARD_HREF,
        hrefLabel: 'Refresh dashboard',
        details: [
          { label: 'Action taken', value: 'Waiting to reconnect to live activity.' },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'reconnect') {
      return makeEntry({
        eventName: eventName,
        title: 'Live activity feed reconnected',
        summary: 'Real-time updates are flowing again and dashboard metrics were refreshed.',
        module: 'suite',
        moduleLabel: 'Suite',
        actionLabel: 'Reconnected',
        color: FEED_COLORS.ok,
        occurredAt: occurredAt,
        href: DASHBOARD_HREF,
        hrefLabel: 'Stay on dashboard',
        details: [
          {
            label: 'Action taken',
            value: 'Rejoined the live feed and refreshed visible KPI counters.',
          },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'toolsUpdated') {
      var serials = Array.isArray(p.serialNumbers)
        ? p.serialNumbers.filter(Boolean)
        : p.serialNumber
          ? [p.serialNumber]
          : [];
      var reason = prettyLabel(p.reason || 'updated');
      var target = serials.length
        ? capList(serials, 4)
        : p.assetId
          ? 'Asset #' + p.assetId
          : 'Tool records';
      var summary = serials.length
        ? 'Updated tool record' +
          (serials.length > 1 ? 's' : '') +
          ' for ' +
          target +
          ' after ' +
          reason.toLowerCase() +
          '.'
        : 'A floor tools event was recorded as ' + reason.toLowerCase() + '.';
      return makeEntry({
        eventName: eventName,
        title: target + ' · ' + reason,
        summary: summary,
        module: 'tools',
        moduleLabel: 'Floor Tools',
        actionLabel: reason,
        color:
          String(p.reason || '').toLowerCase().indexOf('checkout') >= 0
            ? FEED_COLORS.tools
            : FEED_COLORS.ok,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: reason },
          { label: 'Affected serials', value: target },
          { label: 'Asset reference', value: p.assetId ? 'Asset #' + p.assetId : '' },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'inventoryUpdated') {
      var invReason = prettyLabel(p.reason || 'updated');
      var invCodes = Array.isArray(p.codes)
        ? p.codes.filter(Boolean)
        : p.code
          ? [p.code]
          : [];
      var invTarget = invCodes.length
        ? capList(invCodes, 5)
        : p.itemId
          ? 'Item #' + p.itemId
          : 'Inventory records';
      var invCount = invCodes.length || (p.count && Number(p.count)) || 0;
      var invSummary =
        invCount > 1
          ? invCount +
            ' ' +
            singularOrPlural(invCount, 'inventory item') +
            ' changed during ' +
            invReason.toLowerCase() +
            '.'
          : 'Inventory action recorded as ' +
            invReason.toLowerCase() +
            ' for ' +
            invTarget +
            '.';
      return makeEntry({
        eventName: eventName,
        title: invReason + ' · ' + invTarget,
        summary: invSummary,
        module: 'inventory',
        moduleLabel: 'Inventory',
        actionLabel: invReason,
        color: FEED_COLORS.esd,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: invReason },
          { label: 'Affected item codes', value: invTarget },
          { label: 'Affected count', value: invCount ? String(invCount) : '' },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'assetsUpdated') {
      var assetAction = prettyLabel(p.action || p.reason || 'updated');
      var assetTarget = p.tagNumber
        ? 'Tag ' + p.tagNumber
        : p.id
          ? 'Asset #' + p.id
          : 'Asset Catalog';
      var assetSummary = p.total
        ? 'Managed asset sync processed ' +
          p.total +
          ' assets with ' +
          (p.created || 0) +
          ' created and ' +
          (p.updated || 0) +
          ' updated.'
        : assetAction + ' was recorded for ' + assetTarget + '.';
      return makeEntry({
        eventName: eventName,
        title: assetTarget + ' · ' + assetAction,
        summary: assetSummary,
        module: 'assets',
        moduleLabel: 'Asset Catalog',
        actionLabel: assetAction,
        color: FEED_COLORS.assets,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: assetAction },
          { label: 'Affected asset', value: assetTarget },
          {
            label: 'Sync totals',
            value: p.total
              ? 'Total ' +
                p.total +
                ' · Created ' +
                (p.created || 0) +
                ' · Updated ' +
                (p.updated || 0)
              : '',
          },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'projectsUpdated') {
      var projectReason = prettyLabel(p.reason || 'updated');
      var projectTarget = p.id
        ? 'Project #' + p.id
        : p.count
          ? p.count + ' project records'
          : 'Projects board';
      return makeEntry({
        eventName: eventName,
        title: projectTarget + ' · ' + projectReason,
        summary: p.count
          ? projectReason + ' affected ' + p.count + ' project records.'
          : projectTarget + ' changed after ' + projectReason.toLowerCase() + '.',
        module: 'projects',
        moduleLabel: 'Projects',
        actionLabel: projectReason,
        color: FEED_COLORS.projects,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: projectReason },
          { label: 'Affected record', value: projectTarget },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'auditUpdated') {
      var auditReason = prettyLabel(p.reason || p.resource || 'updated');
      var auditTarget = p.id
        ? 'Audit #' + p.id
        : p.assetId
          ? 'Asset #' + p.assetId
          : 'Audit workflow';
      return makeEntry({
        eventName: eventName,
        title: auditTarget + ' · ' + auditReason,
        summary: p.count
          ? 'Audit workflow updated ' +
            p.count +
            ' records during ' +
            auditReason.toLowerCase() +
            '.'
          : auditTarget + ' changed after ' + auditReason.toLowerCase() + '.',
        module: 'audit',
        moduleLabel: 'Audits',
        actionLabel: auditReason,
        color: FEED_COLORS.audit,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: auditReason },
          { label: 'Affected audit record', value: auditTarget },
          { label: 'Actor note', value: p.actor || '' },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (eventName === 'employeesUpdated') {
      var employeeReason = prettyLabel(p.reason || 'updated');
      var employeeTarget = p.id ? String(p.id) : 'Technician roster';
      return makeEntry({
        eventName: eventName,
        title: employeeTarget + ' · ' + employeeReason,
        summary:
          'People and access data changed, so user or technician details were refreshed.',
        module: 'employees',
        moduleLabel: 'People & Access',
        actionLabel: employeeReason,
        color: FEED_COLORS.people,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: employeeReason },
          { label: 'Affected person or roster', value: employeeTarget },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    if (
      eventName === 'esdCarts:checkout' ||
      eventName === 'esdCarts:return' ||
      eventName === 'esdCarts:removed' ||
      eventName === 'esdCarts:updated'
    ) {
      var cartAction = eventName.split(':')[1] || 'updated';
      var cartTarget = p.cartId || (p.cart && p.cart.id) || 'Cart';
      var operator = p.operatorId || (p.cart && p.cart.operatorId) || '';
      return makeEntry({
        eventName: eventName,
        title: cartTarget + ' · ' + prettyLabel(cartAction),
        summary:
          'ESD cart activity was recorded for ' +
          cartTarget +
          (operator ? ' with operator ' + operator + '.' : '.'),
        module: 'esd',
        moduleLabel: 'ESD Carts',
        actionLabel: prettyLabel(cartAction),
        color:
          cartAction === 'removed'
            ? FEED_COLORS.crit
            : cartAction === 'checkout'
              ? FEED_COLORS.esd
              : FEED_COLORS.ok,
        occurredAt: occurredAt,
        details: [
          { label: 'Action taken', value: prettyLabel(cartAction) },
          { label: 'Affected cart', value: cartTarget },
          { label: 'Operator', value: operator },
          { label: 'Captured at', value: formatStamp(occurredAt) },
        ],
        raw: { event: eventName, payload: p },
      });
    }
    return makeEntry({
      eventName: eventName,
      title: prettyLabel(eventName),
      summary: 'A live suite event was captured and stored in the dashboard feed.',
      module: 'suite',
      moduleLabel: 'Suite',
      actionLabel: 'Activity',
      color: FEED_COLORS.ok,
      occurredAt: occurredAt,
      details: [
        { label: 'Action taken', value: prettyLabel(eventName) },
        { label: 'Captured at', value: formatStamp(occurredAt) },
      ],
      raw: { event: eventName, payload: p },
    });
  }

  function pushFeed(eventName, payload) {
    feedItems.unshift(describeEvent(eventName, payload));
    if (feedItems.length > 18) feedItems.pop();
    renderFeed();
  }

  function renderFeed() {
    if (!feedItems.length) {
      feedEl.innerHTML = '<div class="h-feed-empty">No recent activity</div>';
      return;
    }
    feedEl.innerHTML = feedItems
      .map(function (i, index) {
        return (
          '<div class="h-feed-row" aria-label="' +
          escHtml(i.title) +
          '">' +
          '<div class="h-dot" style="background:' +
          i.color +
          '"></div>' +
          '<div class="h-feed-copy">' +
          '<div class="h-feed-top"><div class="h-ft">' +
          escHtml(i.title) +
          '</div></div>' +
          '<div class="h-feed-badges">' +
          '<span class="h-feed-badge">' +
          escHtml(i.moduleLabel) +
          '</span>' +
          '<span class="h-feed-badge action">' +
          escHtml(i.actionLabel) +
          '</span>' +
          '<span class="h-feed-badge route">' +
          escHtml(i.eventName) +
          '</span>' +
          '</div>' +
          '<div class="h-feed-summary">' +
          escHtml(i.summary) +
          '</div>' +
          '<div class="h-fm">' +
          escHtml(i.meta || i.moduleLabel + ' · ' + formatWhen(i.occurredAt)) +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function initSocket() {
    if (!window.io) return;
    try {
      var socket = window.io('/', { withCredentials: true });

      socket.on('connect', function () {
        ['tools', 'projects', 'audit', 'inventory', 'assets', 'employees'].forEach(function (room) {
          socket.emit('subscribe', room);
        });
        pushFeed('connect', { rooms: ['tools', 'projects', 'audit', 'inventory', 'assets', 'employees'] });
      });

      socket.on('toolsUpdated', function (p) {
        pushFeed('toolsUpdated', p);
      });

      socket.on('esdCarts:checkout', function (p) {
        pushFeed('esdCarts:checkout', p);
      });
      socket.on('esdCarts:return', function (p) {
        pushFeed('esdCarts:return', p);
      });
      socket.on('esdCarts:removed', function (p) {
        pushFeed('esdCarts:removed', p);
      });
      socket.on('esdCarts:updated', function (p) {
        pushFeed('esdCarts:updated', p);
      });

      socket.on('projectsUpdated', function (p) {
        pushFeed('projectsUpdated', p);
      });
      socket.on('auditUpdated', function (p) {
        pushFeed('auditUpdated', p);
      });
      socket.on('assetsUpdated', function (p) {
        pushFeed('assetsUpdated', p);
      });
      socket.on('inventoryUpdated', function (p) {
        pushFeed('inventoryUpdated', p);
      });
      socket.on('employeesUpdated', function (p) {
        pushFeed('employeesUpdated', p);
      });

      socket.on('disconnect', function () {
        pushFeed('disconnect', {});
      });
      socket.on('reconnect', function () {
        pushFeed('reconnect', {});
      });
    } catch (e) {
      /* ignore */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSocket);
  } else {
    initSocket();
  }
})();
