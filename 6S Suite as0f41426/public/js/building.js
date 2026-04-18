/**
 * public/js/building.js
 * Shared building-context helper.
 *
 * Sets the active building from localStorage('suite.building.v1'),
 * injects a locked indicator badge into any element with
 * id="buildingBadgeSlot", and exports getBuilding() for page scripts.
 *
 * Usage in page HTML:
 *   <script src="/js/building.js"></script>
 *   Then call window.getBuilding() to read 'Bldg-350' | 'Bldg-4050'.
 *
 * The badge auto-inserts into #buildingBadgeSlot if present.
 */
(function () {
  const BLDG_KEY = 'suite.building.v1';
  const LABELS   = { 'Bldg-350': 'Building 350', 'Bldg-4050': 'Building 4050' };

  function getBuilding() {
    return localStorage.getItem(BLDG_KEY) || 'Bldg-350';
  }

  function getBuildingLabel() {
    return LABELS[getBuilding()] || getBuilding();
  }

  /** Render the locked badge HTML */
  function badgeHTML(bldg) {
    const label = LABELS[bldg] || bldg;
    return `<a href="/home" title="Change building — return to home"
      style="display:inline-flex;align-items:center;gap:.3rem;padding:.22rem .6rem;
             border-radius:999px;border:1.5px solid var(--accent,#00B4D8);
             background:color-mix(in srgb,var(--accent,#00B4D8) 10%,transparent);
             color:var(--accent,#00B4D8);font-size:.72rem;font-weight:700;
             text-decoration:none;white-space:nowrap;cursor:pointer;
             transition:opacity .15s" aria-label="Active building: ${label}. Click to change.">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
      ${label}
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" title="Locked — change at home">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </a>`;
  }

  /** Insert badge into slot and any topbar crumb element */
  function insertBadges() {
    const bldg = getBuilding();

    // Primary slot: any element with id="buildingBadgeSlot"
    const slot = document.getElementById('buildingBadgeSlot');
    if (slot) slot.innerHTML = badgeHTML(bldg);

    // Secondary: CF topbar crumb if present
    const crumb = document.getElementById('topbarCrumb');
    if (crumb && !crumb.querySelector('a[href="/home"]')) {
      const span = document.createElement('span');
      span.style.cssText = 'margin-left:.5rem';
      span.innerHTML = badgeHTML(bldg);
      crumb.appendChild(span);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertBadges);
  } else {
    insertBadges();
  }

  // Expose globally
  window.getBuilding     = getBuilding;
  window.getBuildingLabel = getBuildingLabel;
})();
