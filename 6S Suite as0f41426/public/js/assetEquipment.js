// public/js/assetEquipment.js
// Client-side logic for the equipment itemType feature in the Asset Catalog.
// Loaded alongside the existing assetTable.js — does not replace it.
// Handles:
//   1. Item type toggle in the create/edit modal
//   2. Record Calibration modal
//   3. Checkout / Return buttons in the asset table rows

'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"]/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])
);
const fmt = iso => iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

// ── 1. Item type toggle in modal ─────────────────────────────────────────────
// Equipment classes that have a torque spec. Kept in sync with the
// data-torque="true" markers on #equipmentClass options in views/index.ejs.
const TORQUE_CLASSES = new Set(['Screwdriver', 'Drill', 'Torque Wrench']);

function syncCategoryVisibility(itemType) {
  const select = document.getElementById('category');
  if (!select) return;

  const visible = (group) =>
    group === 'both' || group === itemType || !group;

  // Toggle both optgroup containers AND their child options. Safari ignores
  // display:none on optgroup, so we apply the HTML-standard hidden attribute
  // to every option underneath a hidden group. We deliberately do NOT set
  // `disabled` — that would block programmatic .value assignment during
  // populateForm() in edit mode.
  select.querySelectorAll('optgroup').forEach((og) => {
    const show = visible(og.dataset.context);
    og.hidden = !show;
    og.querySelectorAll('option').forEach((opt) => {
      opt.hidden = !show;
    });
  });

  // If the currently selected option is now hidden, reset to the blank
  // placeholder so the field visibly reflects the switch.
  const current = select.selectedOptions[0];
  if (current && current.hidden) select.value = '';
}

function syncEquipmentClassVisibility(itemType) {
  const field = document.getElementById('fieldEquipmentClass');
  const select = document.getElementById('equipmentClass');
  if (!field || !select) return;

  if (itemType === 'equipment') {
    field.hidden = false;
    field.style.display = '';
  } else {
    field.hidden = true;
    field.style.display = 'none';
    select.value = '';
    // Cascade to torque so it recomputes visibility.
    syncTorqueVisibility('');
  }
}

function syncTorqueVisibility(equipmentClass) {
  const field = document.getElementById('fieldTorque');
  const input = document.getElementById('torque');
  if (!field || !input) return;

  const show = TORQUE_CLASSES.has(String(equipmentClass || '').trim());
  field.hidden = !show;
  field.style.display = show ? '' : 'none';
  if (!show) input.value = '';
}

function syncToolClassificationVisibility(itemType) {
  const field = document.getElementById('fieldToolClassification');
  const select = document.getElementById('toolClassification');
  const hint = document.getElementById('toolClassificationHint');
  if (!field || !select) return;

  if (itemType === 'equipment') {
    field.hidden = false;
    field.style.display = '';
  } else {
    field.hidden = true;
    field.style.display = 'none';
    select.value = '';
    select.required = false;
    if (hint) hint.style.display = 'none';
  }
}

// Applies the per-equipment-class default/requirement rules:
//   • Screwdriver      → default to 'manual' if no value is set yet
//   • Drill            → force an explicit wired/wireless selection
//   • Everything else  → no enforcement, keep whatever is already selected
// This function never overwrites an existing non-empty value, so editing an
// asset that already carries a classification preserves the user's choice.
function applyToolClassificationRule(equipmentClass) {
  const select = document.getElementById('toolClassification');
  const hint = document.getElementById('toolClassificationHint');
  if (!select) return;

  const cls = String(equipmentClass || '').trim();
  const current = String(select.value || '').trim();

  if (cls === 'Screwdriver') {
    if (!current) select.value = 'manual';
    select.required = false;
    if (hint) hint.style.display = 'none';
    return;
  }

  if (cls === 'Drill') {
    if (current === 'manual') select.value = '';
    select.required = true;
    if (hint) hint.style.display = current === 'wired' || current === 'wireless' ? 'none' : 'block';
    return;
  }

  select.required = false;
  if (hint) hint.style.display = 'none';
}

function initItemTypeToggle() {
  const fleetBtn    = document.getElementById('typeBtnFleet');
  const equipBtn    = document.getElementById('typeBtnEquipment');
  const itemTypeInput = document.getElementById('itemType');
  const calTab      = document.getElementById('tabCalibration');
  const equipmentClassSelect = document.getElementById('equipmentClass');

  if (!fleetBtn || !equipBtn || !itemTypeInput) return;

  function setType(type) {
    itemTypeInput.value = type;

    fleetBtn.classList.toggle('active', type === 'fleet');
    equipBtn.classList.toggle('active', type === 'equipment');

    // Calibration data is editable for both fleet and equipment items.
    if (calTab) calTab.style.display = '';

    syncCategoryVisibility(type);
    syncEquipmentClassVisibility(type);
    syncToolClassificationVisibility(type);
    if (type === 'equipment') {
      const currentClass = equipmentClassSelect?.value || '';
      syncTorqueVisibility(currentClass);
      applyToolClassificationRule(currentClass);
    }

    // Update preview
    const prev = document.getElementById('preview-itemType');
    if (prev) prev.textContent = type === 'equipment' ? 'Test equipment' : 'Fleet asset';
    const calRow = document.getElementById('preview-cal-row');
    if (calRow) calRow.style.display = type === 'equipment' ? '' : 'none';
  }

  fleetBtn.addEventListener('click',  () => setType('fleet'));
  equipBtn.addEventListener('click',  () => setType('equipment'));

  // Recompute torque visibility + tool-classification defaults whenever the
  // equipment class changes.
  equipmentClassSelect?.addEventListener('change', () => {
    syncTorqueVisibility(equipmentClassSelect.value);
    applyToolClassificationRule(equipmentClassSelect.value);
  });

  // Keep the Drill "choose wired or wireless" hint in sync as the user picks.
  document.getElementById('toolClassification')?.addEventListener('change', () => {
    applyToolClassificationRule(equipmentClassSelect?.value || '');
  });

  // When modal opens with existing asset data (edit mode), sync the toggle
  document.addEventListener('assetModalOpened', (e) => {
    const type = e.detail?.itemType || 'fleet';
    setType(type);

    // Populate equipment fields
    const sn = document.getElementById('serialNumber');
    const ld = document.getElementById('lastCalibrationDate');
    const nd = document.getElementById('nextCalibrationDue');
    const id = document.getElementById('calibrationIntervalDays');
    if (sn) sn.value = e.detail?.serialNumber || '';
    if (ld) ld.value = e.detail?.lastCalibrationDate || '';
    if (nd) nd.value = e.detail?.nextCalibrationDue || '';
    if (id) id.value = e.detail?.calibrationIntervalDays || '';

    // Re-sync torque + tool-classification rule after equipmentClass was
    // populated by the main form loop.
    const currentClass = equipmentClassSelect?.value || '';
    syncTorqueVisibility(currentClass);
    applyToolClassificationRule(currentClass);
  });

  // Set default type on initial load
  setType('fleet');
}

// ── 2. Record Calibration modal ──────────────────────────────────────────────
function initCalibrationModal() {
  const overlay  = document.getElementById('calModalOverlay');
  const form     = document.getElementById('calModalForm');
  const closeBtn = document.getElementById('closeCalModal');
  const subtitle = document.getElementById('calModalSubtitle');

  if (!overlay || !form) return;

  function openCalModal(assetId, tagNumber, name, currentInterval) {
    document.getElementById('calAssetId').value = assetId;
    document.getElementById('calLastDate').value  = new Date().toISOString().slice(0, 10);
    document.getElementById('calNextDue').value   = '';
    document.getElementById('calInterval').value  = currentInterval || '';
    if (subtitle) subtitle.textContent = `${tagNumber} — ${name}`;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('active');
    document.getElementById('calLastDate').focus();
  }

  function closeCalModal() {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.classList.remove('active');
    form.reset();
  }

  if (closeBtn) closeBtn.addEventListener('click', closeCalModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCalModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.getAttribute('aria-hidden') === 'false') closeCalModal();
  });

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const assetId  = document.getElementById('calAssetId').value;
    const lastDate = document.getElementById('calLastDate').value;
    const interval = document.getElementById('calInterval').value;
    const nextDue  = document.getElementById('calNextDue').value;

    const body = { lastCalibrationDate: lastDate };
    if (interval) body.calibrationIntervalDays = parseInt(interval, 10);
    if (nextDue)  body.nextCalibrationDue = nextDue;

    try {
      const r = await fetch(`/asset-catalog/${assetId}/calibration`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || r.statusText);

      window.notyf?.success(`Calibration recorded. Next due: ${fmt(data.nextCalibrationDue)}`);
      closeCalModal();
      // Reload the page so the table reflects the new cal date
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      window.notyf?.error(`Failed: ${err.message}`);
    }
  });

  // Expose opener for table row buttons
  window.__openCalModal = openCalModal;
}

// ── 3. Checkout / Return buttons in table rows ───────────────────────────────
function initTableEquipmentActions() {
  // Delegate clicks on dynamically rendered table rows
  document.addEventListener('click', async (e) => {
    // Record Calibration button
    const calBtn = e.target.closest('[data-action="record-cal"]');
    if (calBtn) {
      const { id, tag, name, interval } = calBtn.dataset;
      window.__openCalModal?.(id, tag, name, interval);
      return;
    }

    // Checkout button
    const coBtn = e.target.closest('[data-action="checkout-equipment"]');
    if (coBtn) {
      const { id, tag, name } = coBtn.dataset;
      const operatorId = prompt(`Check out ${tag} — ${name}\n\nEnter Tech ID:`);
      if (!operatorId?.trim()) return;
      await equipmentAction(`/asset-catalog/${id}/checkout`, 'POST',
        { operatorId: operatorId.trim() },
        `${tag} checked out`
      );
      return;
    }

    // Return (checkin) button
    const retBtn = e.target.closest('[data-action="return-equipment"]');
    if (retBtn) {
      const { id, tag, name } = retBtn.dataset;
      const condition = confirm(`Return ${tag} — ${name}\n\nIs the equipment in good condition?\n\nOK = Good condition\nCancel = Needs inspection`)
        ? 'Good'
        : 'Needs Inspection';
      await equipmentAction(`/asset-catalog/${id}/checkin`, 'POST',
        { condition },
        `${tag} returned (${condition})`
      );
    }
  });
}

async function equipmentAction(url, method, body, successMsg) {
  try {
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || r.statusText);
    window.notyf?.success(successMsg);
    setTimeout(() => window.location.reload(), 600);
  } catch (err) {
    window.notyf?.error(`Failed: ${err.message}`);
  }
}

// ── 4. Calibration status helper (used by asset-table partial) ───────────────
// Exposed as a global so the EJS partial can call it when rendering inline
window.__calStatus = function(nextCalibrationDue) {
  if (!nextCalibrationDue) return { cls: 'cal-none', label: 'Not set' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due   = new Date(nextCalibrationDue);
  const days  = Math.ceil((due - today) / 86_400_000);
  if (days < 0)   return { cls: 'cal-overdue',  label: `Overdue ${Math.abs(days)}d` };
  if (days <= 14) return { cls: 'cal-due-soon', label: `Due in ${days}d` };
  return { cls: 'cal-ok', label: fmt(nextCalibrationDue) };
};

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initItemTypeToggle();
  initCalibrationModal();
  initTableEquipmentActions();
});
