// public/js/inventory/formHandlers.js

import * as api from './api.js';
import { renderTable, populateCategoryOptions, setSourceData } from './render.js';
import { closeAllModals } from './modals.js';

const NotyfCtor = window.Notyf || function () { return { success(){}, error(){}, open(){} }; };
const notyf = window.notyf || new NotyfCtor({ duration: 3500, position: { x: 'right', y: 'bottom' } });

function activeBuilding() {
  return window.inventoryBuildingScope?.activeBuilding?.() || 'Bldg-350';
}

function confirmBuildingScope(actionLabel, targetBuilding = activeBuilding()) {
  return window.inventoryBuildingScope?.confirm?.(actionLabel, targetBuilding) ?? true;
}

/* ───────────────────────────────────────────────────────────────
   Helpers
─────────────────────────────────────────────────────────────── */
const toNumber = (v, d = 0) => {
  if (v === '' || v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const clampNonNegative = (n) => (n < 0 ? 0 : n);

function setFormDisabled(form, disabled) {
  form.setAttribute('aria-busy', disabled ? 'true' : 'false');
  form.querySelectorAll('button, input, select, textarea').forEach(el => {
    el.disabled = !!disabled;
  });
}

function showInlineError(msgText) {
  let msg = document.querySelector('#modalForm .form-error');
  if (!msg) {
    msg = document.createElement('div');
    msg.className = 'form-error text-red-600 font-bold mb-2';
    const form = document.getElementById('modalForm');
    if (form) form.prepend(msg);
  }
  msg.textContent = msgText;
}

function clearInlineError() {
  const msg = document.querySelector('#modalForm .form-error');
  if (msg) msg.remove();
}

function bindClearErrorOnInput(form) {
  const clear = () => clearInlineError();
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);
}

function extractErrorMessage(err) {
  try {
    if (!err) return 'Request failed';
    if (typeof err === 'string') return err;
    if (Array.isArray(err.details) && err.details.length) {
      const detailText = err.details
        .map((d) => d?.message || `${d?.path || 'field'} is invalid`)
        .filter(Boolean)
        .join(' ');
      if (err.message) return `${err.message} ${detailText}`.trim();
      return detailText || 'Request failed';
    }
    if (err.message && err.status) return `${err.message} (HTTP ${err.status})`;
    if (err.message) return err.message;
    return 'Request failed';
  } catch {
    return 'Request failed';
  }
}

/* ───────────────────────────────────────────────────────────────
   Drag-and-drop image upload — inventory Add/Edit modal (Order tab)
─────────────────────────────────────────────────────────────── */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function bindEditImageUpload(form) {
  const zone      = document.getElementById('imgDropZone');
  const fileInput = document.getElementById('editImageInput');
  const idleSlot  = document.getElementById('imgDropIdle');
  const activeSlot = document.getElementById('imgDropActive');
  const previewSlot = document.getElementById('imgDropPreview');
  const thumb     = document.getElementById('editImageThumb');
  const removeBtn = document.getElementById('editImageRemove');
  const replaceBtn = document.getElementById('imgDropReplace');
  const filenameEl = document.getElementById('imgDropFilename');

  if (!zone || !fileInput) return;

  // ── Slot switcher ────────────────────────────────────────────
  function showSlot(name) {
    if (idleSlot)    idleSlot.hidden    = (name !== 'idle');
    if (activeSlot)  activeSlot.hidden  = (name !== 'active');
    if (previewSlot) previewSlot.hidden = (name !== 'preview');
  }

  function showError(msg) {
    zone.classList.add('has-error');
    let errEl = zone.querySelector('.img-dropzone__error');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.className = 'img-dropzone__error';
      zone.appendChild(errEl);
    }
    errEl.textContent = msg;
    showSlot('idle');
  }

  function clearError() {
    zone.classList.remove('has-error');
    zone.querySelector('.img-dropzone__error')?.remove();
  }

  // ── Load existing server image when modal opens ───────────────
  // Called from openItemModal() below via window._refreshDropZone
  window._refreshDropZone = function(code) {
    clearError();
    if (!code) { showSlot('idle'); return; }

    const testImg = new Image();
    testImg.onload = () => {
      if (thumb) {
        thumb.src = `${api.imageUrl(code)}?cb=${Date.now()}`;
        thumb.onerror = () => showSlot('idle');
      }
      if (filenameEl) filenameEl.textContent = 'Current image';
      showSlot('preview');
    };
    testImg.onerror = () => showSlot('idle');
    testImg.src = `${api.imageUrl(code)}?cb=${Date.now()}`;
  };

  // ── Validate file before upload ───────────────────────────────
  function validate(file) {
    if (!file) return 'No file selected.';
    if (!ALLOWED_IMAGE_TYPES.has(file.type))
      return `Unsupported type "${file.type}". Use JPEG, PNG, GIF, or WebP.`;
    if (file.size > MAX_IMAGE_BYTES)
      return `File too large (${(file.size / 1048576).toFixed(1)} MB). Max 5 MB.`;
    return null;
  }

  // ── Core upload ───────────────────────────────────────────────
  async function doUpload(file) {
    const code = form?.elements?.ItemCode?.value?.trim();
    if (!code) {
      notyf.error('Save the item first before uploading an image.');
      return;
    }

    const err = validate(file);
    if (err) { showError(err); return; }

    clearError();
    zone.classList.add('is-uploading');
    setFormDisabled(form, true);

    // Show local preview immediately for responsiveness
    const localUrl = URL.createObjectURL(file);
    if (thumb) { thumb.src = localUrl; }
    if (filenameEl) filenameEl.textContent = file.name;
    showSlot('preview');

    try {
      await api.uploadImage(code, file);
      // Replace blob URL with the real server URL
      if (thumb) {
        thumb.src = `${api.imageUrl(code)}?cb=${Date.now()}`;
        thumb.onerror = () => { thumb.src = localUrl; };
      }
      notyf.success('Image uploaded');
    } catch (e) {
      showSlot('idle');
      showError(extractErrorMessage(e) || 'Upload failed');
      notyf.error(extractErrorMessage(e) || 'Upload failed');
    } finally {
      URL.revokeObjectURL(localUrl);
      zone.classList.remove('is-uploading');
      setFormDisabled(form, false);
      fileInput.value = '';
    }
  }

  // ── Click / keyboard → open file picker ──────────────────────
  zone.addEventListener('click', (e) => {
    // Don't open picker when clicking the Remove or Replace buttons
    if (e.target.closest('#editImageRemove') || e.target.closest('#imgDropReplace')) return;
    fileInput.click();
  });
  zone.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) {
      e.preventDefault();
      fileInput.click();
    }
  });

  // ── File input change (click-to-select path) ──────────────────
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) doUpload(file);
  });

  // ── "Replace" button inside preview slot ─────────────────────
  if (replaceBtn) {
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // ── Drag events ───────────────────────────────────────────────
  let dragCounter = 0; // tracks nested dragenter/dragleave pairs

  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      zone.classList.add('is-over');
      showSlot('active');
    }
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  zone.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      zone.classList.remove('is-over');
      // Return to whichever slot was showing before the drag started
      const hasThumb = thumb && thumb.src && !thumb.src.endsWith('/image');
      showSlot(hasThumb ? 'preview' : 'idle');
    }
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    zone.classList.remove('is-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) doUpload(file);
  });

  // ── Remove image ──────────────────────────────────────────────
  if (removeBtn) {
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = form?.elements?.ItemCode?.value?.trim();
      if (!code) return;
      if (!confirm('Remove image for this item?')) return;

      clearError();
      setFormDisabled(form, true);
      try {
        await api.deleteImage(code);
        showSlot('idle');
        notyf.success('Image removed');
      } catch (err) {
        notyf.error(extractErrorMessage(err) || 'Delete failed');
      } finally {
        setFormDisabled(form, false);
      }
    });
  }

  // Initialise to idle on first bind
  showSlot('idle');
}

/* ───────────────────────────────────────────────────────────────
   Main binder
─────────────────────────────────────────────────────────────── */
export function bindFormEvents() {
  // Grab forms
  const modalForm = document.getElementById('modalForm');
  const checkoutForm = document.getElementById('checkoutForm');

  // Prevent duplicate bindings by cloning (removes any pre-bound listeners)
  if (modalForm) modalForm.replaceWith(modalForm.cloneNode(true));
  const freshModalForm = document.getElementById('modalForm');

  if (freshModalForm) {
    bindClearErrorOnInput(freshModalForm);
    bindEditImageUpload(freshModalForm);

    // Add/Edit submit
    freshModalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;

      const required = [
        { el: f.ItemCode, name: 'Item Code' },
        { el: f.Description, name: 'Description' }
      ];
      const missing = required.find(({ el }) => !el?.value?.trim());
      if (missing) {
        showInlineError(`${missing.name} is required.`);
        document.getElementById('tabBtnBasic')?.click();
        missing.el?.focus();
        return;
      } else {
        clearInlineError();
      }

      const data = {
        ItemCode: (f.ItemCode.value || '').trim(),
        Location: (f.Location.value || '').trim(),
        Building: (f.Building?.value || '').trim() || activeBuilding(),
        Description: (f.Description.value || '').trim(),
        Category: (f.Category?.value || '').trim(),
        OnHandQty: clampNonNegative(toNumber(f.OnHandQty.value, 0)),
        UnitPrice: clampNonNegative(toNumber(f.UnitPrice.value, 0)),
        SafetyWarningOn: !!f.SafetyWarningOn?.checked,
        SafetyLevelQty: clampNonNegative(toNumber(f.SafetyLevelQty.value, 0)),
        Vendor: (f.Vendor?.value || '').trim(),
        PurchaseLink: (f.PurchaseLink.value || '').trim(),
        OrderDate: f.OrderDate.value || '',
        ExpectedArrival: f.ExpectedArrival.value || '',
        TrackingNumber: (f.TrackingNumber.value || '').trim(),
        PurchaseOrderNumber: (f.PurchaseOrderNumber?.value || '').trim(),
        OrderStatus: f.OrderStatus?.value || 'Ordered'
      };

      const originalItemCode = f.originalItemCode?.value?.trim() || '';
      const isEditing = Boolean(originalItemCode);
      if (!confirmBuildingScope(isEditing ? 'update this inventory item' : 'create this inventory item', data.Building)) {
        return;
      }

      setFormDisabled(f, true);

      try {
        if (isEditing) {
          data.originalItemCode = originalItemCode;
          await api.saveItem(originalItemCode, data, true);
          window._lastEditedCode = data.ItemCode;
          notyf.success('Item updated!');
        } else {
          await api.saveItem(data.ItemCode, data, false);
          window._lastEditedCode = data.ItemCode;
          notyf.success('Item created!');
        }

        closeAllModals();

        const refreshed = await api.fetchInventory({ building: activeBuilding() });
        setSourceData(refreshed);
        populateCategoryOptions(refreshed);
        await renderTable(refreshed);

        document.dispatchEvent(new Event('inventoryUpdated'));
      } catch (err) {
        console.error('Save error:', err);
        const msg = extractErrorMessage(err) || 'Save failed';
        showInlineError(msg);
        notyf.error(msg);
      } finally {
        setFormDisabled(f, false);
      }
    });

    freshModalForm.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        freshModalForm.requestSubmit();
      }
    });
  }

  if (checkoutForm) checkoutForm.replaceWith(checkoutForm.cloneNode(true));
  const freshCheckoutForm = document.getElementById('checkoutForm');

  if (freshCheckoutForm) {
    freshCheckoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;

      const code =
        f.dataset.code ||
        document.getElementById('checkoutModal')?.dataset.code ||
        window.checkoutCode ||
        '';

      const qty = Math.max(0, parseInt(f.elements['CheckoutQty']?.value, 10) || 0);
      const operatorId = (f.elements['operatorId']?.value || '').trim();
      const sixSOperator = (f.elements['sixSOperator']?.value || '').trim();

      if (!code) return notyf.error('Missing item code.');
      if (!operatorId) { notyf.error('Tech ID required.'); f.elements['operatorId']?.focus(); return; }
      if (!sixSOperator) { notyf.error('6S Operator required.'); f.elements['sixSOperator']?.focus(); return; }
      if (!qty || qty <= 0) { notyf.error('Checkout quantity must be positive.'); f.elements['CheckoutQty']?.focus(); return; }

      setFormDisabled(f, true);

      try {
        const res = await api.checkoutItem(code, { qty, operatorId, sixSOperator });
        const msg = res.item && typeof res.item.OnHandQty === 'number'
          ? `Checked out. Remaining: ${res.item.OnHandQty}`
          : 'Checked out successfully!';
        notyf.success(msg);

        closeAllModals();

        const refreshed = await api.fetchInventory({ building: activeBuilding() });
        setSourceData(refreshed);
        populateCategoryOptions(refreshed);
        await renderTable(refreshed);
      } catch (err) {
        console.error('Checkout error:', err);
        notyf.error(extractErrorMessage(err) || 'Checkout failed');
      } finally {
        setFormDisabled(f, false);
      }
    });

    freshCheckoutForm.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        freshCheckoutForm.requestSubmit();
      }
    });
  }
}
