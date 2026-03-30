#!/usr/bin/env tsx
/**
 * Parse CIFP (ARINC 424) FAACIFP18 file to extract all enroute waypoints/fixes
 * that are missing from the FAA DesignatedPoint ArcGIS service.
 *
 * ARINC 424 EA record format (enroute fix):
 *   Col 1-4:   "SUSA"
 *   Col 5-6:   "EA" (enroute waypoint)
 *   Col 7-10:  Section/subsection
 *   Col 14-18: Fix ident (5 chars, right-padded)
 *   Col 19-20: ICAO region
 *   Col 33:    Latitude N/S
 *   Col 34-41: Latitude DDMMSSSS
 *   Col 42:    Longitude E/W
 *   Col 43-51: Longitude DDDMMSSSS
 *
 * Usage: tsx scripts/parse-cifp-waypoints.ts [--remote] [--cifp /path/to/FAACIFP18]
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const isRemote = process.argv.includes("--remote");
const cifpPath = process.argv.find((_, i, a) => a[i - 1] === "--cifp") || "/tmp/cifp/FAACIFP18";
const dbName = "freeflight-db";

function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return "'" + String(val).replace(/'/g, "''").replace(/[\x00-\x1f\\]/g, "") + "'";
}

function parseLatLon(latStr: string, lonStr: string): { lat: number; lon: number } | null {
  // Lat: N/S + DDMMSSSS (DD degrees, MM minutes, SSSS seconds*100)
  // Lon: E/W + DDDMMSSSS
  try {
    const latSign = latStr[0] === "S" ? -1 : 1;
    const latDeg = parseInt(latStr.substring(1, 3));
    const latMin = parseInt(latStr.substring(3, 5));
    const latSec = parseInt(latStr.substring(5, 9)) / 100;
    const lat = latSign * (latDeg + latMin / 60 + latSec / 3600);

    const lonSign = lonStr[0] === "W" ? -1 : 1;
    const lonDeg = parseInt(lonStr.substring(1, 4));
    const lonMin = parseInt(lonStr.substring(4, 6));
    const lonSec = parseInt(lonStr.substring(6, 10)) / 100;
    const lon = lonSign * (lonDeg + lonMin / 60 + lonSec / 3600);

    if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

interface CIFPWaypoint {
  ident: string;
  lat: number;
  lon: number;
  type: string;
}

function parseCIFP(filePath: string): CIFPWaypoint[] {
  const content = fs.readFileSync(filePath, "ascii");
  const lines = content.split("\n");
  const waypoints: CIFPWaypoint[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // EA records = enroute waypoints
    if (!line.startsWith("SUSAEA")) continue;
    if (line.length < 51) continue;

    const ident = line.substring(13, 18).trim();
    if (!ident || ident.length < 2) continue;

    // Deduplicate
    if (seen.has(ident)) continue;

    // Extract lat/lon
    const latStr = line.substring(32, 41);
    const lonStr = line.substring(41, 51);
    const coords = parseLatLon(latStr, lonStr);
    if (!coords) continue;

    seen.add(ident);
    waypoints.push({
      ident,
      lat: coords.lat,
      lon: coords.lon,
      type: "CIFP",
    });
  }

  return waypoints;
}

async function main() {
  console.log("CIFP Waypoint Parser");
  console.log(`CIFP file: ${cifpPath}`);
  console.log(`Target: ${isRemote ? "REMOTE" : "LOCAL"}\n`);

  if (!fs.existsSync(cifpPath)) {
    console.error("CIFP file not found. Download it:");
    console.error("  curl -sL -o /tmp/cifp.zip https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260319.zip");
    console.error("  cd /tmp && unzip cifp.zip -d cifp");
    process.exit(1);
  }

  const waypoints = parseCIFP(cifpPath);
  console.log(`Parsed ${waypoints.length} unique waypoints from CIFP\n`);

  // Check which ones are already in the DB
  const flag = isRemote ? "--remote" : "--local";

  // Get existing idents
  console.log("Checking existing waypoints...");
  let existingCount = 0;
  try {
    const result = execSync(
      `npx wrangler d1 execute ${dbName} ${flag} --command="SELECT COUNT(*) as c FROM faa_designated_points"`,
      { stdio: "pipe", maxBuffer: 50 * 1024 * 1024 }
    ).toString();
    const match = result.match(/"c":\s*(\d+)/);
    existingCount = match ? parseInt(match[1]) : 0;
  } catch {}
  console.log(`  ${existingCount} existing waypoints in DB`);

  // Insert only new ones (don't delete existing — merge)
  // Use INSERT OR IGNORE if ident is unique, but our table doesn't have a unique constraint on ident
  // So we'll check for duplicates by ident
  console.log("Loading CIFP waypoints...");

  const BATCH = 25;
  let loaded = 0;

  for (let i = 0; i < waypoints.length; i += BATCH) {
    const batch = waypoints.slice(i, i + BATCH);
    const values = batch.map((w) => {
      return "(" + [w.ident, w.lat, w.lon, w.type, null, null, 3, null, null, null].map(esc).join(",") + ")";
    }).join(",");

    // Use INSERT OR REPLACE — but we need to avoid duplicates with existing data
    // Simplest: delete CIFP-type entries first, then insert all
    const sql = `INSERT INTO faa_designated_points (ident, latitude, longitude, type_code, state, country, tier, h3_res3, h3_res4, h3_res5) VALUES ${values};`;
    const tmpFile = `/tmp/cifp-batch-${Date.now()}.sql`;
    fs.writeFileSync(tmpFile, sql);

    try {
      execSync(`npx wrangler d1 execute ${dbName} ${flag} --file=${tmpFile}`, {
        stdio: "pipe",
        maxBuffer: 50 * 1024 * 1024,
      });
      loaded += batch.length;
    } catch {}

    fs.unlinkSync(tmpFile);
    if (i % 2000 === 0 && i > 0) console.log(`  ${loaded}/${waypoints.length}...`);
    if (isRemote) await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n✓ Loaded ${loaded} CIFP waypoints (total DB: ~${existingCount + loaded})`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
