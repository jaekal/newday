/* global window, document, fetch, CustomEvent */
(function goldenPartsPanel() {
  const $ = (s) => document.querySelector(s);

  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')?.content || '';
    if (meta) return meta;
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function apiFetch(url, opts, _csrfRetry) {
    const method = String(opts?.method || 'GET').toUpperCase();
    const isUnsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const headers = { 'Content-Type': 'application/json', ...(opts?.headers || {}) };
    if (isUnsafe) {
      const t = getCsrfToken();
      if (t) {
        headers['X-CSRF-Token'] = t;
        headers['X-XSRF-TOKEN'] = t;
      }
    }
    const r = await fetch(url, { credentials: 'include', ...opts, headers });
    if (r.status === 403 && isUnsafe && !_csrfRetry) {
      let msg = '';
      try {
        const ct = r.headers.get('content-type') || '';
        msg = ct.includes('application/json')
          ? (await r.clone().json())?.message || ''
          : await r.clone().text();
      } catch { /* ignore */ }
      if (/csrf/i.test(msg || '')) {
        try {
          await fetch('/auth/whoami', {
            method: 'GET',
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
        } catch { /* ignore */ }
        return apiFetch(url, opts, true);
      }
    }
    return r;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

  function durLabel(ms) {
    if (ms == null || ms < 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  let lastRows = [];

  function setMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || '';
    el.className = `gp-msg ${ok ? 'ok' : 'err'}`;
    if (text) setTimeout(() => { el.textContent = ''; el.className = 'gp-msg'; }, 5000);
  }

  function updateBadges(rows) {
    const n = rows.length;
    const badge = $('#goldenOutBadge');
    if (badge) {
      badge.textContent = String(n);
      badge.style.display = n ? 'inline-flex' : 'none';
    }
    const kpiOut = $('#gpKpiOut');
    if (kpiOut) kpiOut.textContent = String(n);
    const now = Date.now();
    let late = 0;
    rows.forEach((b) => {
      if (b.expectedReturnAt) {
        const t = Date.parse(b.expectedReturnAt);
        if (!Number.isNaN(t) && t < now) late += 1;
      }
    });
    const kpiLate = $('#gpKpiLate');
    if (kpiLate) kpiLate.textContent = String(late);
    const kt = $('#gpKpiTime');
    if (kt) kt.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fillReturnSelect(rows) {
    const sel = $('#gpRetSelect');
    if (!sel) return;
    sel.replaceChildren();
    const head = document.createElement('option');
    head.value = '';
    head.textContent = rows.length ? 'Select borrow…' : 'No open borrows';
    sel.appendChild(head);
    for (const b of rows) {
      const o = document.createElement('option');
      o.value = String(b.id || '').trim();
      o.textContent = `${b.partSn || ''} → ${b.targetServerSn || ''} · ${fmtTime(b.borrowedAt)}`.trim();
      sel.appendChild(o);
    }
  }

  function renderTable(rows) {
    const tbody = $('#gpTableBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:1.2rem;color:var(--fg-muted)">No open golden sample borrows.</td></tr>';
      return;
    }
    const now = Date.now();
    tbody.innerHTML = rows
      .map((b) => {
        const t0 = Date.parse(b.borrowedAt || '');
        const ms = Number.isNaN(t0) ? 0 : Math.max(0, now - t0);
        const exp = b.expectedReturnAt ? fmtTime(b.expectedReturnAt) : '—';
        const late =
          b.expectedReturnAt && !Number.isNaN(Date.parse(b.expectedReturnAt)) &&
          Date.parse(b.expectedReturnAt) < now;
        return `<tr data-borrow-id="${esc(b.id)}">
          <td class="mono" style="font-weight:700">${esc(b.partSn)}</td>
          <td>${esc(b.targetServerSn)}</td>
          <td>${esc(b.operatorName || b.operatorId || '—')}</td>
          <td>${fmtTime(b.borrowedAt)}</td>
          <td>${durLabel(ms)}</td>
          <td style="color:${late ? 'var(--danger)' : 'inherit'}">${esc(exp)}</td>
          <td><button type="button" class="gp-btn" data-gp-return="${esc(b.id)}">Return</button></td>
        </tr>`;
      })
      .join('');

    tbody.onclick = (e) => {
      const btn = e.target.closest('[data-gp-return]');
      if (!btn) return;
      const id = btn.getAttribute('data-gp-return');
      const sel = $('#gpRetSelect');
      if (sel) sel.value = id;
      $('#gpRetPart').value = '';
      $('#gpRetMsg').textContent = '';
    };
  }

  async function loadList() {
    try {
      const r = await apiFetch('/tools/golden-parts', { method: 'GET' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || r.statusText);
      const data = await r.json();
      lastRows = Array.isArray(data.borrows) ? data.borrows : [];
      updateBadges(lastRows);
      fillReturnSelect(lastRows);
      renderTable(lastRows);
    } catch (e) {
      const tbody = $('#gpTableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:1rem;color:var(--danger)">${esc(
          e.message || 'Failed to load'
        )}</td></tr>`;
      }
    }
  }

  async function submitBorrow() {
    const msg = $('#gpCoMsg');
    const partSn = $('#gpCoPart')?.value?.trim();
    const targetServerSn = $('#gpCoTarget')?.value?.trim();
    const donorServerSn = $('#gpCoDonor')?.value?.trim() || '';
    const notes = $('#gpCoNotes')?.value?.trim() || '';
    if (!partSn || !targetServerSn) {
      setMsg(msg, 'Part serial and target server are required.', false);
      return;
    }
    try {
      const r = await apiFetch('/tools/golden-parts/borrow', {
        method: 'POST',
        body: JSON.stringify({
          partSn,
          targetServerSn,
          donorServerSn,
          notes,
          expectedReturnHours: null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || r.statusText);
      setMsg(msg, 'Borrow logged.', true);
      $('#gpCoPart').value = '';
      $('#gpCoTarget').value = '';
      $('#gpCoDonor').value = '';
      $('#gpCoNotes').value = '';
      await loadList();
    } catch (e) {
      setMsg(msg, e.message || 'Borrow failed', false);
    }
  }

  async function submitReturn() {
    const msg = $('#gpRetMsg');
    const borrowId = $('#gpRetSelect')?.value?.trim() || '';
    const partSn = $('#gpRetPart')?.value?.trim() || '';
    const condition = $('#gpRetCond')?.value || 'Good';
    const notes = $('#gpRetNotes')?.value?.trim() || '';
    if (!borrowId && !partSn) {
      setMsg(msg, 'Pick a borrow or enter part serial.', false);
      return;
    }
    try {
      const r = await apiFetch('/tools/golden-parts/return', {
        method: 'POST',
        body: JSON.stringify({ borrowId, partSn, condition, notes }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || r.statusText);
      setMsg(msg, 'Return logged.', true);
      $('#gpRetPart').value = '';
      $('#gpRetNotes').value = '';
      await loadList();
    } catch (e) {
      setMsg(msg, e.message || 'Return failed', false);
    }
  }

  function wire() {
    $('#gpCoSubmit')?.addEventListener('click', () => submitBorrow());
    $('#gpRetSubmit')?.addEventListener('click', () => submitReturn());
    $('#gpRefreshBtn')?.addEventListener('click', () => loadList());

    window.addEventListener('golden-parts:open', () => loadList());
    window.addEventListener('golden-parts:refresh', () => loadList());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
