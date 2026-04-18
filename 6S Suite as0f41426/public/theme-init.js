// public/theme-init.js
// Loaded as the first script in static and server-rendered pages.
// Applies the saved theme class before CSS paints, preventing theme flash.
(function () {
  try {
    var legacy = {
      'theme-light': 'theme-atlas',
      'theme-dark': 'theme-carbon',
      'theme-mint': 'theme-grove',
      'theme-ocean': 'theme-harbor',
      'theme-sunset': 'theme-dusk',
      'theme-forest': 'theme-grove',
      'theme-charcoal': 'theme-slate',
      'theme-lavender': 'theme-orchid',
      'theme-neon': 'theme-pulse'
    };
    var valid = [
      'theme-command',
      'theme-beacon',
      'theme-atlas',
      'theme-carbon',
      'theme-grove',
      'theme-ember',
      'theme-harbor',
      'theme-slate',
      'theme-orchid',
      'theme-dusk',
      'theme-pulse',
      'theme-highcontrast'
    ];
    var t = localStorage.getItem('themeSelector') || 'theme-command';
    t = legacy[t] || t;
    t = valid.indexOf(t) !== -1 ? t : 'theme-command';
    document.documentElement.className = t;
    localStorage.setItem('themeSelector', t);
  } catch (e) {
    document.documentElement.className = 'theme-command';
  }
})();
