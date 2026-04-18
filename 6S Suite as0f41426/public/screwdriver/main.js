import { fetchAndRenderAll } from './loader.js';
import { connectSocket }     from './realtime.js';
import { setupUI }           from './ui.js';
import { applyFilters }      from './filters.js';
import { state }             from './state.js';

function initBuildingContext() {
  const bldg = (typeof window.getBuilding === 'function' ? window.getBuilding() : null)
    || localStorage.getItem('suite.building.v1')
    || 'Bldg-350';

  state.filters.building = bldg;

  const sel = document.getElementById('buildingFilter');
  if (sel) sel.value = bldg;
}

async function initializeApp() {
  initBuildingContext();

  // Bind UI immediately so buttons always work
  setupUI();

  try {
    await fetchAndRenderAll();
    applyFilters();
    connectSocket(fetchAndRenderAll, { debounceTime: 500 });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchAndRenderAll();
    });
  } catch (err) {
    console.error('App initialization failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
window.app = { initializeApp };