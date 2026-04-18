// public/management/portal.js
//
// Renders the Management Dashboard KPIs, tables, and 14-day trend chart.
// Consumes GET /management/api/metrics and binds to the markup in portal.html.
// Also exposes window.__portalReload() for the Refresh button (wired by
// portal-init.js).

(function () {
  'use strict';

  var BLDG_KEY = 'suite.building.v1';

  function getBuilding() {
    try {
      var v = window.localStorage?.getItem(BLDG_KEY) || '';
      return typeof v === 'string' ? v : '';
    } catch (e) {
      return '';
    }
  }

  function qs(id) { return document.getElementById(id); }

  function fmt(n) {
    if (n == null || Number.isNaN(Number(n))) return '–';
    return String(n);
  }

  function setText(id, value) {
    var el = qs(id);
    if (el) el.textContent = fmt(value);
  }

  function setBar(id, pct) {
    var el = qs(id);
    if (!el) return;
    var v = Math.max(0, Math.min(100, Number(pct) || 0));
    el.style.width = v + '%';
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function renderTable(tableId, rows, columns) {
    var table = qs(tableId);
    if (!table) return;
    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    if (!rows || !rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="' + columns.length + '" style="opacity:.6;text-align:center;padding:.75rem;">No items</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(function (row) {
        return '<tr>' + columns.map(function (col) {
          return '<td>' + escHtml(col(row)) + '</td>';
        }).join('') + '</tr>';
      })
      .join('');
  }

  // ── Chart state ─────────────────────────────────────────────────────────
  var chartInstance = null;

  function renderTrend(trend) {
    var canvas = qs('trend-canvas');
    if (!canvas || typeof window.Chart === 'undefined') return;

    var labels = (trend && trend.labels) || [];
    var series = (trend && trend.series) || { todo: [], doing: [], blocked: [], done: [] };

    var data = {
      labels: labels,
      datasets: [
        { label: 'Todo',    data: series.todo    || [], backgroundColor: 'rgba(100,116,139,.8)' },
        { label: 'Doing',   data: series.doing   || [], backgroundColor: 'rgba(59,130,246,.8)' },
        { label: 'Blocked', data: series.blocked || [], backgroundColor: 'rgba(239,68,68,.85)' },
        { label: 'Done',    data: series.done    || [], backgroundColor: 'rgba(34,197,94,.85)' },
      ],
    };

    var config = {
      type: 'bar',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    };

    if (chartInstance) {
      chartInstance.data = data;
      chartInstance.update('none');
      return;
    }
    chartInstance = new window.Chart(canvas.getContext('2d'), config);
  }

  // ── Data loading ────────────────────────────────────────────────────────
  function showCards() {
    var skel = qs('kpi-skeleton');
    var cards = qs('kpi-cards');
    if (skel) skel.style.display = 'none';
    if (cards) cards.style.display = '';
  }

  function showError(message) {
    var cards = qs('kpi-cards');
    if (!cards) return;
    cards.style.display = '';
    cards.innerHTML =
      '<div class="card" style="padding:1rem;color:var(--danger)"><strong>Unable to load metrics.</strong><br/>' +
      escHtml(message || 'Please try again.') +
      '</div>';
  }

  async function loadMetrics() {
    var building = getBuilding();
    var url = '/management/api/metrics';
    if (building) url += '?building=' + encodeURIComponent(building);

    try {
      var res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/auth/login?next=' + encodeURIComponent(window.location.pathname);
          return;
        }
        if (res.status === 403) {
          showError('You do not have permission to view this dashboard.');
          return;
        }
        var text = await res.text().catch(function () { return ''; });
        showError('HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
        return;
      }

      var m = await res.json();

      // KPIs
      setText('k-tools-available', m?.tools?.available);
      setText('k-tools-total',     m?.tools?.total);
      setText('k-tools-out',       m?.tools?.checkedOut);
      setText('k-audits-open',     m?.audits?.open);
      setText('k-audits-overdue',  m?.audits?.overdue);

      // Bucket bars
      var bk = m?.projects?.byBucket || { todo: 0, doing: 0, blocked: 0, done: 0 };
      var total = Math.max(1, (bk.todo || 0) + (bk.doing || 0) + (bk.blocked || 0) + (bk.done || 0));
      setText('cnt-todo',    bk.todo);
      setText('cnt-doing',   bk.doing);
      setText('cnt-blocked', bk.blocked);
      setText('cnt-done',    bk.done);
      setBar('bar-todo',    ((bk.todo    || 0) / total) * 100);
      setBar('bar-doing',   ((bk.doing   || 0) / total) * 100);
      setBar('bar-blocked', ((bk.blocked || 0) / total) * 100);
      setBar('bar-done',    ((bk.done    || 0) / total) * 100);

      // Tables
      renderTable('tbl-delayed', m.delayedTickets || [], [
        function (r) { return r.title || '(untitled)'; },
        function (r) { return r.bucket || ''; },
        function (r) { return r.dueDate || ''; },
        function (r) { return r.source || ''; },
      ]);

      renderTable('tbl-suggestions', m.suggestions || [], [
        function (r) { return r.title || '(untitled)'; },
        function (r) { return r.bucket || ''; },
      ]);

      renderTrend(m.trend);
      showCards();
    } catch (e) {
      showError(e && e.message ? e.message : String(e || 'Unknown error'));
    }
  }

  window.__portalReload = loadMetrics;

  function initSocketRefresh() {
    if (typeof window.io !== 'function') return;
    try {
      var socket = window.io('/', { withCredentials: true });
      ['projectsUpdated', 'auditUpdated', 'toolsUpdated', 'inventoryUpdated', 'kiosk:suggestion.created'].forEach(function (evt) {
        socket.on(evt, function () { loadMetrics(); });
      });
    } catch (e) { /* non-fatal */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      loadMetrics();
      initSocketRefresh();
    });
  } else {
    loadMetrics();
    initSocketRefresh();
  }
})();
