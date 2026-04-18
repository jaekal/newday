
// public/js/inventory/theme.js

export function updateThemePreview(theme) {
  const themePreview = document.getElementById('themePreview');
  const colors = {
    "theme-light": "#e0e7ef",
    "theme-dark": "#222831",
    "theme-highcontrast": "#000000",
    "theme-neon": "#3df2fd",
    "theme-mint": "#affcdf",
    "theme-ocean": "#79c2d0",
    "theme-sunset": "#ffc3a0",
    "theme-forest": "#80b918",
    "theme-charcoal": "#333333",
    "theme-lavender": "#c7ceea"
  };
  if (themePreview) themePreview.style.background = colors[theme] || "#0d6efd";
}

export function setTheme(theme) {
  const htmlEl = document.documentElement;
  htmlEl.className = theme;
  localStorage.setItem('theme', theme);
  updateThemePreview(theme);
}

export function initTheme() {
  const themeSelect = document.getElementById('themeSelector');
  const saved = localStorage.getItem('theme') || 'theme-light';
  setTheme(saved);
  if (themeSelect) themeSelect.value = saved;
  if (themeSelect) themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
}
