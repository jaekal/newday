// //public/screwdriver//nav.js
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('themeSelector');
  const saved = localStorage.getItem('themeSelector') || 'theme-command';

  document.documentElement.className = saved;
  if (sel) {
    sel.value = saved;
    sel.addEventListener('change', e => {
      const theme = e.target.value;
      document.documentElement.className = theme;
      localStorage.setItem('themeSelector', theme);
    });
  }
});

