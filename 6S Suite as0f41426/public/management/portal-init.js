// public/management/portal-init.js
// Extracted from inline <script> in portal.html — CSP fix.
// Wires the Refresh button to the portal reload hook exposed by portal.js.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('refreshBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        if (typeof window.__portalReload === 'function') {
          window.__portalReload();
        }
      });
    }
  });
})();
