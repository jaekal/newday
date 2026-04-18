// public/js/inventory/modals.js

let _wired = false;
let _lastFocusedEl = null;
let _pendingConfirm = null;

function getBackdrop(el) {
  return el?.closest?.('.modal-backdrop') || null;
}
function isOpen(backdrop) {
  if (!backdrop) return false;
  return backdrop.classList.contains('active') && backdrop.getAttribute('aria-hidden') !== 'true';
}
function isVisible(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.hidden) return false;
  if (el.closest('.hidden')) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
}
function getFocusable(panel) {
  const all = panel.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  );
  return Array.from(all).filter(isVisible);
}

export function trapFocus(modalPanel) {
  function handleKey(e) {
    if (e.key === 'Tab') {
      const focusable = getFocusable(modalPanel);
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { last.focus(); e.preventDefault(); }
      } else if (document.activeElement === last) {
        first.focus(); e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      const backdrop = getBackdrop(modalPanel);
      backdrop && closeModal(backdrop);
    }
  }

  if (modalPanel._trapHandler) modalPanel.removeEventListener('keydown', modalPanel._trapHandler);
  modalPanel._trapHandler = handleKey;
  modalPanel.addEventListener('keydown', handleKey);

  setTimeout(() => {
    const focusable = getFocusable(modalPanel);
    const target = focusable[0] || modalPanel;
    if (!modalPanel.contains(document.activeElement)) target.focus?.();
  }, 10);
}

export function switchItemModalTab(tabId = 'tabBasic') {
  document.querySelectorAll('#itemModal .tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#itemModal .tab-pane').forEach(pane => {
    pane.classList.toggle('hidden', pane.id !== tabId);
  });

  const panel = document.querySelector('#itemModal .modal');
  if (panel) trapFocus(panel);
}

function show(backdrop) {
  if (!backdrop) return;
  _lastFocusedEl = document.activeElement;

  backdrop.classList.add('active');
  backdrop.removeAttribute('aria-hidden');
  backdrop.style.display = 'block';

  const panel = backdrop.querySelector('.modal') || backdrop;
  if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
  if (!panel.hasAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');

  if (!panel.hasAttribute('aria-labelledby')) {
    const h = panel.querySelector('h1,h2,h3,h4,h5,h6,[id^="modalTitle"]');
    if (h?.id) panel.setAttribute('aria-labelledby', h.id);
  }

  document.body.style.overflow = 'hidden';
  setTimeout(() => trapFocus(panel), 30);
}

function hide(backdrop) {
  if (!backdrop) return;

  const panel = backdrop.querySelector('.modal') || backdrop;
  if (panel._trapHandler) {
    panel.removeEventListener('keydown', panel._trapHandler);
    panel._trapHandler = null;
  }

  backdrop.classList.remove('active');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.style.display = 'none';

  const anyOpen = Array.from(document.querySelectorAll('.modal-backdrop')).some(isOpen);
  if (!anyOpen) document.body.style.overflow = '';

  if (_lastFocusedEl && typeof _lastFocusedEl.focus === 'function') {
    try { _lastFocusedEl.focus(); } catch {}
  }
}

export function openModalById(id) {
  closeAllModals();
  const backdrop = document.getElementById(id);
  if (backdrop) show(backdrop);
}
export function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    if (isOpen(backdrop)) hide(backdrop);
  });
}
export function closeModal(target) {
  const backdrop = typeof target === 'string' ? document.getElementById(target) : target;
  if (backdrop && isOpen(backdrop)) hide(backdrop);
}

export function openModal(arg = {}) {
  if (typeof arg === 'string') {
    openModalById(arg);
    return;
  }
  if (arg instanceof HTMLElement) {
    closeAllModals();
    show(arg);
    return;
  }

  const form = document.getElementById('modalForm');
  if (!form) return;

  switchItemModalTab('tabBasic');

  const set = (name, val) => { if (name in form) form[name].value = val ?? ''; };
  const setBool = (name, checked) => { if (name in form) form[name].checked = !!checked; };

  set('ItemCode', arg.ItemCode);
  set('Location', arg.Location);
  set('Building', arg.Building);
  set('Description', arg.Description);
  set('Category', arg.Category); // ensure Category mapped
  set('OnHandQty', arg.OnHandQty ?? 0);
  set('SafetyLevelQty', arg.SafetyLevelQty ?? 0);
  setBool('SafetyWarningOn', arg.SafetyWarningOn);

  set('UnitPrice', arg.UnitPrice ?? 0);
  set('Vendor', arg.Vendor);
  set('PurchaseLink', arg.PurchaseLink);
  set('OrderStatus', arg.OrderStatus || 'Ordered');
  set('OrderDate', arg.OrderDate);
  set('ExpectedArrival', arg.ExpectedArrival);
  set('TrackingNumber', arg.TrackingNumber);
  set('PurchaseOrderNumber', arg.PurchaseOrderNumber);

  if (form.originalItemCode) {
    form.originalItemCode.value = arg.ItemCode || '';
  } else {
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'originalItemCode';
    hidden.value = arg.ItemCode || '';
    form.appendChild(hidden);
  }

  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.textContent = arg.ItemCode ? 'Edit Item' : 'Add New Item';

  openModalById('itemModal');
}

export function openConfirm(message, onConfirm) {
  const txt = document.getElementById('confirmText');
  if (txt) txt.textContent = message || 'Are you sure?';
  _pendingConfirm = typeof onConfirm === 'function' ? onConfirm : null;
  openModalById('confirmModal');
}

export function bindConfirmButtons() {
  if (_wired) return;
  _wired = true;

  [
    'cancelModal',
    'cancelConfirm',
    'cancelCheckout',
    'cancelAudit',
    'cancelExportAllHistory',
    'closeItemDetails'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-modal-close', 'true');
  });

  document.addEventListener('click', (e) => {
    const target = e.target;

    const openAttr = target.closest?.('[data-modal-open]');
    if (openAttr) {
      const id = openAttr.getAttribute('data-modal-open') || '';
      if (id) {
        e.preventDefault();
        openModalById(id.replace(/^#/, ''));
        return;
      }
    }

    const closeEl = target.closest?.(
      '[data-modal-close], .modal-close, .btn-cancel, [data-action="cancel"], [data-dismiss="modal"]'
    );
    if (closeEl) {
      e.preventDefault();
      const backdrop = getBackdrop(closeEl) || document.querySelector('.modal-backdrop.active');
      backdrop ? closeModal(backdrop) : closeAllModals();
      _pendingConfirm = null;
      return;
    }
  });

  document.addEventListener('mousedown', (e) => {
    const backdrop = e.target?.closest?.('.modal-backdrop');
    if (backdrop && e.target === backdrop) {
      e.preventDefault();
      closeModal(backdrop);
      _pendingConfirm = null;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openBackdrops = Array.from(document.querySelectorAll('.modal-backdrop')).filter(isOpen);
    const topMost = openBackdrops[openBackdrops.length - 1];
    if (topMost) {
      e.preventDefault();
      closeModal(topMost);
      _pendingConfirm = null;
    }
  });

  const confirmBtn = document.getElementById('confirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try { if (_pendingConfirm) await _pendingConfirm(); }
      finally { _pendingConfirm = null; closeAllModals(); }
    });
  }
}
