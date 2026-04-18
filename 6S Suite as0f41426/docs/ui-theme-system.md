# 6S Suite UI Theme System

## Overview

The suite now uses a consolidated theme architecture built around five production themes and one accessibility mode:

1. `theme-command`
2. `theme-atlas`
3. `theme-carbon`
4. `theme-grove`
5. `theme-ember`
6. `theme-highcontrast` (accessibility mode)

Legacy theme names are aliased in the client boot scripts so existing user preferences migrate automatically.

## Product Intent

### Command
- Best for operations-heavy workflows and live dashboards.
- Personality: industrial, technical, low-glare, high focus.
- Best surfaces: home dashboard, admin, monitoring, kiosk-adjacent workflows.

### Atlas
- Best for daytime use and data-entry workflows.
- Personality: clear, confident, bright, operational.
- Best surfaces: asset catalog, forms, technician workflows, reporting.

### Carbon
- Best for long sessions and high-density management screens.
- Personality: calm, neutral, professional, analytical.
- Best surfaces: tables, audit tools, history, project boards.

### Grove
- Best for inventory, readiness, and maintenance contexts.
- Personality: stable, restorative, safety-oriented.
- Best surfaces: replenishment, asset lifecycle, inspection follow-up.

### Ember
- Best for exception handling, review, and decision-heavy tasks.
- Personality: warm, urgent, human, action-oriented.
- Best surfaces: notifications, escalations, due-soon workflows, approvals.

### High Contrast
- Accessibility-first fallback for low-vision and extreme lighting conditions.
- Uses maximum foreground/background separation and removes decorative shadow reliance.

## Color System

Each theme defines the same semantic tokens:

- `--bg`, `--bg-elevated`
- `--surface`, `--surface-strong`, `--surface-muted`, `--surface-overlay`
- `--border`, `--border-strong`
- `--fg`, `--fg-muted`, `--fg-subtle`
- `--accent`, `--accent-hover`, `--accent-soft`, `--accent-contrast`
- `--ok`, `--ok-bg`
- `--warn`, `--warn-bg`
- `--attn`, `--attn-bg`
- `--danger`, `--danger-bg`
- `--info`, `--info-bg`

This gives every screen a consistent semantic language:

- Primary action: `accent`
- Success and ready states: `ok`
- Time-sensitive caution: `warn`
- Needs attention but not failure: `attn`
- Critical failure or destructive action: `danger`
- Informational or checked-out states: `info`

## Typography

The suite now uses tokenized type roles instead of incidental font stacks:

- `--font-sans`: primary interface text
- `--font-display`: major headings, product labels, dashboard identity
- `--font-mono`: KPI numerals, codes, status chips, telemetry labels

Usage guidance:

- Use display type for page titles, shell identity, and feature headers.
- Use sans for all body copy, form controls, tables, and helper text.
- Use mono for counts, serials, timestamps, machine-oriented labels, and feed metadata.

## Component Styling

### Surfaces
- Cards, modals, tables, and shells should use `surface` or `surface-strong`.
- Elevated or inset regions should use `surface-muted`.
- Overlays and hero moments should use `surface-overlay`.

### Buttons
- Primary buttons use accent gradients and `accent-contrast`.
- Secondary and icon buttons use neutral surfaces with accent hover borders.
- Destructive buttons retain explicit danger coloring.

### Data Tables
- Header rows inherit the theme accent.
- Zebra striping uses `row-stripe`.
- Hover states use `row-hover`.
- Status badges remain semantic and do not depend on page-specific colors.

### Auth Screens
- Auth pages now inherit shared theme tokens through `theme-init.js`.
- Backgrounds use `hero` tokens so login and forgot-password visually belong to the same system.

## State Behavior

### Interactive states
- Hover: increase contrast, border emphasis, or elevation.
- Focus: 3px visible ring using `--focus-ring`.
- Active: handled through pressed color darkening or stronger border emphasis.
- Disabled: reduced opacity with no reliance on color alone.

### Feedback states
- Success toasts and chips map to `ok`.
- In-progress or in-use states map to `info` or `warn` depending on urgency.
- Critical issues and overdue states map to `danger`.

## Accessibility Standards

### Contrast
- Themes are designed around semantic contrast, not decorative hue.
- `theme-highcontrast` is preserved as a no-shadow, maximum-contrast option.

### Focus
- All themes use a visible focus ring token instead of browser-default invisibility risk.

### Motion
- Existing reduced-motion handling remains respected globally.

### Color independence
- Important states continue to use badges, labels, and borders, not color alone.

## Consolidation Rules

To keep the suite consistent going forward:

1. New pages should read theme from `theme-init.js` or `nav.js`, never from page-local defaults.
2. Theme pickers should expose only the curated five themes plus high contrast.
3. New styling should consume semantic tokens first, never raw hex values unless unavoidable.
4. Auth, dashboard, and data-heavy pages should share the same surface, focus, and button primitives.
5. Legacy theme names should not be introduced in new files.

## Migration Notes

Legacy user selections are mapped as follows:

- `theme-light` -> `theme-atlas`
- `theme-dark` -> `theme-carbon`
- `theme-mint` -> `theme-grove`
- `theme-ocean` -> `theme-atlas`
- `theme-sunset` -> `theme-ember`
- `theme-forest` -> `theme-grove`
- `theme-charcoal` -> `theme-carbon`
- `theme-lavender` -> `theme-ember`
- `theme-neon` -> `theme-highcontrast`

## Files Touched

- `public/styles.css`
- `public/nav.js`
- `public/theme-init.js`
- `views/partials/suite-topbar.ejs`
- `views/home.ejs`
- `views/index.ejs`
- `views/login.ejs`
- `views/forgot-password.ejs`
- `views/history.ejs`
- `views/tool-management.ejs`
- `views/admin/index.ejs`
- `views/inspections.ejs`
- `public/js/assetTable.js`
