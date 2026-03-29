# BETAPlanes

Flight tracker for Beta Technologies test planes. Scrapes flight history from FlightAware's public website, stores it in Cloudflare D1, and displays routes on Google Maps with per-plane and per-flight toggle controls.

## How It Works

### Data Pipeline

1. **Scraper** fetches FlightAware's public flight pages for each tail number
2. Flight list pages contain embedded JSON (`var trackpollBootstrap = {...}`) with flight metadata and track coordinates
3. If inline track data isn't available, the scraper fetches the individual tracklog page and parses the HTML table
4. Flight and track data is stored in Cloudflare D1 (SQLite)
5. A daily cron job (6 AM UTC) re-scrapes all planes automatically
6. Fetched HTML pages are cached in D1 — tracklog pages are cached forever, flight list pages are re-fetched each run

### Architecture

```
FlightAware ──scrape──> Cloudflare Worker (Hono) ──store──> D1 Database
                              │
                              ├── /api/planes        GET  plane list
                              ├── /api/flights       GET  flights by tail
                              ├── /api/tracks/:id    GET  track points
                              ├── /api/stats         GET  per-plane stats
                              ├── /api/stats/daily   GET  daily flight hours
                              ├── /api/scrape        POST trigger full scrape
                              ├── /api/scrape/flight POST scrape a specific flight URL
                              ├── /api/scrape/logs   GET  scrape log history
                              ├── /logs              GET  scrape log viewer (HTML)
                              ├── /:tailNumber       GET  single-plane view
                              └── /                  GET  main app (static)
```

### Frontend

Vanilla HTML/CSS/JS served as static assets. No build step, no framework.

- **Google Maps** with dark theme, color-coded polylines per plane, click for flight details
- **Sidebar** with plane cards, toggle switches, flight stats, and expandable flight lists
- **Daily chart** showing aggregate flight hours per day (canvas-based bar chart)

### Planes

| Tail | Color | Default View |
|------|-------|:---:|
| N916LF | Red (#e74c3c) | Yes |
| N336MR | Blue (#3498db) | Yes |
| N214BT | Green (#2ecc71) | Yes |
| N401NZ | Orange (#f39c12) | Yes |
| N709JL | Purple (#9b59b6) | Yes |
| N521SS | Teal (#1abc9c) | No |
| N27SJ | Dark Orange (#e67e22) | No |
| N556LU | Pink (#e84393) | No |

Non-default planes are scraped but only visible when navigating to `/<TAIL_NUMBER>` (e.g. `/N521SS`).

## Project Structure

```
BETAPlanes/
  src/
    index.ts              # Hono app, route registration, cron handler
    types.ts              # Shared TypeScript interfaces
    lib/
      scraper.ts          # FlightAware scraper (runs in Worker)
    routes/
      planes.ts           # /api/planes
      flights.ts          # /api/flights
      tracks.ts           # /api/tracks/:id
      stats.ts            # /api/stats, /api/stats/daily
  public/                 # Static assets (served by Cloudflare)
    index.html
    css/style.css
    js/
      app.js              # Init, URL-based plane filtering
      map.js              # Google Maps, polylines, VFR/airspace overlays
      sidebar.js          # Plane cards, toggles, state
      chart.js            # Daily flight hours bar chart
      profile.js          # Flight altitude/speed profile, playback animation
      api.js              # Fetch wrapper
    img/                  # Plane thumbnails and full-size photos
    data/                 # FAA GeoJSON files (airspace, airways, etc.)
  scripts/
    scrape.ts             # CLI scraper (alternative to Worker scraper)
    download-faa-data.ts  # FAA data downloader (ArcGIS → flat files + D1)
  schema.sql              # D1 tables, indexes, seed data (flight tracking)
  schema-faa.sql          # D1 tables for FAA aviation data
  wrangler.toml           # Cloudflare Workers config
```

## Setup

### Prerequisites

- Node.js
- A Cloudflare account
- Wrangler CLI (`npm install -g wrangler` or use npx)

### Install

```bash
npm install
```

### Initialize the Database

Create the D1 database (first time only):

```bash
npx wrangler d1 create betaplanes-db
# Copy the database_id into wrangler.toml
```

Initialize the schema:

```bash
# Local
npm run db:init

# Remote (production)
npm run db:init:remote
```

## Running Locally

```bash
npx wrangler dev
```

This starts the dev server (usually at `http://localhost:8787`). It uses the local D1 database.

### Populating Data

**Option 1: Trigger the Worker scraper**

```bash
curl -X POST http://localhost:8787/api/scrape
```

This scrapes FlightAware for all configured planes and stores the results. Takes a minute or two due to rate limiting.

**Option 2: Use the CLI scraper**

```bash
npm run scrape          # writes to local D1
npm run scrape:remote   # writes to remote D1
```

The CLI scraper caches raw HTML files in `scripts/cache/` for faster re-runs during development.

### Scraping a Specific Flight

If a flight isn't picked up by the automatic scraper (e.g. old flights not listed on the live page), you can scrape it by URL:

```bash
curl -X POST http://localhost:8787/api/scrape/flight \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.flightaware.com/live/flight/N521SS/history/20251218/1958Z/KLDJ/KDXR"}'
```

## Deploying

```bash
# Initialize remote DB (first time)
npm run db:init:remote

# Deploy the Worker
npm run deploy
```

The Worker is deployed to `https://betaplanes.acd.workers.dev`. The daily cron trigger runs at 6 AM UTC automatically.

## Useful Commands

```bash
# Check scrape logs
curl https://betaplanes.acd.workers.dev/api/scrape/logs

# View scrape logs in browser
open https://betaplanes.acd.workers.dev/logs

# Query D1 directly
npx wrangler d1 execute betaplanes-db --local --command="SELECT COUNT(*) FROM flights;"
npx wrangler d1 execute betaplanes-db --remote --command="SELECT COUNT(*) FROM flights;"

# Clear cached data for a plane and re-scrape
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM track_points WHERE flight_id LIKE '%N521SS%';"
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM flights WHERE tail_number = 'N521SS';"
npx wrangler d1 execute betaplanes-db --local --command="DELETE FROM scrape_cache WHERE cache_key LIKE '%N521SS%';"
```

## Adding a New Plane

1. Add the tail number to `TAIL_NUMBERS` in both `src/lib/scraper.ts` and `scripts/scrape.ts`
2. Insert the plane into the database:
   ```bash
   npx wrangler d1 execute betaplanes-db --local \
     --command="INSERT OR IGNORE INTO planes (tail_number, display_name, color, show_default) VALUES ('NXXXXX', 'NXXXXX', '#hexcolor', 0);"
   npx wrangler d1 execute betaplanes-db --remote \
     --command="INSERT OR IGNORE INTO planes (tail_number, display_name, color, show_default) VALUES ('NXXXXX', 'NXXXXX', '#hexcolor', 0);"
   ```
3. Add the plane to the `INSERT` statement in `schema.sql` for future DB initializations
4. Set `show_default` to `1` to show on the main page, or `0` to only show at `/<TAIL_NUMBER>`
5. Deploy: `npm run deploy`

## FAA Aviation Data

BETAPlanes integrates official FAA aviation data from the [FAA Aeronautical Data Delivery Service (ADDS)](https://adds-faa.opendata.arcgis.com/) to provide airspace context for flight tracks. Data is downloaded from ArcGIS FeatureServer endpoints, simplified, and stored either as static GeoJSON files (for map overlays) or in D1 (for queryable lookups).

### Data Sources

#### Static GeoJSON files (`public/data/`)

These are rendered as map overlays in the browser. Geometries are simplified (reduced coordinate precision, thinned polygon rings) to keep file sizes reasonable.

| File | Source | Description | Features |
|------|--------|-------------|----------|
| `airspace.json` | Class_Airspace | Class B and C airspace boundaries (major airport controlled airspace rings) | ~834 |
| `special-use-airspace.json` | Special_Use_Airspace | MOAs (Military Operations Areas), restricted areas, alert areas, warning areas | ~1,539 |
| `prohibited-areas.json` | Prohibited_Areas | Prohibited airspace (e.g., P-56 over the White House, Camp David) | ~13 |
| `airways.json` | ATS_Route | Victor airways (low-altitude) and jet routes (high-altitude) — the "highways in the sky" | ~18,541 |
| `mtr-segments.json` | MTRSegment | Military Training Routes — low-altitude corridors used for military flight training | ~3,658 |
| `holding-patterns.json` | HoldingPattern | Published holding pattern locations (racetrack patterns at waypoints) | ~558 |
| `runways.json` | Runways | Runway polygons for all US airports | ~23,486 |

#### D1 Database Tables

These are loaded into D1 for server-side querying (e.g., look up an airport by ICAO code, find navaids near a flight path).

| Table | Source | Description | Records |
|-------|--------|-------------|---------|
| `faa_airports` | US_Airport | All US airports with ICAO/FAA identifiers, lat/lon, elevation, city, state | ~19,615 |
| `faa_navaids` | NAVAIDSystem | VORs, VOR-DMEs, NDBs, TACANs — radio navigation aids used for instrument flight | ~1,389 |
| `faa_designated_points` | DesignatedPoint | Waypoints, fixes, and intersections used in flight plans and instrument procedures | ~103,000 |
| `faa_obstacles` | Digital_Obstacle_File | Towers, buildings, wind turbines, and other tall structures that are aviation hazards | ~500,000+ |
| `faa_ils` | ILS_Component | Instrument Landing System components (localizers, glide slopes) at airports | ~1,189 |
| `faa_load_log` | (internal) | Tracks when each FAA data source was last loaded and how many records | — |

### Downloading FAA Data

The `scripts/download-faa-data.ts` script handles all FAA data ingestion:

```bash
# Download everything to local D1
npm run faa:download

# Download everything to remote (production) D1
npm run faa:download:remote

# Download a single source
npm run faa:download -- --only airports
npm run faa:download -- --only airspace

# Skip flat file or D1 targets
npm run faa:download -- --skip-flatfile
npm run faa:download -- --skip-d1
```

The script:
- **Paginates** ArcGIS queries (1000 records per page) to handle large datasets
- **Simplifies** geometries for flat files (reduced coordinate precision, polygon ring thinning)
- **Archives** previous versions in `public/data/archive/` with timestamps (gitignored)
- **Replaces** D1 data on each load (deletes old records, inserts fresh data)
- **Logs** each load to `faa_load_log` for tracking data freshness

### How FAA Data is Used

- **Airspace overlay**: Toggle Class B/C airspace boundaries on the map to see controlled airspace around major airports. Loaded on page init by default.
- **VFR Sectional**: Toggle FAA VFR sectional chart tiles (raster) over the map for full aeronautical chart context.
- **Airport lookups**: The `faa_airports` table enables resolving ICAO codes from flight origins/destinations to full airport names, locations, and elevations.
- **Navigation context**: Navaids, waypoints, and airways provide the navigation infrastructure that aircraft use for routing. Useful for understanding why a flight took a particular path.
- **Obstacle awareness**: The obstacle database shows tall structures near flight paths — relevant for low-altitude operations like Beta Technologies' eVTOL flights.
- **ILS data**: Instrument landing system locations show precision approach capability at airports the fleet uses.

## Notes

- FlightAware rate limits aggressively. The scraper may get `429` responses — these are logged and the affected pages will be retried on the next run.
- The live flight page (`/live/flight/{tail}`) only includes recent flights in its embedded JSON. Older flights that aren't listed there need to be scraped individually using the `/api/scrape/flight` endpoint.
- Track data is cached forever in D1. Flight list and history pages are re-fetched on each scrape run to pick up new flights.
- The CLI scraper (`scripts/scrape.ts`) caches HTML to the filesystem in `scripts/cache/`. Use `--no-cache` to force re-fetch.
