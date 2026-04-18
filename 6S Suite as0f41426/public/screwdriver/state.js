//public/screwdriver/state.js

export const state = {
  // ─── Raw & Filtered Data ─────────────────────────────────────
  allTools: [],            // Full tool list loaded from backend
  filteredTools: [],       // Subset of tools after filters applied
  employees: [],           // Full employee list

  // ─── Lookup Maps (for fast rendering and classification) ────
  employeeMap: {},         // Map: { employeeId -> name }
  employeeShift: {},       // Map: { employeeId -> shift }

  // ─── UI State & Toggles ─────────────────────────────────────
  isAdmin: false,          // Whether current session is admin
  sortAsc: true,           // Toggle for sort direction
  openTiers: [0],          // Expanded tier indices

  // ─── Async State Flags ──────────────────────────────────────
  isLoading: false,        // Show loading spinner or block UI
  error: null,             // Capture error messages globally

  // ─── Active Filters (synced with UI) ────────────────────────
  filters: {
    search: '',            // Live text search input
    torque: '',            // Selected torque value
    classification: '',    // Selected classification type
    calibration: '',       // calibration status filter
    status: '',            // Status filter: 'being used' | 'in inventory'
    building: (() => { try { return localStorage.getItem('suite.building.v1') || 'Bldg-350'; } catch { return 'Bldg-350'; } })()
  }
};
