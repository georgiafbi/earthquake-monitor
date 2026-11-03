# Earthquake Monitor - Developer & Agent Guidelines

## Architecture Overview
- **Zero-Build Static Architecture**: This project is built with vanilla HTML, CSS, and browser-native ES JavaScript. No transpiler or bundler step is required for production.
- **Core Dependencies**:
  - MapLibre GL JS (WebGL map rendering and 3D globe visualization)
  - Three.js (3D airship patrol markers and animations)
  - RapidEditor `@rapideditor/country-coder` (Point-in-polygon local country lookup)
  - PB2002 dataset (`plates-data.js` for tectonic plate boundary overlays)
  - USGS Earthquake Catalog API (GeoJSON event feed)

## Hosting
- **Cloudflare Worker** (`worker/`): serves the repo root as static assets (exclusions in `.assetsignore`) and `/api/explain`, the Claude quake explainer. The Anthropic key is a Worker secret. See `worker/README.md`.
- GitHub Pages copies of the site hide the Explain button (no API there).

## Tooling & Commands
- **Local Dev Server**: `npm start` or `npm run dev` (starts zero-dependency static server on `http://localhost:3000`)
- **Worker Dev Server**: `npm run dev` in `worker/` (site + API on `http://localhost:8787`)
- **Automated Test Suite**: `npm test` (browser regression tests headlessly via `scripts/run-tests.js`); `npm test` in `worker/` for the Worker
- **Browser Tests**: Open `http://localhost:3000/Leaflet-Step-1/tests/logic-tests.html`

## Quality & Accessibility Requirements
- **USGS API Rate Limiting & Pagination**: Requests with >20,000 events must be paginated via offsets without freezing the UI.
- **Reduced Motion**: All seismic ping animations and globe auto-rotation must automatically respect OS `prefers-reduced-motion`.
- **Keyboard Navigation**: All interactive modals, drawers, and range presets must support full keyboard navigation (`Tab`, `Escape`, `Enter`) with proper ARIA `aria-expanded` and `aria-hidden` synchronization.
- **No Direct Secrets**: Mapbox tokens used in `config.js` must remain public client tokens with restricted origin URLs.
