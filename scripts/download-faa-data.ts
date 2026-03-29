#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { latLngToCell } from "h3-js";

// ─── Config ──────────────────────────────────────────────────

const ARCGIS_BASE =
  "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const PAGE_SIZE = 1000;
const DELAY_MS = 300;
const PUBLIC_DATA = path.resolve(__dirname, "../public/data");
const ARCHIVE_DIR = path.resolve(PUBLIC_DATA, "archive");
const TODAY = new Date().toISOString().slice(0, 10);

const isRemote = process.argv.includes("--remote");
const onlySource = process.argv.find((_, i, a) => a[i - 1] === "--only") || null;
const skipFlatfile = process.argv.includes("--skip-flatfile");
const skipD1 = process.argv.includes("--skip-d1");

interface FlatfileOpts {
  outputName: string;
  precision: number;
  maxRingPoints: number;
  keepProps: Record<string, string>; // arcgis field -> short name
}

interface D1Opts {
  table: string;
  columns: string[]; // D1 column names in insert order
  mapRow: (props: Record<string, any>, geom: any) => (string | number | null)[];
  // Which H3 resolutions to compute (columns must be in `columns` list)
  h3Resolutions?: number[];
  // Function to compute tier from properties
  computeTier?: (props: Record<string, any>) => number;
}

// ─── H3 + Tier helpers ─────────────────────────────────────

function computeH3(lat: number, lng: number, res: number): string | null {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
  try {
    return latLngToCell(lat, lng, res);
  } catch {
    return null;
  }
}

// Airport tier: 1 = has ICAO id (major), 2 = public use, 3 = everything else
function airportTier(p: Record<string, any>): number {
  if (p.ICAO_ID && p.ICAO_ID.length > 0) return 1;
  if (p.TYPE_CODE === "AD" || p.TYPE_CODE === "AHP") return 2;
  return 3;
}

// Obstacle tier: 1 = tall (>500ft AGL), 2 = medium (200-500ft), 3 = short
function obstacleTier(p: Record<string, any>): number {
  const agl = p.AGL || 0;
  if (agl >= 500) return 1;
  if (agl >= 200) return 2;
  return 3;
}

// Navaid tier: 1 = VOR/VORTAC, 2 = everything else
function navaidTier(p: Record<string, any>): number {
  const cls = (p.CLASS_TXT || "").toUpperCase();
  if (cls.includes("VOR") || cls.includes("VORTAC") || cls.includes("TACAN")) return 1;
  return 2;
}

interface Source {
  name: string;
  service: string;
  layer?: number;
  where?: string;
  outFields: string;
  flatfile?: FlatfileOpts;
  d1?: D1Opts;
}

// ─── Sources ──────────────────────────────────────────────────

const SOURCES: Source[] = [
  // Flat files
  {
    name: "class-airspace",
    service: "Class_Airspace",
    where: "CLASS IN ('B','C')",
    outFields: "NAME,CLASS",
    flatfile: {
      outputName: "airspace.json",
      precision: 3,
      maxRingPoints: 40,
      keepProps: { NAME: "n", CLASS: "c" },
    },
  },
  {
    name: "special-use-airspace",
    service: "Special_Use_Airspace",
    outFields: "NAME,TYPE_CODE,CLASS",
    flatfile: {
      outputName: "special-use-airspace.json",
      precision: 3,
      maxRingPoints: 40,
      keepProps: { NAME: "n", TYPE_CODE: "t", CLASS: "c" },
    },
  },
  {
    name: "prohibited-areas",
    service: "Prohibited_Areas",
    outFields: "NAME,TYPE_CODE,CLASS",
    flatfile: {
      outputName: "prohibited-areas.json",
      precision: 3,
      maxRingPoints: 40,
      keepProps: { NAME: "n", TYPE_CODE: "t", CLASS: "c" },
    },
  },
  {
    name: "airways",
    service: "ATS_Route",
    outFields: "IDENT,TYPE_CODE",
    flatfile: {
      outputName: "airways.json",
      precision: 3,
      maxRingPoints: 100,
      keepProps: { IDENT: "id", TYPE_CODE: "t" },
    },
  },
  {
    name: "mtr-segments",
    service: "MTRSegment",
    outFields: "NAME,IDENT,ROUTETYPE",
    flatfile: {
      outputName: "mtr-segments.json",
      precision: 3,
      maxRingPoints: 60,
      keepProps: { NAME: "n", IDENT: "id", ROUTETYPE: "t" },
    },
  },
  {
    name: "holding-patterns",
    service: "HoldingPattern",
    outFields: "NAME,IDENT,LATITUDE,LONGITUDE",
    flatfile: {
      outputName: "holding-patterns.json",
      precision: 4,
      maxRingPoints: 100,
      keepProps: { NAME: "n", IDENT: "id" },
    },
  },
  {
    name: "runways",
    service: "Runways",
    outFields: "AIRPORT_ID,DESIGNATOR,LENGTH,WIDTH",
    flatfile: {
      outputName: "runways.json",
      precision: 4,
      maxRingPoints: 20,
      keepProps: { AIRPORT_ID: "apt", DESIGNATOR: "rwy", LENGTH: "len", WIDTH: "wid" },
    },
  },
  // D1 tables
  {
    name: "airports",
    service: "US_Airport",
    outFields: "IDENT,NAME,ICAO_ID,ELEVATION,TYPE_CODE,SERVCITY,STATE,COUNTRY,MIL_CODE,IAPEXISTS,PRIVATEUSE,OPERSTATUS",
    d1: {
      table: "faa_airports",
      columns: ["ident", "name", "icao_id", "latitude", "longitude", "elevation", "type_code", "city", "state", "country", "mil_code", "iap_exists", "private_use", "tier", "h3_res3", "h3_res4", "h3_res5"],
      h3Resolutions: [3, 4, 5],
      computeTier: airportTier,
      mapRow: (p, geom) => [
        p.IDENT, p.NAME, p.ICAO_ID,
        geom?.coordinates?.[1], geom?.coordinates?.[0],
        p.ELEVATION, p.TYPE_CODE, p.SERVCITY, p.STATE, p.COUNTRY,
        p.MIL_CODE, p.IAPEXISTS, p.PRIVATEUSE,
      ],
    },
  },
  {
    name: "navaids",
    service: "NAVAIDSystem",
    outFields: "IDENT,NAME_TXT,CLASS_TXT,CITY,STATE,COUNTRY,STATUS",
    d1: {
      table: "faa_navaids",
      columns: ["ident", "name", "class", "latitude", "longitude", "city", "state", "country", "status", "tier", "h3_res3", "h3_res4", "h3_res5"],
      h3Resolutions: [3, 4, 5],
      computeTier: navaidTier,
      mapRow: (p, geom) => [
        p.IDENT, p.NAME_TXT, p.CLASS_TXT,
        geom?.coordinates?.[1], geom?.coordinates?.[0],
        p.CITY, p.STATE, p.COUNTRY, p.STATUS,
      ],
    },
  },
  {
    name: "designated-points",
    service: "DesignatedPoint",
    outFields: "IDENT_TXT,TYPE_CODE,MIL_CODE",
    d1: {
      table: "faa_designated_points",
      columns: ["ident", "latitude", "longitude", "type_code", "state", "country", "tier", "h3_res3", "h3_res4", "h3_res5"],
      h3Resolutions: [3, 4, 5],
      computeTier: () => 3,
      mapRow: (p, geom) => [
        p.IDENT_TXT,
        geom?.coordinates?.[1], geom?.coordinates?.[0],
        p.TYPE_CODE, null, null,
      ],
    },
  },
  {
    name: "obstacles",
    service: "Digital_Obstacle_File",
    outFields: "OAS_Number,Lat_DD,Long_DD,Type_Code,AGL,AMSL,Lighting,City,State",
    d1: {
      table: "faa_obstacles",
      columns: ["oas_number", "latitude", "longitude", "type_code", "agl", "amsl", "lighting", "city", "state", "tier", "h3_res3", "h3_res4", "h3_res5"],
      h3Resolutions: [3, 4, 5],
      computeTier: obstacleTier,
      mapRow: (p, geom) => [
        p.OAS_Number,
        geom?.coordinates?.[1] ?? parseFloat(p.Lat_DD),
        geom?.coordinates?.[0] ?? parseFloat(p.Long_DD),
        p.Type_Code, p.AGL, p.AMSL, p.Lighting, p.City, p.State,
      ],
    },
  },
  {
    name: "ils",
    service: "ILS_Component",
    outFields: "*",
    d1: {
      table: "faa_ils",
      columns: ["ident", "airport_id", "runway", "system_type", "latitude", "longitude", "category", "frequency", "state", "tier", "h3_res4", "h3_res5"],
      h3Resolutions: [4, 5],
      computeTier: () => 2,
      mapRow: (p, geom) => [
        p.IDENT || p.COMP_IDENT,
        p.AIRPORT_ID || p.FAC_IDENT,
        p.RUNWAY || p.RWY_ID,
        p.SYSTEM_TYPE || p.COMP_TYPE,
        geom?.coordinates?.[1] ?? p.LATITUDE,
        geom?.coordinates?.[0] ?? p.LONGITUDE,
        p.CATEGORY || p.ILS_CAT,
        p.FREQUENCY || p.FREQ,
        p.STATE,
      ],
    },
  },
];

// ─── ArcGIS Fetcher with pagination ─────────────────────────

async function fetchAllFeatures(
  service: string,
  opts: { where?: string; outFields: string; layer?: number }
): Promise<any> {
  const layer = opts.layer ?? 0;
  const baseUrl = `${ARCGIS_BASE}/${service}/FeatureServer/${layer}/query`;
  const allFeatures: any[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      where: opts.where || "1=1",
      outFields: opts.outFields,
      returnGeometry: "true",
      f: "geojson",
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    });

    const url = `${baseUrl}?${params}`;
    console.log(`  Fetching offset=${offset}...`);

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  HTTP ${res.status} from ${url}`);
      break;
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`  JSON parse error at offset ${offset} (${text.length} bytes)`);
      break;
    }

    if (!data.features) {
      console.error(`  No features in response`);
      break;
    }

    allFeatures.push(...data.features);
    console.log(`  Got ${data.features.length} features (total: ${allFeatures.length})`);

    if (data.features.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
    await sleep(DELAY_MS);
  }

  return { type: "FeatureCollection", features: allFeatures };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Geometry simplification ────────────────────────────────

function roundCoord(coords: any, precision: number): any {
  if (typeof coords[0] === "number") {
    return coords.map((c: number) => +c.toFixed(precision));
  }
  return coords.map((c: any) => roundCoord(c, precision));
}

function thinRing(ring: number[][], maxPoints: number): number[][] {
  if (ring.length <= maxPoints) return ring;
  const step = Math.max(1, Math.floor(ring.length / maxPoints));
  const result: number[][] = [];
  for (let i = 0; i < ring.length; i += step) {
    result.push(ring[i]);
  }
  if (result[result.length - 1] !== ring[ring.length - 1]) {
    result.push(ring[ring.length - 1]);
  }
  return result;
}

function simplifyGeometry(
  geojson: any,
  opts: FlatfileOpts
): any {
  const features = geojson.features.map((f: any) => {
    // Simplify properties
    const newProps: Record<string, any> = {};
    for (const [src, dst] of Object.entries(opts.keepProps)) {
      if (f.properties[src] != null) newProps[dst] = f.properties[src];
    }

    // Simplify geometry
    let geom = f.geometry;
    if (geom) {
      let coords = roundCoord(geom.coordinates, opts.precision);
      if (geom.type === "Polygon") {
        coords = coords.map((ring: number[][]) => thinRing(ring, opts.maxRingPoints));
      } else if (geom.type === "MultiPolygon") {
        coords = coords.map((poly: number[][][]) =>
          poly.map((ring: number[][]) => thinRing(ring, opts.maxRingPoints))
        );
      } else if (geom.type === "LineString") {
        coords = thinRing(coords, opts.maxRingPoints);
      } else if (geom.type === "MultiLineString") {
        coords = coords.map((line: number[][]) => thinRing(line, opts.maxRingPoints));
      }
      geom = { type: geom.type, coordinates: coords };
    }

    return { type: "Feature", properties: newProps, geometry: geom };
  });

  return { type: "FeatureCollection", features };
}

// ─── D1 Loader ──────────────────────────────────────────────

function escapeSQL(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function runD1(sql: string) {
  const flag = isRemote ? "--remote" : "--local";
  try {
    execSync(
      `npx wrangler d1 execute freeflight-db ${flag} --command="${sql.replace(/"/g, '\\"')}"`,
      { stdio: "pipe", timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );
  } catch (e: any) {
    // For large operations, use --file instead
    const tmpFile = `/tmp/faa-d1-${Date.now()}.sql`;
    fs.writeFileSync(tmpFile, sql);
    try {
      execSync(`npx wrangler d1 execute freeflight-db ${flag} --file=${tmpFile}`, {
        stdio: "pipe",
        timeout: 60000,
      });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }
}

async function runD1File(sqlFile: string) {
  const flag = isRemote ? "--remote" : "--local";
  const fileSize = fs.statSync(sqlFile).size;

  // If file is over 5MB, split into chunks
  if (fileSize > 5 * 1024 * 1024) {
    console.log(`  Large SQL file (${(fileSize / 1024 / 1024).toFixed(1)}MB), splitting into chunks...`);
    const content = fs.readFileSync(sqlFile, "utf-8");
    const statements = content.split(";\n").filter((s) => s.trim());
    const CHUNK_STMTS = isRemote ? 100 : 500;
    let chunkNum = 0;

    for (let i = 0; i < statements.length; i += CHUNK_STMTS) {
      const chunk = statements.slice(i, i + CHUNK_STMTS).join(";\n") + ";";
      const chunkFile = sqlFile.replace(".sql", `-chunk${chunkNum}.sql`);
      fs.writeFileSync(chunkFile, chunk);
      try {
        try {
          execSync(`npx wrangler d1 execute freeflight-db ${flag} --file=${chunkFile}`, {
            stdio: "pipe",
            timeout: 120000,
            maxBuffer: 50 * 1024 * 1024,
          });
        } catch (ce: any) {
          const stdout = ce.stdout?.toString() || "";
          if (!stdout.includes("Executed") && !stdout.includes("rows_written")) {
            throw ce;
          }
        }
      } finally {
        try { fs.unlinkSync(chunkFile); } catch {}
      }
      chunkNum++;
      if (chunkNum % 10 === 0) {
        const pct = Math.round(((i + CHUNK_STMTS) / statements.length) * 100);
        console.log(`  Chunk ${chunkNum} (${Math.min(pct, 100)}%)...`);
      }
      // Delay between chunks for remote D1 to avoid rate limits
      if (isRemote) await sleep(500);
    }
    return;
  }

  try {
    execSync(`npx wrangler d1 execute freeflight-db ${flag} --file=${sqlFile}`, {
      stdio: "pipe",
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: any) {
    // Wrangler often returns non-zero exit code for remote --file even on success
    // Check stdout for success indicators
    const stdout = e.stdout?.toString() || "";
    if (stdout.includes("Executed") || stdout.includes("rows_written")) {
      // SQL executed, wrangler just complained
      return;
    }
    throw e;
  }
}

async function loadToD1(geojson: any, opts: D1Opts, sourceName: string) {
  const features = geojson.features;
  if (features.length === 0) {
    console.log(`  No records to load for ${sourceName}`);
    return;
  }

  console.log(`  Loading ${features.length} records into ${opts.table}...`);

  // Write a SQL file for the entire operation
  const tmpFile = `/tmp/faa-d1-${sourceName}-${Date.now()}.sql`;
  const colList = opts.columns.join(", ");
  const lines: string[] = [];

  lines.push(`DELETE FROM ${opts.table};`);

  const BATCH_SIZE = 50;
  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    const values = batch
      .map((f: any) => {
        const row = opts.mapRow(f.properties || {}, f.geometry);

        // Skip rows where the first column (usually ident) is null/empty
        if (row[0] == null || row[0] === "") return null;

        // Compute tier
        const tier = opts.computeTier
          ? opts.computeTier(f.properties || {})
          : 3;
        row.push(tier);

        // Compute H3 cells from lat/lng (find them in the row)
        // lat is at the index of "latitude" in columns, lng at "longitude"
        const latIdx = opts.columns.indexOf("latitude");
        const lngIdx = opts.columns.indexOf("longitude");
        const lat = latIdx >= 0 ? row[latIdx] as number : null;
        const lng = lngIdx >= 0 ? row[lngIdx] as number : null;

        if (opts.h3Resolutions) {
          if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
            for (const res of opts.h3Resolutions) {
              row.push(computeH3(lat, lng, res));
            }
          } else {
            for (const _ of opts.h3Resolutions) {
              row.push(null);
            }
          }
        }

        return "(" + row.map(escapeSQL).join(",") + ")";
      })
      .filter(Boolean)
      .join(",\n");
    if (values) lines.push(`INSERT INTO ${opts.table} (${colList}) VALUES ${values};`);
  }

  fs.writeFileSync(tmpFile, lines.join("\n"));
  console.log(`  Executing SQL file (${(fs.statSync(tmpFile).size / 1024).toFixed(0)}KB)...`);

  try {
    runD1File(tmpFile);
    console.log(`  ✓ Loaded ${features.length} records into ${opts.table}`);
    // Log load (non-critical)
    try {
      runD1(`INSERT INTO faa_load_log (source, record_count, status) VALUES ('${sourceName}', ${features.length}, 'ok')`);
    } catch {}
  } catch (e: any) {
    console.error(`  ✗ Failed to load ${opts.table}: ${e.message?.slice(0, 200)}`);
    // Try smaller chunked files
    console.log(`  Retrying with smaller file chunks...`);
    const retryFile = `/tmp/faa-retry-${sourceName}-${Date.now()}.sql`;
    fs.writeFileSync(retryFile, `DELETE FROM ${opts.table};`);
    runD1File(retryFile);
    fs.unlinkSync(retryFile);

    let loaded = 0;
    const RETRY_CHUNK = 200;
    for (let i = 0; i < features.length; i += RETRY_CHUNK) {
      const chunk = features.slice(i, i + RETRY_CHUNK);
      const stmts: string[] = [];
      for (let j = 0; j < chunk.length; j += BATCH_SIZE) {
        const batch = chunk.slice(j, j + BATCH_SIZE);
        const values = batch
          .map((f: any) => {
            const row = opts.mapRow(f.properties || {}, f.geometry);
            if (row[0] == null || row[0] === "") return null;
            const tier = opts.computeTier ? opts.computeTier(f.properties || {}) : 3;
            row.push(tier);
            const latIdx = opts.columns.indexOf("latitude");
            const lngIdx = opts.columns.indexOf("longitude");
            const lat = latIdx >= 0 ? row[latIdx] as number : null;
            const lng = lngIdx >= 0 ? row[lngIdx] as number : null;
            if (opts.h3Resolutions) {
              if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
                for (const res of opts.h3Resolutions) {
                  row.push(computeH3(lat, lng, res));
                }
              } else {
                for (const _ of opts.h3Resolutions) {
                  row.push(null);
                }
              }
            }
            return "(" + row.map(escapeSQL).join(",") + ")";
          })
          .filter(Boolean)
          .join(",");
        if (values) stmts.push(`INSERT INTO ${opts.table} (${colList}) VALUES ${values};`);
      }
      const chunkFile = `/tmp/faa-retry-chunk-${Date.now()}.sql`;
      fs.writeFileSync(chunkFile, stmts.join("\n"));
      try {
        runD1File(chunkFile);
        loaded += chunk.length;
      } catch (e2: any) {
        console.error(`  Chunk at offset ${i} failed, skipping`);
      }
      try { fs.unlinkSync(chunkFile); } catch {}
      if (i % 2000 === 0 && i > 0) console.log(`  ${loaded} / ${features.length}...`);
    }
    console.log(`  Loaded ${loaded} / ${features.length} records`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log(`FAA Data Download — ${TODAY}`);
  console.log(`D1 target: ${isRemote ? "REMOTE" : "LOCAL"}`);
  console.log("");

  // Ensure directories exist
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  // Ensure FAA tables exist
  const schemaFile = path.resolve(__dirname, "../schema-faa.sql");
  if (fs.existsSync(schemaFile)) {
    console.log("Initializing FAA schema...");
    try {
      runD1File(schemaFile);
      console.log("  ✓ Schema ready\n");
    } catch (e: any) {
      console.error("  Schema init failed:", e.message?.slice(0, 200));
    }
  }

  const sources = onlySource
    ? SOURCES.filter((s) => s.name === onlySource)
    : SOURCES;

  if (sources.length === 0) {
    console.error(`Unknown source: ${onlySource}`);
    console.log("Available:", SOURCES.map((s) => s.name).join(", "));
    process.exit(1);
  }

  const summary: { name: string; features: number; output: string; status: string }[] = [];

  for (const source of sources) {
    console.log(`━━━ ${source.name} ━━━`);

    let geojson: any;
    try {
      geojson = await fetchAllFeatures(source.service, {
        where: source.where,
        outFields: source.outFields,
        layer: source.layer,
      });
    } catch (e: any) {
      console.error(`  Download failed: ${e.message}`);
      summary.push({ name: source.name, features: 0, output: "-", status: "FAILED" });
      continue;
    }

    const featureCount = geojson.features.length;
    console.log(`  Total: ${featureCount} features`);

    // Flat file output
    if (source.flatfile && !skipFlatfile) {
      const simplified = simplifyGeometry(geojson, source.flatfile);
      const json = JSON.stringify(simplified, null, 0)
        .replace(/\n/g, "")
        .replace(/  +/g, "");
      const compact = JSON.stringify(simplified, null);

      const outPath = path.join(PUBLIC_DATA, source.flatfile.outputName);
      fs.writeFileSync(outPath, JSON.stringify(simplified, null, 0));
      const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
      console.log(`  → ${source.flatfile.outputName} (${sizeKB}KB)`);

      // Archive
      const archiveName = source.flatfile.outputName.replace(
        ".json",
        `.${TODAY}.json`
      );
      fs.copyFileSync(outPath, path.join(ARCHIVE_DIR, archiveName));

      summary.push({
        name: source.name,
        features: featureCount,
        output: `${source.flatfile.outputName} (${sizeKB}KB)`,
        status: "OK",
      });
    }

    // D1 loading
    if (source.d1 && !skipD1) {
      try {
        await loadToD1(geojson, source.d1, source.name);
        summary.push({
          name: source.name,
          features: featureCount,
          output: source.d1.table,
          status: "OK",
        });
      } catch (e: any) {
        console.error(`  D1 load failed: ${e.message}`);
        summary.push({
          name: source.name,
          features: featureCount,
          output: source.d1.table,
          status: "FAILED",
        });
      }
    }

    if (!source.flatfile && !source.d1) {
      summary.push({ name: source.name, features: featureCount, output: "-", status: "OK" });
    }

    console.log("");
  }

  // Summary
  console.log("━━━ Summary ━━━");
  for (const s of summary) {
    const icon = s.status === "OK" ? "✓" : "✗";
    console.log(`  ${icon} ${s.name}: ${s.features} features → ${s.output}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
