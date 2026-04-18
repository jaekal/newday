/* public/admin/theme-um.js
 * Theme initialisation for the user-management page.
 * External file — no nonce required, served as a regular static asset.
 */
(function () {
  var sel   = document.getElementById('themeSelector');
  var saved = localStorage.getItem('themeSelector') || 'theme-command';
  document.documentElement.className = saved;
  if (sel) {
    sel.value = saved;
    sel.addEventListener('change', function (e) {
      document.documentElement.className = e.target.value;
      localStorage.setItem('themeSelector', e.target.value);
    });
  }
})();

