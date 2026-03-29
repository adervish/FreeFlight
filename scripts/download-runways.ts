#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";

const ARCGIS_BASE = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const isRemote = process.argv.includes("--remote");

async function fetchAll(service: string, fields: string) {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const url = `${ARCGIS_BASE}/${service}/FeatureServer/0/query?where=1%3D1&outFields=${fields}&returnGeometry=false&f=json&resultRecordCount=1000&resultOffset=${offset}`;
    const res = await fetch(url);
    const data = await res.json() as any;
    const feats = data.features || [];
    all.push(...feats.map((f: any) => f.attributes));
    console.log(`  ${service}: offset=${offset}, total=${all.length}`);
    if (feats.length < 1000) break;
    offset += 1000;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

function esc(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return isNaN(val) ? "NULL" : String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

async function main() {
  console.log("Downloading FAA runway data...");
  console.log(`Target: ${isRemote ? "REMOTE" : "LOCAL"}\n`);

  const flag = isRemote ? "--remote" : "--local";
  execSync(`npx wrangler d1 execute freeflight-db ${flag} --command="CREATE TABLE IF NOT EXISTS faa_runways (id INTEGER PRIMARY KEY AUTOINCREMENT, airport_ident TEXT NOT NULL, designator TEXT, length_ft INTEGER, width_ft INTEGER, surface TEXT, lighting TEXT); CREATE INDEX IF NOT EXISTS idx_faa_runways_airport ON faa_runways(airport_ident);"`, { stdio: "pipe" });

  // Download airports to build GLOBAL_ID → IDENT map
  console.log("Fetching airport GUIDs...");
  const airports = await fetchAll("US_Airport", "GLOBAL_ID,IDENT");
  console.log(`  ${airports.length} airports\n`);

  const guidToIdent: Record<string, string> = {};
  for (const a of airports) {
    guidToIdent[a.GLOBAL_ID] = a.IDENT;
  }

  // Download runways
  console.log("Fetching runways...");
  const runways = await fetchAll("Runways", "AIRPORT_ID,DESIGNATOR,LENGTH,WIDTH,DIM_UOM,COMP_CODE,LIGHTINTNS");
  console.log(`  ${runways.length} runways\n`);

  // Join
  const joined: any[] = [];
  for (const r of runways) {
    const ident = guidToIdent[r.AIRPORT_ID];
    if (!ident) continue;
    joined.push({
      airport: ident,
      designator: r.DESIGNATOR,
      length: r.LENGTH,
      width: r.WIDTH,
      surface: r.COMP_CODE,
      lighting: r.LIGHTINTNS,
    });
  }
  console.log(`${joined.length} joined runway records\n`);

  // Delete and insert
  if (isRemote) {
    execSync(`npx wrangler d1 execute freeflight-db --remote --command="DELETE FROM faa_runways"`, { stdio: "pipe" });
  }

  const BATCH = 50;
  const lines: string[] = isRemote ? [] : ["DELETE FROM faa_runways;"];
  for (let i = 0; i < joined.length; i += BATCH) {
    const batch = joined.slice(i, i + BATCH);
    const values = batch.map(r =>
      "(" + [r.airport, r.designator, r.length, r.width, r.surface, r.lighting].map(esc).join(",") + ")"
    ).join(",");
    lines.push(`INSERT INTO faa_runways (airport_ident, designator, length_ft, width_ft, surface, lighting) VALUES ${values};`);
  }

  if (isRemote) {
    const CHUNK = 50;
    for (let i = 0; i < lines.length; i += CHUNK) {
      const chunk = lines.slice(i, i + CHUNK).join("\n");
      const chunkFile = `/tmp/rwy-chunk-${Date.now()}.sql`;
      fs.writeFileSync(chunkFile, chunk);
      try {
        execSync(`npx wrangler d1 execute freeflight-db --remote --file=${chunkFile}`, {
          stdio: "pipe", timeout: 120000, maxBuffer: 50 * 1024 * 1024,
        });
      } catch (e: any) {
        const stdout = e.stdout?.toString() || "";
        if (!stdout.includes("rows_written")) console.error(`  Chunk at ${i} failed`);
      }
      fs.unlinkSync(chunkFile);
      if (i % 200 === 0 && i > 0) console.log(`  ${Math.min(i * BATCH, joined.length)}/${joined.length}...`);
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    const tmpFile = `/tmp/faa-rwy-${Date.now()}.sql`;
    fs.writeFileSync(tmpFile, lines.join("\n"));
    try {
      execSync(`npx wrangler d1 execute freeflight-db --local --file=${tmpFile}`, {
        stdio: "pipe", timeout: 120000, maxBuffer: 50 * 1024 * 1024,
      });
    } catch (e: any) {
      const stdout = e.stdout?.toString() || "";
      if (!stdout.includes("rows_written")) throw e;
    }
    fs.unlinkSync(tmpFile);
  }

  console.log(`\n✓ Loaded ${joined.length} runway records`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
