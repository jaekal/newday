import { readFileSync, writeFileSync } from 'fs';

const path = 'src/public/styles.css';
const css = readFileSync(path, 'utf8');

const START = `/* =============================================================================
   THEME: Forge — Light professional. Navy navbar + warm white body. Red-orange`;

const END_MARKER = `/* =============================================================================
   THEME: Canvas — Light professional. White + deep navy. Clean enterprise.`;

const startIdx = css.indexOf(START);
const endIdx   = css.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate Forge block. start:', startIdx, 'end:', endIdx);
  process.exit(1);
}

const FORGE_BLOCK = `/* =============================================================================
   THEME: Forge — Dark background. Navy navbar. Orange cards. Bold red-orange
   brand accent. Warm white text hierarchy. Industrial operations feel.

   Background:   #161616  (near-black, user-set)
   Nav:          #11161C  (dark navy)
   Cards:        #DE4827  (brand orange) with white text
   Primary CTA:  #DE4827  (same orange family)
   Links/accent: #FF9A7A  (warm light orange on dark — readable)
   Main text:    #F8F0EC  (warm white — softer than pure white on dark)
   Muted text:   #FFB09A  (salmon/peach — user-selected, warm secondary)
   Deep muted:   #9A7A70  (tertiary, labels, timestamps)
   Borders:      rgba(222,72,39,0.25) (orange-tinted)
   ============================================================================= */
[data-theme="forge"] {
  /* Backgrounds */
  --bg-app:      #161616;
  --bg-surface:  #1E1E1E;
  --bg-elevated: #252525;
  --bg-overlay:  #2C2C2C;

  /* Borders — orange-tinted to match brand */
  --border-default: rgba(222,72,39,0.22);
  --border-strong:  rgba(222,72,39,0.45);

  /* Brand — red-orange */
  --brand-primary:       #DE4827;
  --brand-primary-muted: rgba(222,72,39,0.18);
  --brand-primary-deep:  #C13B1E;
  --brand-glow:          rgba(222,72,39,0.30);

  /* Text hierarchy on dark bg */
  --text-primary:   #F8F0EC;
  --text-secondary: #FFB09A;
  --text-muted:     #9A7A70;
  --text-inverse:   #161616;

  /* Interaction states — orange family */
  --state-hover:  rgba(222,72,39,0.10);
  --state-active: rgba(222,72,39,0.20);
  --state-focus:  rgba(222,72,39,0.40);

  /* Shadows — dark, warm */
  --shadow-sm:   0 1px 3px rgba(0,0,0,0.50);
  --shadow-md:   0 4px 16px rgba(0,0,0,0.60);
  --shadow-lg:   0 12px 40px rgba(0,0,0,0.70);
  --shadow-glow: 0 0 24px rgba(222,72,39,0.25);

  /* Slightly sharper radius */
  --radius-sm:   0.25rem;
  --radius-md:   0.4rem;
  --radius-lg:   0.6rem;
  --radius-pill: 0.35rem;

  /* Themeable surface tokens */
  --bg-body-from:  #1A1A1A;
  --bg-body-to:    #161616;
  --bg-navbar:     #11161C;
  --bg-card:       #DE4827;
  --shadow-card:   0 0 0 1px rgba(222,72,39,0.35), 0 4px 20px rgba(0,0,0,0.50);
}

/* ── Forge: Body & page ──────────────────────────────────────────────────────── */
[data-theme="forge"] body { background: #161616; color: #F8F0EC; }

/* ── Forge: Navbar ───────────────────────────────────────────────────────────── */
[data-theme="forge"] header { background: #11161C; border-bottom: 1px solid rgba(222,72,39,0.18); }
[data-theme="forge"] header h1 { color: #FFFFFF; }
[data-theme="forge"] nav a,
[data-theme="forge"] .nav-link,
[data-theme="forge"] .nav-dropdown__trigger { color: rgba(248,240,236,0.80); }
[data-theme="forge"] nav a:hover,
[data-theme="forge"] .nav-link:hover { background-color: rgba(222,72,39,0.10); color: #F8F0EC; border-color: rgba(222,72,39,0.30); }
[data-theme="forge"] .nav-link--active,
[data-theme="forge"] .nav-dropdown--active > .nav-dropdown__trigger,
[data-theme="forge"] nav a.nav-link--active { background: rgba(222,72,39,0.20) !important; border-color: rgba(222,72,39,0.55) !important; color: #FF9A7A !important; }
[data-theme="forge"] .role-badge-link { color: #FFB09A; border-color: rgba(222,72,39,0.45); background: rgba(222,72,39,0.15); }
[data-theme="forge"] .role-badge-link:hover { color: #FFFFFF; background: rgba(222,72,39,0.30); border-color: rgba(222,72,39,0.65); }
[data-theme="forge"] .role-badge-link .dot { background: #DE4827; box-shadow: 0 0 6px rgba(222,72,39,0.70); }
[data-theme="forge"] .nav-dropdown__menu { background: #11161C; border: 1px solid rgba(222,72,39,0.22); box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
[data-theme="forge"] .nav-dropdown__item { color: rgba(248,240,236,0.80); }
[data-theme="forge"] .nav-dropdown__item:hover { background: rgba(222,72,39,0.12); color: #F8F0EC; }
[data-theme="forge"] .nav-dropdown__item--active { background: rgba(222,72,39,0.20); color: #FF9A7A; }
[data-theme="forge"] .nav-dropdown__divider { background: rgba(222,72,39,0.18); }
[data-theme="forge"] .nav-search-input { background: rgba(255,255,255,0.06); border-color: rgba(222,72,39,0.22); color: #F8F0EC; }
[data-theme="forge"] .nav-search-input::placeholder { color: rgba(248,240,236,0.35); }
[data-theme="forge"] .nav-search-input:focus { border-color: rgba(222,72,39,0.55); background: rgba(255,255,255,0.10); }

/* ── Forge: Buttons ──────────────────────────────────────────────────────────── */
[data-theme="forge"] .btn.primary,
[data-theme="forge"] button[type="submit"] {
  background: linear-gradient(160deg, #E8573A 0%, #C13B1E 100%);
  border-color: #C13B1E; color: #FFFFFF;
  box-shadow: 0 2px 10px rgba(222,72,39,0.40);
}
[data-theme="forge"] .btn.primary:hover,
[data-theme="forge"] button[type="submit"]:hover {
  background: linear-gradient(160deg, #F06040 0%, #DE4827 100%);
  box-shadow: 0 4px 16px rgba(222,72,39,0.55);
}
[data-theme="forge"] .btn.ghost { background: rgba(255,255,255,0.06); color: #FFB09A; border-color: rgba(222,72,39,0.35); }
[data-theme="forge"] .btn.ghost:hover { background: rgba(222,72,39,0.12); color: #F8F0EC; border-color: rgba(222,72,39,0.55); }

/* ── Forge: Form controls (on dark bg or inside orange cards) ─────────────────── */
[data-theme="forge"] label  { color: #FFB09A; font-weight: 500; }
[data-theme="forge"] legend { color: #FFB09A; }
[data-theme="forge"] input[type="text"],
[data-theme="forge"] input[type="email"],
[data-theme="forge"] input[type="password"],
[data-theme="forge"] input[type="number"],
[data-theme="forge"] input[type="date"],
[data-theme="forge"] select,
[data-theme="forge"] textarea { background: rgba(22,22,22,0.80); border-color: rgba(222,72,39,0.25); color: #F8F0EC; }
[data-theme="forge"] input::placeholder,
[data-theme="forge"] textarea::placeholder { color: #9A7A70; }
[data-theme="forge"] input:focus,
[data-theme="forge"] select:focus,
[data-theme="forge"] textarea:focus { border-color: #DE4827; box-shadow: 0 0 0 3px rgba(222,72,39,0.25); }
[data-theme="forge"] fieldset { background: rgba(255,255,255,0.03); border-color: rgba(222,72,39,0.20); }

/* ── Forge: Cards — orange with white text ────────────────────────────────────── */
[data-theme="forge"] .card {
  background: #DE4827;
  border: 1px solid rgba(222,72,39,0.60);
  box-shadow: 0 0 0 1px rgba(222,72,39,0.35), 0 4px 20px rgba(0,0,0,0.50);
  color: #FFFFFF;
}
[data-theme="forge"] .card h2,
[data-theme="forge"] .card h3,
[data-theme="forge"] .card h4 { color: #FFFFFF; }
[data-theme="forge"] .card p  { color: rgba(255,255,255,0.85); }
[data-theme="forge"] .card .muted,
[data-theme="forge"] .card small { color: rgba(255,220,210,0.80); }
[data-theme="forge"] .card label { color: rgba(255,220,210,0.90); }
/* Inputs inside orange cards — dark-tinted so they pop off the orange */
[data-theme="forge"] .card input[type="text"],
[data-theme="forge"] .card input[type="email"],
[data-theme="forge"] .card input[type="password"],
[data-theme="forge"] .card input[type="number"],
[data-theme="forge"] .card input[type="date"],
[data-theme="forge"] .card select,
[data-theme="forge"] .card textarea {
  background: rgba(0,0,0,0.25);
  border-color: rgba(255,255,255,0.25);
  color: #FFFFFF;
}
[data-theme="forge"] .card input::placeholder,
[data-theme="forge"] .card textarea::placeholder { color: rgba(255,220,210,0.55); }
[data-theme="forge"] .card input:focus,
[data-theme="forge"] .card select:focus,
[data-theme="forge"] .card textarea:focus { border-color: rgba(255,255,255,0.55); box-shadow: 0 0 0 3px rgba(255,255,255,0.15); }
[data-theme="forge"] .card .btn.ghost { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.30); color: #FFFFFF; }
[data-theme="forge"] .card .btn.ghost:hover { background: rgba(255,255,255,0.22); border-color: rgba(255,255,255,0.50); }
[data-theme="forge"] .card a { color: rgba(255,220,210,0.90); }
[data-theme="forge"] .card a:hover { color: #FFFFFF; }
[data-theme="forge"] .card .badge { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.25); color: #FFFFFF; }
[data-theme="forge"] .card .pill  { background: rgba(255,255,255,0.12); color: rgba(255,220,210,0.90); border-color: rgba(255,255,255,0.20); }

/* ── Forge: Tables ────────────────────────────────────────────────────────────── */
[data-theme="forge"] table   { background: #1E1E1E; }
[data-theme="forge"] thead   { background: #252525; border-bottom: 2px solid rgba(222,72,39,0.35); }
[data-theme="forge"] th      { color: #FFB09A; font-weight: 600; border-bottom: 2px solid rgba(222,72,39,0.35); }
[data-theme="forge"] td      { color: #F8F0EC; border-bottom-color: rgba(222,72,39,0.12); }
[data-theme="forge"] tbody tr:nth-child(even) { background-color: rgba(222,72,39,0.05); }
[data-theme="forge"] tbody tr:hover            { background-color: rgba(222,72,39,0.10); }

/* ── Forge: Global text on dark bg ───────────────────────────────────────────── */
[data-theme="forge"] h2, [data-theme="forge"] h3 { color: #F8F0EC; }
[data-theme="forge"] p       { color: #FFB09A; }
[data-theme="forge"] small,
[data-theme="forge"] .muted  { color: #9A7A70; }
[data-theme="forge"] a       { color: #FF9A7A; }
[data-theme="forge"] a:hover { color: #FFBFAA; }

/* ── Forge: Badges & pills (on dark bg) ──────────────────────────────────────── */
[data-theme="forge"] .badge     { background: rgba(222,72,39,0.15); border: 1px solid rgba(222,72,39,0.35); color: #FFB09A; }
[data-theme="forge"] .pill      { background: rgba(222,72,39,0.12); border-color: rgba(222,72,39,0.30); color: #FFB09A; }
[data-theme="forge"] .mini-chip { background: #252525; color: #FFB09A; border: 1px solid rgba(222,72,39,0.22); }

/* ── Forge: Text tokens — dark surfaces (non-card) ───────────────────────────── */
[data-theme="forge"] .summary-label       { color: #FFB09A; }
[data-theme="forge"] .summary-card p      { color: #FFB09A; }
[data-theme="forge"] .band-title          { color: #9A7A70; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; }
[data-theme="forge"] .band-subtitle       { color: #F8F0EC; }
[data-theme="forge"] .section-shell-header p { color: #FFB09A; }
[data-theme="forge"] .micro               { color: #9A7A70; }
[data-theme="forge"] .perf-summary-title  { color: #F8F0EC; }
[data-theme="forge"] .perf-summary-score  { color: #F8F0EC; }
[data-theme="forge"] .perf-summary-hint   { color: #FFB09A; }
[data-theme="forge"] .timeline-meta       { color: #9A7A70; }
[data-theme="forge"] .timeline-body,
[data-theme="forge"] .timeline-note       { color: #F8F0EC; }
[data-theme="forge"] .bucket-summary-note { color: #FFB09A; }
[data-theme="forge"] .drawer-list-meta    { color: #9A7A70; }
[data-theme="forge"] .drawer-list-body    { color: #F8F0EC; }
[data-theme="forge"] .detail-summary p    { color: #FFB09A; }
[data-theme="forge"] .insight-box p       { color: #F8F0EC; }
[data-theme="forge"] .training-meta-row   { color: #FFB09A; }
[data-theme="forge"] .empty-state         { color: #9A7A70; }

/* ── Forge: KPI cards on dark bg (not inside .card wrappers) ─────────────────── */
[data-theme="forge"] .kpi-card        { background: #DE4827; border: 1px solid rgba(222,72,39,0.50); color: #FFFFFF; }
[data-theme="forge"] .kpi-card .label { color: rgba(255,220,210,0.85); }
[data-theme="forge"] .kpi-card .kpi-sub { color: rgba(255,220,210,0.75); }
[data-theme="forge"] .kpi-card:hover  { background: #C13B1E; }

/* ── Forge: Progress bar ──────────────────────────────────────────────────────── */
[data-theme="forge"] .progress-bar         { background: rgba(222,72,39,0.20); }
[data-theme="forge"] .progress-bar > div   { background: #FF9A7A; }

/* ── Forge: Status/semantic colours — consistent across all themes ────────────── */
[data-theme="forge"] .perf-status.good  { color: #86efac; background: rgba(34,197,94,0.15);  border-color: rgba(34,197,94,0.35); }
[data-theme="forge"] .perf-status.watch { color: #fcd34d; background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.35); }
[data-theme="forge"] .perf-status.risk  { color: #fca5a5; background: rgba(239,68,68,0.15);  border-color: rgba(239,68,68,0.35); }
[data-theme="forge"] .trend-pill.up   { color: #86efac; background: rgba(34,197,94,0.15);  border-color: rgba(34,197,94,0.30); }
[data-theme="forge"] .trend-pill.down { color: #fca5a5; background: rgba(239,68,68,0.15);  border-color: rgba(239,68,68,0.30); }
[data-theme="forge"] .trend-pill.flat { color: #FFB09A; }
[data-theme="forge"] .status.good,
[data-theme="forge"] .status-badge.status-done   { color: #86efac; }
[data-theme="forge"] .status.watch,
[data-theme="forge"] .status-badge.status-open   { color: #fcd34d; }
[data-theme="forge"] .status.risk,
[data-theme="forge"] .status-badge.status-danger { color: #fca5a5; }

/* ── Forge: Staff list page ───────────────────────────────────────────────────── */
[data-theme="forge"] .staff-toolbar-card        { background: #1E1E1E; border-color: rgba(222,72,39,0.22); }
[data-theme="forge"] .staff-filter-group label  { color: #FFB09A; }
[data-theme="forge"] .staff-active-filters       { border-top-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .chip                       { background: #252525; border-color: rgba(222,72,39,0.25); color: #FFB09A; }
[data-theme="forge"] .chip.muted                 { color: #9A7A70; }
[data-theme="forge"] .staff-summary-inline       { color: #FFB09A; }
[data-theme="forge"] .staff-summary-inline strong { color: #F8F0EC; }
[data-theme="forge"] .staff-table-card           { background: #1E1E1E; border-color: rgba(222,72,39,0.20); }
[data-theme="forge"] .staff-table-topbar         { background: #252525; border-bottom: 2px solid rgba(222,72,39,0.30); }
[data-theme="forge"] .staff-table-title h3       { color: #F8F0EC; }
[data-theme="forge"] .staff-table-title p        { color: #FFB09A; }
[data-theme="forge"] .staff-table thead          { background: #252525; color: #F8F0EC; }
[data-theme="forge"] .staff-table th             { color: #FFB09A; border-bottom: 2px solid rgba(222,72,39,0.30); }
[data-theme="forge"] .staff-table td             { color: #F8F0EC; border-top-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .staff-table-row:nth-child(even) { background-color: rgba(222,72,39,0.04); }
[data-theme="forge"] .staff-table-row:hover      { background-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .staff-name-main            { color: #F8F0EC; }
[data-theme="forge"] .staff-subtext, [data-theme="forge"] .staff-updated { color: #9A7A70; }
[data-theme="forge"] .position-badge  { background: rgba(255,154,122,0.15); border-color: rgba(255,154,122,0.30); color: #FF9A7A; }
[data-theme="forge"] .placement-badge { background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.28); color: #86efac; }
[data-theme="forge"] .trend-badge.good    { background: rgba(34,197,94,0.14);  color: #86efac;  border-color: rgba(34,197,94,0.30); }
[data-theme="forge"] .trend-badge.warn    { background: rgba(245,158,11,0.14); color: #fcd34d;  border-color: rgba(245,158,11,0.30); }
[data-theme="forge"] .trend-badge.bad     { background: rgba(239,68,68,0.14);  color: #fca5a5;  border-color: rgba(239,68,68,0.30); }
[data-theme="forge"] .trend-badge.neutral { background: rgba(154,122,112,0.14); color: #FFB09A; border-color: rgba(154,122,112,0.25); }
[data-theme="forge"] .staff-status-badge.active     { background: rgba(34,197,94,0.14);  color: #86efac;  border-color: rgba(34,197,94,0.30); }
[data-theme="forge"] .staff-status-badge.resigned   { background: rgba(245,158,11,0.14); color: #fcd34d;  border-color: rgba(245,158,11,0.30); }
[data-theme="forge"] .staff-status-badge.terminated { background: rgba(239,68,68,0.14);  color: #fca5a5;  border-color: rgba(239,68,68,0.30); }
[data-theme="forge"] .staff-actions .btn.ghost  { background: rgba(255,255,255,0.05); border-color: rgba(222,72,39,0.30); color: #FFB09A; }
[data-theme="forge"] .staff-actions .btn.ghost:hover { background: rgba(222,72,39,0.12); border-color: rgba(222,72,39,0.50); color: #F8F0EC; }
[data-theme="forge"] .staff-empty              { color: #9A7A70; }
[data-theme="forge"] .staff-pagination         { border-top-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .staff-pagination .muted  { color: #9A7A70; }
[data-theme="forge"] .staff-pagination strong  { color: #F8F0EC; }
[data-theme="forge"] .staff-mini-note          { color: #9A7A70; }
[data-theme="forge"] .staff-pagination-controls .btn { background: rgba(255,255,255,0.05); border-color: rgba(222,72,39,0.25); color: #FFB09A; }
[data-theme="forge"] .staff-pagination-controls .btn:hover { background: rgba(222,72,39,0.12); color: #F8F0EC; }

/* ── Forge: Staff profile page ─────────────────────────────────────────────────── */
[data-theme="forge"] .page-band           { border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .page-band.band-dashboard   { background: rgba(222,72,39,0.06); }
[data-theme="forge"] .page-band.band-performance { background: rgba(222,72,39,0.05); }
[data-theme="forge"] .page-band.band-ops         { background: rgba(222,72,39,0.04); }
[data-theme="forge"] .page-band.band-dev         { background: rgba(222,72,39,0.05); }
[data-theme="forge"] .band-title    { color: #9A7A70; }
[data-theme="forge"] .band-subtitle { color: #FFB09A; }
[data-theme="forge"] .sticky-nav { background: rgba(17,22,28,0.97); border-color: rgba(222,72,39,0.25); }
[data-theme="forge"] .sticky-nav a { background: rgba(222,72,39,0.08); border-color: rgba(222,72,39,0.22); color: rgba(248,240,236,0.85); }
[data-theme="forge"] .sticky-nav a:hover,
[data-theme="forge"] .sticky-nav a.active { background: rgba(222,72,39,0.20); border-color: rgba(222,72,39,0.50); color: #FF9A7A; }
[data-theme="forge"] .avatar { background: rgba(222,72,39,0.15); color: #FF9A7A; border-color: rgba(222,72,39,0.45); }
[data-theme="forge"] .profile-hero { background: rgba(30,30,30,0.90); border-color: rgba(222,72,39,0.20); box-shadow: 0 8px 32px rgba(0,0,0,0.40); }
[data-theme="forge"] .badge        { background: rgba(222,72,39,0.15); border-color: rgba(222,72,39,0.35); color: #FFB09A; }
[data-theme="forge"] .badge.subtle { color: #9A7A70; }
[data-theme="forge"] .trend-pill   { background: rgba(222,72,39,0.12); border-color: rgba(222,72,39,0.25); color: #FFB09A; }
[data-theme="forge"] .snapshot-insight-card,
[data-theme="forge"] .snapshot-kpi-card         { background: #252525; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .snapshot-insight-clickcard,
[data-theme="forge"] .snapshot-kpi-clickcard    { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .snapshot-insight-clickcard:hover,
[data-theme="forge"] .snapshot-kpi-clickcard:hover { border-color: rgba(222,72,39,0.50); box-shadow: 0 4px 16px rgba(0,0,0,0.30); }
[data-theme="forge"] .snapshot-insight-label,
[data-theme="forge"] .snapshot-kpi-card .label,
[data-theme="forge"] .snapshot-kpi-clickcard .label { color: #9A7A70; }
[data-theme="forge"] .snapshot-insight-card strong,
[data-theme="forge"] .snapshot-insight-clickcard strong { color: #F8F0EC; }
[data-theme="forge"] .perf-summary-clickcard        { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .perf-summary-clickcard:hover  { border-color: rgba(222,72,39,0.45); }
[data-theme="forge"] .perf-status { background: #252525; border-color: rgba(222,72,39,0.25); }
[data-theme="forge"] .section-shell   { background: #1E1E1E; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .mini-chip       { background: #252525; border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .empty-state,
[data-theme="forge"] .drawer-empty    { background: #252525; border-color: rgba(222,72,39,0.22); color: #9A7A70; }
[data-theme="forge"] .ops-shell,
[data-theme="forge"] .dev-shell       { background: rgba(222,72,39,0.03); }
[data-theme="forge"] .ops-panel,
[data-theme="forge"] .dev-panel       { background: #1E1E1E; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .ops-summary-card,
[data-theme="forge"] .dev-summary-card,
[data-theme="forge"] .bucket-summary-card { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .ops-summary-label,
[data-theme="forge"] .ops-mini-label,
[data-theme="forge"] .dev-summary-label   { color: #9A7A70; }
[data-theme="forge"] .ops-summary-card p,
[data-theme="forge"] .dev-summary-card p  { color: #FFB09A; }
[data-theme="forge"] .ops-mini-card        { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .calendar-summary     { background: #252525; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .calendar-details-panel { background: #252525; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .cal-head { color: #9A7A70; }
[data-theme="forge"] .cal-day  { background: #1E1E1E; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .mini-badge     { background: #2C2C2C; border-color: rgba(222,72,39,0.20); color: #FFB09A; }
[data-theme="forge"] .ops-soft-panel { background: #252525; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .review-comment-panel   { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .review-comment-panel p { color: #F8F0EC; }
[data-theme="forge"] .drawer-subcard   { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .drawer-list-item { background: #1E1E1E; border-color: rgba(222,72,39,0.12); }

/* ── Forge: Incidents ─────────────────────────────────────────────────────────── */
[data-theme="forge"] .wizard-step          { background: #252525; border-color: rgba(222,72,39,0.22); color: #F8F0EC; }
[data-theme="forge"] .section-card         { background: #1E1E1E; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .type-card            { background: #252525; border-color: rgba(222,72,39,0.20); color: #F8F0EC; }
[data-theme="forge"] .type-card.active     { background: rgba(222,72,39,0.18); border-color: rgba(222,72,39,0.55); color: #FF9A7A; }
[data-theme="forge"] .type-card-desc       { color: #9A7A70; }
[data-theme="forge"] .tone-chip            { background: rgba(255,255,255,0.05); border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .tone-chip.active     { background: rgba(222,72,39,0.18); border-color: rgba(222,72,39,0.55); color: #FF9A7A; }
[data-theme="forge"] .type-helper          { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .preview-box          { background: #1E1E1E; border-color: rgba(222,72,39,0.22); color: #F8F0EC; }
[data-theme="forge"] .example-modal-backdrop { background: rgba(0,0,0,0.65); }
[data-theme="forge"] .example-modal        { background: #1E1E1E; border-color: rgba(222,72,39,0.22); }
[data-theme="forge"] .example-modal pre,
[data-theme="forge"] .incident-details-pre { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .hint                 { color: #9A7A70; opacity: 1; }
[data-theme="forge"] .incident-month-group { background: #1E1E1E; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .month-toggle         { background: #252525; color: #F8F0EC; }
[data-theme="forge"] .month-toggle:hover   { background: rgba(222,72,39,0.12); }
[data-theme="forge"] .month-meta           { color: #9A7A70; }
[data-theme="forge"] .month-body           { background: #1E1E1E; }
[data-theme="forge"] .chip-btn             { background: #252525; border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .row-details          { background: #1E1E1E; }
[data-theme="forge"] .row-details td       { color: #F8F0EC; border-top-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .pill { border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .pill-positive { background: rgba(34,197,94,0.12);  border-color: rgba(34,197,94,0.30);  color: #86efac; }
[data-theme="forge"] .pill-coaching { background: rgba(255,154,122,0.12); border-color: rgba(255,154,122,0.30); color: #FF9A7A; }
[data-theme="forge"] .pill-formal   { background: rgba(239,68,68,0.12);   border-color: rgba(239,68,68,0.30);   color: #fca5a5; }
[data-theme="forge"] .pill-info     { background: rgba(154,122,112,0.12); border-color: rgba(154,122,112,0.25); color: #FFB09A; }
[data-theme="forge"] .pill-low      { background: rgba(34,197,94,0.12);  border-color: rgba(34,197,94,0.28);   color: #86efac; }
[data-theme="forge"] .pill-medium   { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.28);  color: #fcd34d; }
[data-theme="forge"] .pill-high     { background: rgba(239,68,68,0.12);  border-color: rgba(239,68,68,0.28);   color: #fca5a5; }
[data-theme="forge"] .health-ok     { background: rgba(34,197,94,0.12);  border-color: rgba(34,197,94,0.28);   color: #86efac; }
[data-theme="forge"] .health-warn   { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.28);  color: #fcd34d; }
[data-theme="forge"] .health-bad    { background: rgba(239,68,68,0.12);  border-color: rgba(239,68,68,0.28);   color: #fca5a5; }

/* ── Forge: Goals ────────────────────────────────────────────────────────────── */
[data-theme="forge"] .goals-tab        { background: #252525; border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .goals-tab.active { background: rgba(222,72,39,0.18); border-color: rgba(222,72,39,0.50); color: #FF9A7A; outline: 2px solid rgba(222,72,39,0.20); }
[data-theme="forge"] .goal-group       { background: #1E1E1E; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .goal-group-toggle { background: #252525; color: #F8F0EC; }
[data-theme="forge"] .goal-group-toggle:hover { background: rgba(222,72,39,0.10); }
[data-theme="forge"] .goal-group-meta  { color: #9A7A70; }
[data-theme="forge"] .goal-group-body  { background: #1E1E1E; border-top-color: rgba(222,72,39,0.12); }
[data-theme="forge"] .goal-card        { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .goal-card:hover  { outline: 2px solid rgba(222,72,39,0.30); }
[data-theme="forge"] .goal-desc        { color: #FFB09A; }
[data-theme="forge"] .goal-checkin-preview { background: #2C2C2C; border-color: rgba(222,72,39,0.15); color: #FFB09A; }
[data-theme="forge"] .chip-danger      { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.30); color: #fca5a5; }
[data-theme="forge"] .chip-warn        { background: rgba(245,158,11,0.12); border-color: rgba(245,158,11,0.28); color: #fcd34d; }
[data-theme="forge"] .status-badge.status-warn  { background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.30); color: #fcd34d; }
[data-theme="forge"] .status-badge.status-muted { background: rgba(154,122,112,0.12); border-color: rgba(154,122,112,0.25); color: #9A7A70; }
[data-theme="forge"] .goal-preview        { background: #252525; border-color: rgba(222,72,39,0.20); color: #F8F0EC; }
[data-theme="forge"] .goal-preview-desc   { color: #FFB09A; }
[data-theme="forge"] .step-chip,
[data-theme="forge"] .template-chip,
[data-theme="forge"] .date-chip           { background: #2C2C2C; border-color: rgba(222,72,39,0.22); color: #FFB09A; }
[data-theme="forge"] .quality-panel       { background: #252525; border-color: rgba(222,72,39,0.18); }
[data-theme="forge"] .quality-dot         { background: rgba(154,122,112,0.50); }
[data-theme="forge"] .quality-item.ok  .quality-dot { background: rgba(34,197,94,0.85); }
[data-theme="forge"] .quality-item.warn .quality-dot { background: rgba(245,158,11,0.85); }
[data-theme="forge"] .owner-kpi           { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .draft-note          { color: #9A7A70; }
[data-theme="forge"] .bar { background: rgba(222,72,39,0.18); }
[data-theme="forge"] .bar > div { background: #FF9A7A; }
[data-theme="forge"] .wizard-strip .wizard-step { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .section-block { border-top-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .timeline-item { background: #252525; border-color: rgba(222,72,39,0.18); }

/* ── Forge: Calendar ─────────────────────────────────────────────────────────── */
[data-theme="forge"] .calendar-shell    { background: #1E1E1E; border-color: rgba(222,72,39,0.20); }
[data-theme="forge"] .calendar-weekdays { background: #252525; border-bottom-color: rgba(222,72,39,0.25); }
[data-theme="forge"] .calendar-weekdays > div { color: #FFB09A; border-right-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .calendar-day      { background: #1E1E1E; border-right-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .calendar-day.empty { background: rgba(22,22,22,0.70); }
[data-theme="forge"] .calendar-day.active { outline: 2px solid rgba(222,72,39,0.50); background: rgba(222,72,39,0.06); }
[data-theme="forge"] .day-count          { background: rgba(222,72,39,0.18); border-color: rgba(222,72,39,0.35); color: #FF9A7A; }
[data-theme="forge"] .rollup-row         { background: #252525; border-color: rgba(222,72,39,0.18); color: #F8F0EC; }
[data-theme="forge"] .events-table thead th { background: #252525; color: #FFB09A; border-bottom-color: rgba(222,72,39,0.30); }
[data-theme="forge"] .warning-card-item  { background: rgba(239,68,68,0.10); border-color: rgba(239,68,68,0.25); }
[data-theme="forge"] .day-metric         { background: #252525; border-color: rgba(222,72,39,0.15); }
[data-theme="forge"] .day-drawer         { background: #1E1E1E; border-left-color: rgba(222,72,39,0.22); }
[data-theme="forge"] .day-drawer-backdrop { background: rgba(0,0,0,0.60); }

/* ── Forge: Roster index ─────────────────────────────────────────────────────── */
[data-theme="forge"] .roster-filter-group label { color: #FFB09A; }
[data-theme="forge"] .roster-table-topbar   { background: #252525; border-bottom: 2px solid rgba(222,72,39,0.30); }
[data-theme="forge"] .roster-table-title p  { color: #9A7A70; }
[data-theme="forge"] .roster-table thead    { background: #252525; color: #F8F0EC; }
[data-theme="forge"] .roster-table th       { color: #FFB09A; border-bottom: 2px solid rgba(222,72,39,0.30); }
[data-theme="forge"] .roster-table td       { color: #F8F0EC; border-top-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .roster-row:nth-child(even) { background-color: rgba(222,72,39,0.04); }
[data-theme="forge"] .roster-row:hover           { background-color: rgba(222,72,39,0.10); }
[data-theme="forge"] .roster-name-main { color: #F8F0EC; }
[data-theme="forge"] .roster-subtext   { color: #9A7A70; }
[data-theme="forge"] .roster-notes     { color: #FFB09A; }
[data-theme="forge"] .roster-empty     { color: #9A7A70; }

/* ── Forge: Theme switcher ────────────────────────────────────────────────────── */
[data-theme="forge"] .theme-switcher__btn { color: rgba(248,240,236,0.80); border-color: rgba(222,72,39,0.30); }
[data-theme="forge"] .theme-switcher__btn:hover { color: #F8F0EC; border-color: rgba(222,72,39,0.55); background: rgba(222,72,39,0.10); }
[data-theme="forge"] .theme-switcher__menu { background: #1E1E1E; border: 1px solid rgba(222,72,39,0.25); box-shadow: 0 8px 24px rgba(0,0,0,0.50); }
[data-theme="forge"] .theme-switcher__label { color: #9A7A70; }
[data-theme="forge"] .theme-option { color: #FFB09A; }
[data-theme="forge"] .theme-option:hover { background: rgba(222,72,39,0.10); color: #F8F0EC; }
[data-theme="forge"] .theme-option.active { background: rgba(222,72,39,0.20); color: #FF9A7A; }

`;

const result = css.slice(0, startIdx) + FORGE_BLOCK + css.slice(endIdx);
writeFileSync(path, result, 'utf8');
console.log('Forge theme replaced. Lines:', result.split('\n').length);
