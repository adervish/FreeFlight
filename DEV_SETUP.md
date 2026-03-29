# BETAPlanes — Local Development Setup

Quick guide to running the app locally while using the live production data.

## Prerequisites

- Node.js (v18+)
- Access to the Cloudflare account (ask for `wrangler login` access)

## Setup

```bash
# Clone the repo
git clone https://github.com/adervish/BETAPlanes.git
cd BETAPlanes

# Install dependencies
npm install

# Login to Cloudflare (one-time)
npx wrangler login
```

## Option 1: UI-Only Mode (No Cloudflare Access Needed)

The simplest way to work on the UI. Serves static files locally and proxies all API calls to the live production site.

```bash
npm run dev:ui
```

This starts a local server at `http://localhost:3000` that:
- Serves `public/` files locally — edit and refresh
- Proxies all `/api/` requests to `https://beta.bentboolean.com`
- No Cloudflare login required
- No local database needed

### How it works

All API calls from the frontend go to the local server, which forwards them to production. You get live data (airports, flights, plates, etc.) while editing HTML/CSS/JS locally.

## Option 2: Full Local with Remote Data (Requires Cloudflare Access)

If you need to modify Worker code (`src/`) or test API changes:

```bash
# One-time: login to Cloudflare
npx wrangler login

# Run with remote D1 database
npx wrangler dev --remote
```

This starts the app at `http://localhost:8787` using:
- **Local static files** from `public/` — edit HTML/CSS/JS and refresh to see changes
- **Local Worker code** from `src/` — edit and auto-rebuilds
- **Remote D1 database** — all 19K airports, 100K waypoints, 15K frequencies, 24K plates, etc.
- **Remote secrets** — Google Maps API key

## Option 3: Fully Local (No Internet Required)

Run everything locally with a local D1 database:

```bash
# Initialize local database
npm run db:init
npx wrangler d1 execute betaplanes-db --local --file=./schema-faa.sql

# Populate with FAA data (takes a while)
npm run faa:download

# Run locally
npx wrangler dev
```

## Project Structure (UI files)

```
public/
  index.html            # Main page — sidebar, map, modals
  css/style.css         # All styles
  js/
    app.js              # App init, loads planes + flights
    map.js              # Google Maps, airspace overlays, VFR tiles
    sidebar.js          # Plane cards, flight toggles, state
    chart.js            # Daily flight hours bar chart
    profile.js          # Flight altitude/speed profile + playback
    features.js         # Airport/navaid/obstacle markers, search, plates modal
    search.js           # Search box autosuggest
    api.js              # API client
  data/                 # Static GeoJSON (airspace, airways, etc.)
  img/                  # Plane photos
```

## Key UI Components

### Map Controls (top of map)
- **Search box** — searches airports by ident, ICAO, name, city
- **VFR** — toggles FAA VFR sectional chart tiles (hides base map)
- **Airspace** — toggles Class B/C/D airspace polygons with altitude labels
- **Airports/Navaids/Obstacles/Waypoints/ILS** — toggleable feature layers

### Sidebar (left panel)
- Plane cards with thumbnails, stats, toggle switches
- Per-flight toggles with play button for flight replay
- Daily flight hours chart

### Interactions
- **Click airport marker** — tabbed popup (Info / Freq / Runways) + Approach Plates button
- **Click flight in sidebar** — zooms map, shows altitude/speed profile
- **Hover profile chart** — airplane marker follows on map
- **Play button (▶)** — animates flight at 50x speed
- **Right-click map** (with airspace on) — vertical airspace cross-section
- **Hover plane thumbnail** — full-size photo preview

### Approach Plates Modal
- Opens from airport popup → "Approach Plates" button
- Left sidebar lists plates grouped by type (Approaches, Departures, STARs, etc.)
- Click any plate to view the PDF
- Click overlay or × to close

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/planes` | List tracked planes |
| `GET /api/planes/:tail/flights` | All flights + tracks for a plane |
| `GET /api/features?layers=airports&zoom=10&bounds=...` | H3-indexed feature query |
| `GET /api/features/config` | Feature layer configuration |
| `GET /api/search?q=lax` | Airport search with autosuggest |
| `GET /api/plates/:ident` | List approach plates for an airport |
| `GET /api/plates/:ident/:pdf` | Serve/proxy a plate PDF |
| `GET /api/plates/info/:ident` | Airport frequencies + runways |
| `GET /api/stats` | Per-plane flight stats |
| `GET /api/stats/daily` | Daily flight hours |

## Deploying

```bash
npm run deploy
```

This pushes the Worker + static assets to Cloudflare. The site is live at **beta.bentboolean.com**.

## Tips

- The `public/` directory is served as static assets — no build step needed
- All JS is vanilla (no framework, no bundler) — just edit and refresh
- Google Maps styles are in `map.js` → `initMap()`
- Airspace colors/visibility thresholds are in `map.js` → `AIRSPACE_STYLES` and `airspaceStyleFn`
- Feature layer visibility config is in `src/lib/feature-config.ts` (requires redeploy)
- To test with local D1 instead of remote: `npx wrangler dev` (without `--remote`)
