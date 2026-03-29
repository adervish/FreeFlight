#!/usr/bin/env tsx
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CYCLE = process.argv.find((_, i, a) => a[i - 1] === "--cycle") || "2603";
const isRemote = process.argv.includes("--remote");
const DATA_DIR = path.resolve(__dirname, "../data/plates");
const META_FILE = path.join(DATA_DIR, `d-tpp_Metafile_${CYCLE}.xml`);

function escapeSQL(val: any): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function runD1File(sqlFile: string) {
  const flag = isRemote ? "--remote" : "--local";
  try {
    execSync(`npx wrangler d1 execute freeflight-db ${flag} --file=${sqlFile}`, {
      stdio: "pipe",
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (e: any) {
    const stdout = e.stdout?.toString() || "";
    if (!stdout.includes("Executed") && !stdout.includes("rows_written")) {
      throw e;
    }
  }
}

interface PlateRecord {
  airport: string;
  icao: string;
  state: string;
  city: string;
  chartCode: string;
  chartName: string;
  pdfName: string;
}

function parseMetafile(xmlPath: string): PlateRecord[] {
  const xml = fs.readFileSync(xmlPath, "utf-8");
  const records: PlateRecord[] = [];
  const fieldRe = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`);

  const stateBlocks = xml.split(/<state_code\s/);
  for (const stateBlock of stateBlocks.slice(1)) {
    const stateMatch = stateBlock.match(/ID="([^"]*)"/);
    const stateId = stateMatch ? stateMatch[1] : "";

    const cityBlocks = stateBlock.split(/<city_name\s/);
    for (const cityBlock of cityBlocks.slice(1)) {
      const cityMatch = cityBlock.match(/ID="([^"]*)"/);
      const cityId = cityMatch ? cityMatch[1] : "";

      const airportBlocks = cityBlock.split(/<airport_name\s/);
      for (const aptBlock of airportBlocks.slice(1)) {
        const aptMatch = aptBlock.match(/apt_ident="([^"]*)"/);
        const icaoMatch = aptBlock.match(/icao_ident="([^"]*)"/);
        const aptId = aptMatch ? aptMatch[1] : "";
        const icaoId = icaoMatch ? icaoMatch[1] : "";

        const recRe = /<record>([\s\S]*?)<\/record>/g;
        let match;
        while ((match = recRe.exec(aptBlock)) !== null) {
          const rec = match[1];
          const chartCode = rec.match(fieldRe("chart_code"))?.[1] || "";
          const chartName = rec.match(fieldRe("chart_name"))?.[1] || "";
          const pdfName = rec.match(fieldRe("pdf_name"))?.[1] || "";

          if (pdfName) {
            records.push({ airport: aptId, icao: icaoId, state: stateId, city: cityId, chartCode, chartName, pdfName });
          }
        }
      }
    }
  }
  return records;
}

async function main() {
  console.log(`Loading plate index — Cycle ${CYCLE}`);
  console.log(`Target: ${isRemote ? "REMOTE" : "LOCAL"}\n`);

  // Init schema
  const flag = isRemote ? "--remote" : "--local";
  execSync(`npx wrangler d1 execute freeflight-db ${flag} --command="CREATE TABLE IF NOT EXISTS faa_plates (id INTEGER PRIMARY KEY AUTOINCREMENT, airport_ident TEXT NOT NULL, icao_ident TEXT, state TEXT, city TEXT, chart_code TEXT NOT NULL, chart_name TEXT NOT NULL, pdf_name TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_faa_plates_airport ON faa_plates(airport_ident); CREATE INDEX IF NOT EXISTS idx_faa_plates_icao ON faa_plates(icao_ident);"`, { stdio: "pipe" });

  console.log("Parsing metafile...");
  const records = parseMetafile(META_FILE);
  console.log(`  ${records.length} plate records\n`);

  // Write SQL file
  const tmpFile = `/tmp/plates-index-${Date.now()}.sql`;
  const lines: string[] = ["DELETE FROM faa_plates;"];
  const BATCH = 50;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const values = batch.map((r) =>
      "(" + [r.airport, r.icao, r.state, r.city, r.chartCode, r.chartName, r.pdfName].map(escapeSQL).join(",") + ")"
    ).join(",");
    lines.push(`INSERT INTO faa_plates (airport_ident, icao_ident, state, city, chart_code, chart_name, pdf_name) VALUES ${values};`);
  }

  fs.writeFileSync(tmpFile, lines.join("\n"));
  const sizeKB = (fs.statSync(tmpFile).size / 1024).toFixed(0);
  console.log(`SQL file: ${sizeKB}KB`);

  // Execute — split into chunks for remote
  if (isRemote) {
    const statements = lines;
    const CHUNK = 100;
    for (let i = 0; i < statements.length; i += CHUNK) {
      const chunk = statements.slice(i, i + CHUNK).join("\n");
      const chunkFile = `/tmp/plates-chunk-${Date.now()}.sql`;
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
      if (i % 500 === 0 && i > 0) console.log(`  ${Math.min(i * BATCH, records.length)}/${records.length}...`);
      await new Promise((r) => setTimeout(r, 500));
    }
  } else {
    runD1File(tmpFile);
  }

  try { fs.unlinkSync(tmpFile); } catch {}
  console.log(`\n✓ Loaded ${records.length} plate records`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
