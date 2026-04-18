/**
 * public/search/palette.js
 * ─────────────────────────
 * Global Command Palette  (Cmd-K / Ctrl-K)
 *
 * Drop-in enhancement — import this file on any page and the palette appears.
 * It is self-contained: injects its own styles, DOM, and event listeners.
 * Queries:
 *   GET /api/search?q=...        → assets + inventory (from existing searchApiRouter)
 *   GET /tools/api?q=...         → screwdriver tools  (serialNumber, model)
 *   GET /projects/api?q=...      → projects / tasks   (title, category)
 *   GET /audits/api?q=...        → audit records      (title, kind)
 *
 * Each result group has a type badge and a click-through link.
 */

(function () {
  'use strict';

  /* ─── Avoid double-init ──────────────────────────────────────────── */
  if (document.getElementById('suite-palette')) return;

  /* ─── Styles ─────────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    #suite-palette-backdrop {
      display: none; position: fixed; inset: 0; z-index: 99998;
      background: rgba(0,0,0,.45);
      align-items: flex-start; justify-content: center;
      padding-top: 12vh;
    }
    #suite-palette-backdrop.open { display: flex; }

    #suite-palette {
      width: min(640px, 94vw);
      background: var(--surface-strong, #fff);
      color: var(--fg, #111);
      border: 1px solid var(--border, #ddd);
      border-radius: .85rem;
      box-shadow: 0 24px 64px rgba(0,0,0,.3);
      overflow: hidden;
    }

    #suite-palette-input-row {
      display: flex; align-items: center; gap: .5rem;
      padding: .75rem 1rem;
      border-bottom: 1px solid var(--border, #ddd);
    }
    #suite-palette-icon { font-size: 1.1rem; opacity: .5; flex-shrink: 0; }
    #suite-palette-input {
      flex: 1; border: none; outline: none; background: transparent;
      font-size: 1.05rem; color: var(--fg, #111);
    }
    #suite-palette-shortcut {
      font-size: .75rem; color: var(--fg-muted, #888);
      border: 1px solid var(--border, #ddd);
      border-radius: .3rem; padding: .1rem .4rem; white-space: nowrap;
    }

    #suite-palette-results {
      max-height: 420px; overflow-y: auto;
    }

    .sp-group-header {
      padding: .4rem 1rem .2rem;
      font-size: .72rem; font-weight: 700; letter-spacing: .06em;
      color: var(--fg-muted, #888); text-transform: uppercase;
      border-top: 1px solid var(--border, #eee);
    }
    .sp-group-header:first-child { border-top: none; }

    .sp-item {
      display: flex; align-items: center; gap: .6rem;
      padding: .5rem 1rem; cursor: pointer;
      transition: background .1s;
      border: none; width: 100%; text-align: left;
      background: transparent; color: var(--fg, #111);
    }
    .sp-item:hover, .sp-item[aria-selected=true] {
      background: var(--row-hover, rgba(59,130,246,.1));
    }
    .sp-type {
      font-size: .7rem; font-weight: 700; padding: .15rem .45rem;
      border-radius: 999px; flex-shrink: 0; white-space: nowrap;
    }
    .sp-type--asset     { background: var(--info-bg, #e0f0ff); color: var(--info, #1d6fa5); }
    .sp-type--inventory { background: var(--warn-bg, #fff3cd); color: var(--warn, #92600a); }
    .sp-type--tool      { background: var(--ok-bg, #d4edda);   color: var(--ok, #1a5c2e); }
    .sp-type--project   { background: #ede9fe;                 color: #5b21b6; }
    .sp-type--audit     { background: #fce7f3;                 color: #9d174d; }

    .sp-title    { font-size: .92rem; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sp-subtitle { font-size: .8rem; color: var(--fg-muted, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

    #suite-palette-empty {
      padding: 2rem; text-align: center;
      color: var(--fg-muted, #888); font-size: .9rem;
    }
    #suite-palette-loading {
      padding: 1.25rem; text-align: center;
      color: var(--fg-muted, #888); font-size: .88rem;
    }
    #suite-palette-footer {
      display: flex; gap: 1.25rem; align-items: center;
      padding: .5rem 1rem;
      border-top: 1px solid var(--border, #eee);
      font-size: .75rem; color: var(--fg-muted, #888);
    }
    #suite-palette-footer kbd {
      border: 1px solid var(--border, #ddd);
      border-radius: .25rem; padding: .05rem .3rem;
      background: var(--surface, #f8f8f8);
      font-family: monospace; font-size: .75rem;
    }
  `;
  document.head.appendChild(style);

  /* ─── DOM ────────────────────────────────────────────────────────── */
  const backdrop = document.createElement('div');
  backdrop.id = 'suite-palette-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Global search');

  backdrop.innerHTML = `
    <div id="suite-palette">
      <div id="suite-palette-input-row">
        <span id="suite-palette-icon" aria-hidden="true">🔍</span>
        <input id="suite-palette-input" type="text" placeholder="Search tools, inventory, projects, audits…"
          autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-controls="suite-palette-results"/>
        <span id="suite-palette-shortcut">Esc to close</span>
      </div>
      <div id="suite-palette-results" role="listbox" aria-label="Search results"></div>
      <div id="suite-palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  /* ─── State ──────────────────────────────────────────────────────── */
  const input   = document.getElementById('suite-palette-input');
  const results = document.getElementById('suite-palette-results');
  let _debounce = null;
  let _items    = [];   // flat list of { el, href }
  let _cursor   = -1;
  let _open     = false;

  /* ─── Helpers ────────────────────────────────────────────────────── */
  const esc = s => String(s || '').replace(/[&<>"]/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

  function typeLabel(type) {
    const map = {
      asset: 'Asset', inventory: 'Inventory', tool: 'Tool',
      project: 'Project', audit: 'Audit',
    };
    return map[type] || type;
  }

  function hrefFor(item) {
    switch (item.type) {
      case 'asset':     return `/asset-catalog`;
      case 'inventory': return `/inventory/Inventory.html`;
      case 'tool':      return `/screwdriver/screwdriver.html`;
      case 'project':   return `/projects`;
      case 'audit':     return `/projects?domain=audit`;
      default:          return '#';
    }
  }

  /* ─── Render results ─────────────────────────────────────────────── */
  function renderResults(groups) {
    results.innerHTML = '';
    _items = [];
    _cursor = -1;

    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) {
      results.innerHTML = `<div id="suite-palette-empty">No results found</div>`;
      return;
    }

    for (const group of groups) {
      if (!group.items.length) continue;
      const hdr = document.createElement('div');
      hdr.className = 'sp-group-header';
      hdr.textContent = group.label;
      results.appendChild(hdr);

      for (const item of group.items) {
        const href = hrefFor(item);
        const btn = document.createElement('button');
        btn.className = 'sp-item';
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', 'false');
        btn.innerHTML = `
          <span class="sp-type sp-type--${esc(item.type)}">${esc(typeLabel(item.type))}</span>
          <span class="sp-title">${esc(item.title)}</span>
          ${item.subtitle ? `<span class="sp-subtitle">${esc(item.subtitle)}</span>` : ''}
        `;
        btn.addEventListener('click', () => { close(); window.location.href = href; });
        btn.addEventListener('mouseenter', () => setCursor(_items.length));
        results.appendChild(btn);
        _items.push({ el: btn, href });
      }
    }
  }

  function setCursor(idx) {
    _items.forEach((it, i) => it.el.setAttribute('aria-selected', String(i === idx)));
    _cursor = idx;
    _items[idx]?.el.scrollIntoView({ block: 'nearest' });
  }

  /* ─── Fetch ──────────────────────────────────────────────────────── */
  async function safeFetch(url) {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  async function search(q) {
    if (!q || q.length < 2) {
      results.innerHTML = `<div id="suite-palette-empty">Type at least 2 characters to search…</div>`;
      _items = []; _cursor = -1;
      return;
    }
    results.innerHTML = `<div id="suite-palette-loading">Searching…</div>`;

    const enc = encodeURIComponent(q);

    // Fire all in parallel; each may fail gracefully
    const [general, tools, projects, audits] = await Promise.all([
      safeFetch(`/api/search?q=${enc}&limit=5`),
      safeFetch(`/tools/api?q=${enc}&limit=4`),
      safeFetch(`/projects/api?q=${enc}&limit=4&domain=project`),
      safeFetch(`/audits/api?q=${enc}&limit=4`),
    ]);

    const groups = [
      {
        label: 'Tools',
        items: (tools?.tools || tools?.items || []).slice(0, 4).map(t => ({
          type: 'tool',
          title: `${t.serialNumber || t.code || ''} — ${t.model || t.description || ''}`.trim(),
          subtitle: `${t.status || ''} · torque ${t.torque || '?'}`,
        })),
      },
      {
        label: 'Inventory',
        items: (general?.items || []).filter(i => i.type === 'inventory').slice(0, 4).map(i => ({
          type: 'inventory', title: i.title, subtitle: i.subtitle,
        })),
      },
      {
        label: 'Assets',
        items: (general?.items || []).filter(i => i.type === 'asset').slice(0, 4).map(i => ({
          type: 'asset', title: i.title, subtitle: i.subtitle,
        })),
      },
      {
        label: 'Projects',
        items: (projects?.items || []).slice(0, 4).map(p => ({
          type: 'project',
          title: p.title || '',
          subtitle: `${p.bucket || ''} · ${p.category || p.meta?.category || ''}`.replace(/^·\s*/, ''),
        })),
      },
      {
        label: 'Audits',
        items: (Array.isArray(audits) ? audits : audits?.items || []).slice(0, 3).map(a => ({
          type: 'audit',
          title: a.title || '',
          subtitle: `${a.kind || ''} · ${a.bucket || ''}`.replace(/^·\s*/, ''),
        })),
      },
    ];

    renderResults(groups);
  }

  /* ─── Open / Close ───────────────────────────────────────────────── */
  function open() {
    _open = true;
    backdrop.classList.add('open');
    input.value = '';
    results.innerHTML = `<div id="suite-palette-empty">Type to search across all modules…</div>`;
    _items = []; _cursor = -1;
    setTimeout(() => input.focus(), 30);
  }

  function close() {
    _open = false;
    backdrop.classList.remove('open');
    input.value = '';
    _items = []; _cursor = -1;
  }

  /* ─── Events ─────────────────────────────────────────────────────── */
  input.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => search(input.value.trim()), 220);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(_cursor + 1, _items.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(Math.max(_cursor - 1, 0)); }
    if (e.key === 'Enter' && _cursor >= 0 && _items[_cursor]) {
      close(); window.location.href = _items[_cursor].href;
    }
  });

  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close();
  });

  /* ─── Global keyboard trigger ────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      _open ? close() : open();
    }
    if (e.key === 'Escape' && _open) close();
  });

  /* ─── Expose API ─────────────────────────────────────────────────── */
  window.suitePalette = { open, close };
})();
