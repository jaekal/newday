// public/inventory/filter-toggle.js

(function initFilterToggle() {
  const btn = document.getElementById('filterToggleBtn');
  const bar = document.getElementById('filterBar');
  const badge = document.getElementById('filterCountBadge');

  if (!btn || !bar) return;

  function countActiveFilters() {
    let count = 0;
    const ids = ['filterSearch', 'filterStatus', 'filterCategory', 'filterMinQty', 'filterMaxQty'];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (String(el.value || '').trim()) count += 1;
    });

    return count;
  }

  function updateBadge() {
    if (!badge) return;

    const count = countActiveFilters();
    badge.textContent = String(count);
    badge.classList.toggle('has-filters', count > 0);

    if (count > 0) {
      btn.classList.add('active');
    } else if (!bar.classList.contains('open')) {
      btn.classList.remove('active');
    }
  }

  function toggleBar() {
    const open = bar.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));

    if (open) {
      btn.classList.add('active');
    } else if (countActiveFilters() === 0) {
      btn.classList.remove('active');
    }
  }

  btn.addEventListener('click', toggleBar);

  ['filterSearch', 'filterStatus', 'filterCategory', 'filterMinQty', 'filterMaxQty'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', updateBadge);
    el.addEventListener('change', updateBadge);
  });

  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setTimeout(updateBadge, 50);
    });
  }

  setTimeout(() => {
    if (countActiveFilters() > 0) {
      bar.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('active');
    }
    updateBadge();
  }, 200);
})();

(function initCustomPagerAndLength() {
  const lenSel = document.getElementById('invPageLen');
  const infoEl = document.getElementById('invTableInfo');
  const pagerEl = document.getElementById('invTablePager');

  function getTable() {
    if (typeof window.$ === 'undefined' || !$.fn || !$.fn.DataTable) return null;
    const $table = $('#inventoryTable');
    if (!$table.length || !$.fn.DataTable.isDataTable($table)) return null;
    return $table.DataTable();
  }

  function renderInfo(dt) {
    if (!dt || !infoEl) return;

    const info = dt.page.info();
    const total = info.recordsTotal;
    const filtered = info.recordsDisplay;

    if (total === 0) {
      infoEl.textContent = 'No entries';
      return;
    }

    const start = info.start + 1;
    const end = info.end;

    infoEl.textContent = filtered < total
      ? `Showing ${start}–${end} of ${filtered} (filtered from ${total})`
      : `Showing ${start}–${end} of ${total} entries`;
  }

  function renderPager(dt) {
    if (!dt || !pagerEl) return;

    const info = dt.page.info();
    pagerEl.innerHTML = '';

    if (info.pages <= 1) return;

    function makeButton(label, page, disabled, current) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-btn inv-btn--sm';
      button.textContent = label;
      button.disabled = disabled;

      if (current) {
        button.style.background = 'var(--accent)';
        button.style.color = '#fff';
        button.style.borderColor = 'var(--accent)';
        button.style.fontWeight = '700';
      }

      if (!disabled) {
        button.addEventListener('click', () => {
          dt.page(page).draw('page');
        });
      } else {
        button.style.opacity = '.35';
        button.style.cursor = 'not-allowed';
      }

      pagerEl.appendChild(button);
    }

    makeButton('← Prev', info.page - 1, info.page === 0, false);

    const lo = Math.max(0, info.page - 2);
    const hi = Math.min(info.pages - 1, info.page + 2);

    for (let p = lo; p <= hi; p += 1) {
      makeButton(String(p + 1), p, false, p === info.page);
    }

    makeButton('Next →', info.page + 1, info.page >= info.pages - 1, false);
  }

  function refreshFooter() {
    const dt = getTable();
    if (!dt) {
      setTimeout(refreshFooter, 300);
      return;
    }

    renderInfo(dt);
    renderPager(dt);

    if (lenSel) lenSel.value = String(dt.page.len());
  }

  if (lenSel) {
    lenSel.addEventListener('change', () => {
      const dt = getTable();
      if (!dt) return;
      const value = Number.parseInt(lenSel.value, 10);
      dt.page.len(value).draw();
    });
  }

  $(document).on('draw.dt init.dt', '#inventoryTable', () => {
    setTimeout(refreshFooter, 0);
  });

  setTimeout(refreshFooter, 700);
})();

(function wireHeaderSelectAll() {
  function syncSelectAll() {
    const header = document.getElementById('selectAll');
    if (!header) return;

    const rowChecks = Array.from(document.querySelectorAll('#inventoryTable tbody .row-select'));
    if (!rowChecks.length) {
      header.checked = false;
      header.indeterminate = false;
      return;
    }

    const checked = rowChecks.filter((cb) => cb.checked).length;
    header.checked = checked > 0 && checked === rowChecks.length;
    header.indeterminate = checked > 0 && checked < rowChecks.length;
  }

  const header = document.getElementById('selectAll');
  if (header && !header.dataset.wired) {
    header.dataset.wired = '1';
    header.addEventListener('change', () => {
      document.querySelectorAll('#inventoryTable tbody .row-select').forEach((cb) => {
        cb.checked = header.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }

  document.addEventListener('change', (event) => {
    if (event.target && event.target.matches('#inventoryTable tbody .row-select')) {
      syncSelectAll();
    }
  });

  $(document).on('draw.dt init.dt', '#inventoryTable', () => {
    setTimeout(syncSelectAll, 0);
  });
})();

(function wireToolbarClearButton() {
  const btn = document.getElementById('clearFiltersBtn2');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const ids = ['filterSearch', 'filterStatus', 'filterCategory', 'filterMinQty', 'filterMaxQty'];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = '';
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });

    const badge = document.getElementById('filterCountBadge');
    if (badge) {
      badge.textContent = '0';
      badge.classList.remove('has-filters');
    }

    const toggleBtn = document.getElementById('filterToggleBtn');
    const bar = document.getElementById('filterBar');
    if (toggleBtn && bar) {
      toggleBtn.classList.remove('active');
      bar.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
})();