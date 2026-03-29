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

function runD1File(sqlFile: string) {
  const flag = isRemote ? "--remote" : "--local";
  try {
    execSync(`npx wrangler d1 execute freeflight-db ${flag} --file=${sqlFile}`, {
      stdio: "pipe", timeout: 120000, maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: any) {
    const stdout = e.stdout?.toString() || "";
    if (!stdout.includes("Executed") && !stdout.includes("rows_written")) throw e;
  }
}

async function main() {
  console.log("Downloading FAA frequencies...");
  console.log(`Target: ${isRemote ? "REMOTE" : "LOCAL"}\n`);

  // Init schema
  const flag = isRemote ? "--remote" : "--local";
  execSync(`npx wrangler d1 execute freeflight-db ${flag} --command="CREATE TABLE IF NOT EXISTS faa_frequencies (id INTEGER PRIMARY KEY AUTOINCREMENT, airport_ident TEXT NOT NULL, service_type TEXT, freq_tx REAL, freq_rx REAL, remarks TEXT); CREATE INDEX IF NOT EXISTS idx_faa_freq_airport ON faa_frequencies(airport_ident);"`, { stdio: "pipe" });

  // Download Services (maps GLOBAL_ID → airport IDENT + TYPE_CODE)
  console.log("Fetching Services...");
  const services = await fetchAll("Services", "GLOBAL_ID,IDENT,TYPE_CODE");
  console.log(`  ${services.length} services\n`);

  // Download Frequencies (maps SERVICE_ID → frequency)
  console.log("Fetching Frequencies...");
  const frequencies = await fetchAll("Frequencies", "SERVICE_ID,FREQ_TRANS,FREQ_REC,TYPE_CODE,REMARKS");
  console.log(`  ${frequencies.length} frequencies\n`);

  // Join: frequency → service → airport ident
  const serviceMap: Record<string, { ident: string; type: string }> = {};
  for (const s of services) {
    serviceMap[s.GLOBAL_ID] = { ident: s.IDENT, type: s.TYPE_CODE };
  }

  const joined: { airport: string; type: string; tx: number; rx: number; remarks: string }[] = [];
  for (const f of frequencies) {
    const svc = serviceMap[f.SERVICE_ID];
    if (!svc) continue;
    joined.push({
      airport: svc.ident,
      type: svc.type,
      tx: f.FREQ_TRANS,
      rx: f.FREQ_REC,
      remarks: f.REMARKS,
    });
  }
  console.log(`${joined.length} joined frequency records\n`);

  // Write SQL
  const tmpFile = `/tmp/faa-freq-${Date.now()}.sql`;
  const lines: string[] = ["DELETE FROM faa_frequencies;"];
  const BATCH = 50;
  for (let i = 0; i < joined.length; i += BATCH) {
    const batch = joined.slice(i, i + BATCH);
    const values = batch.map(r =>
      "(" + [r.airport, r.type, r.tx, r.rx, r.remarks].map(esc).join(",") + ")"
    ).join(",");
    lines.push(`INSERT INTO faa_frequencies (airport_ident, service_type, freq_tx, freq_rx, remarks) VALUES ${values};`);
  }

  fs.writeFileSync(tmpFile, lines.join("\n"));
  console.log(`SQL file: ${(fs.statSync(tmpFile).size / 1024).toFixed(0)}KB`);

  if (isRemote) {
    // Delete separately for remote
    execSync(`npx wrangler d1 execute freeflight-db --remote --command="DELETE FROM faa_frequencies"`, { stdio: "pipe" });
    const insertLines = lines.filter(l => !l.startsWith("DELETE"));
    // Chunk for remote
    const CHUNK = 100;
    for (let i = 0; i < insertLines.length; i += CHUNK) {
      const chunk = insertLines.slice(i, i + CHUNK).join("\n");
      const chunkFile = `/tmp/freq-chunk-${Date.now()}.sql`;
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
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    runD1File(tmpFile);
  }

  try { fs.unlinkSync(tmpFile); } catch {}
  console.log(`\n✓ Loaded ${joined.length} frequency records`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
